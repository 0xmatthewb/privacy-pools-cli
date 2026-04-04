use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::contract::{ChainDefinition, Manifest, RuntimeConfig};
use crate::error::CliError;

#[derive(Debug, Clone)]
pub struct CliConfig {
    pub default_chain: String,
    pub rpc_overrides: HashMap<u64, String>,
}

pub fn resolve_chain(name: &str, manifest: &Manifest) -> Result<ChainDefinition, CliError> {
    let base = manifest
        .runtime_config
        .chains
        .get(name)
        .cloned()
        .ok_or_else(|| {
            CliError::input(
                format!("Unsupported chain: {name}."),
                Some(format!(
                    "Supported chains: {}",
                    manifest.runtime_config.chain_names.join(", ")
                )),
            )
        })?;

    Ok(apply_chain_overrides(base))
}

pub fn apply_chain_overrides(mut chain: ChainDefinition) -> ChainDefinition {
    if let Some(asp_host) = resolve_host_override("ASP_HOST", &chain.name) {
        chain.asp_host = asp_host;
    }
    if let Some(relayer_host) = resolve_host_override("RELAYER_HOST", &chain.name) {
        chain.relayer_host = relayer_host;
    }
    chain
}

fn resolve_host_override(kind: &str, chain_name: &str) -> Option<String> {
    let chain_suffix = normalized_chain_env_suffix(chain_name);
    env::var(format!("PRIVACY_POOLS_{kind}_{chain_suffix}"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var(format!("PP_{kind}_{chain_suffix}"))
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            env::var(format!("PRIVACY_POOLS_{kind}"))
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            env::var(format!("PP_{kind}"))
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

pub fn normalized_chain_env_suffix(chain_name: &str) -> String {
    chain_name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

pub fn config_home() -> PathBuf {
    if let Ok(value) = env::var("PRIVACY_POOLS_HOME") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    if let Ok(value) = env::var("PRIVACY_POOLS_CONFIG_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| env::var("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".privacy-pools")
}

fn config_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

pub fn load_config() -> Result<CliConfig, CliError> {
    let config_dir = config_home();
    let config_path = config_file_path(&config_dir);

    if !config_path.exists() {
        return Ok(CliConfig {
            default_chain: "mainnet".to_string(),
            rpc_overrides: HashMap::new(),
        });
    }

    let raw = fs::read_to_string(&config_path).map_err(|_| {
        CliError::input(
            "Config file is not valid JSON.",
            Some(format!(
                "Fix or remove {}, then run 'privacy-pools init'.",
                config_path.display()
            )),
        )
    })?;

    let parsed: Value = serde_json::from_str(&raw).map_err(|_| {
        CliError::input(
            "Config file is not valid JSON.",
            Some(format!(
                "Fix or remove {}, then run 'privacy-pools init'.",
                config_path.display()
            )),
        )
    })?;

    let object = parsed.as_object().ok_or_else(|| {
        CliError::input(
            "Config file has invalid structure.",
            Some(format!(
                "Fix or remove {}, then run 'privacy-pools init'.",
                config_path.display()
            )),
        )
    })?;

    let default_chain = object
        .get("defaultChain")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CliError::input(
                "Config file is missing a valid defaultChain.",
                Some(format!(
                    "Fix or remove {}, then run 'privacy-pools init'.",
                    config_path.display()
                )),
            )
        })?
        .to_string();

    let mut rpc_overrides = HashMap::new();
    if let Some(overrides) = object.get("rpcOverrides") {
        let overrides_object = overrides.as_object().ok_or_else(|| {
            CliError::input(
                "Config rpcOverrides must be an object.",
                Some(format!(
                    "Fix or remove {}, then run 'privacy-pools init'.",
                    config_path.display()
                )),
            )
        })?;

        for (key, value) in overrides_object {
            let override_value = value
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    CliError::input(
                        format!(
                            "Config rpcOverrides contains invalid value for chain key \"{key}\"."
                        ),
                        Some(format!(
                            "Fix or remove {}, then run 'privacy-pools init'.",
                            config_path.display()
                        )),
                    )
                })?;

            let chain_id = key.parse::<u64>().map_err(|_| {
                CliError::input(
                    format!("Config rpcOverrides contains invalid chain key \"{key}\"."),
                    Some(format!(
                        "Fix or remove {}, then run 'privacy-pools init'.",
                        config_path.display()
                    )),
                )
            })?;

            rpc_overrides.insert(chain_id, override_value.to_string());
        }
    }

    Ok(CliConfig {
        default_chain,
        rpc_overrides,
    })
}

pub fn resolve_rpc_env_var(chain_id: u64, runtime_config: &RuntimeConfig) -> Option<String> {
    if let Some(suffix) = runtime_config.chain_env_suffixes.get(&chain_id) {
        env::var(format!("PRIVACY_POOLS_RPC_URL_{suffix}"))
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                env::var(format!("PP_RPC_URL_{suffix}"))
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                env::var("PRIVACY_POOLS_RPC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                env::var("PP_RPC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
    } else {
        env::var("PRIVACY_POOLS_RPC_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                env::var("PP_RPC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
    }
}

pub fn has_custom_rpc_override(
    chain_id: u64,
    override_from_flag: Option<&str>,
    config: &CliConfig,
    runtime_config: &RuntimeConfig,
) -> bool {
    override_from_flag.is_some_and(|value| !value.trim().is_empty())
        || resolve_rpc_env_var(chain_id, runtime_config).is_some()
        || config.rpc_overrides.contains_key(&chain_id)
}

pub fn get_rpc_urls(
    chain_id: u64,
    override_from_flag: Option<String>,
    config: &CliConfig,
    runtime_config: &RuntimeConfig,
) -> Result<Vec<String>, CliError> {
    if let Some(value) = override_from_flag.filter(|value| !value.trim().is_empty()) {
        return Ok(vec![value]);
    }

    if let Some(value) = resolve_rpc_env_var(chain_id, runtime_config) {
        return Ok(vec![value]);
    }

    if let Some(value) = config.rpc_overrides.get(&chain_id) {
        return Ok(vec![value.clone()]);
    }

    runtime_config
        .default_rpc_urls
        .get(&chain_id)
        .cloned()
        .filter(|values| !values.is_empty())
        .ok_or_else(|| {
            CliError::rpc(
                format!("No RPC URL configured for chain {chain_id}."),
                Some(
                    "Pass --rpc-url <url> on the command, or set PP_RPC_URL in your environment."
                        .to_string(),
                ),
                None,
            )
        })
}
