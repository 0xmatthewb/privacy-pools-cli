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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::{
        ChainDefinition, CompletionCommandSpec, Manifest, ManifestRoutes, RuntimeConfig,
    };
    use serde_json::Value;
    fn with_env<R>(vars: &[(&str, Option<&str>)], run: impl FnOnce() -> R) -> R {
        let _guard = crate::test_env::env_lock().lock().unwrap();
        let previous = vars
            .iter()
            .map(|(key, _)| ((*key).to_string(), env::var(key).ok()))
            .collect::<Vec<_>>();

        for (key, value) in vars {
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
        }

        let result = run();

        for (key, value) in previous {
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
        }

        result
    }

    fn runtime_config_fixture() -> RuntimeConfig {
        let chain = ChainDefinition {
            id: 1,
            name: "mainnet".to_string(),
            entrypoint: "0x1234567890abcdef1234567890abcdef12345678".to_string(),
            asp_host: "https://asp.example".to_string(),
            relayer_host: "https://relayer.example".to_string(),
        };

        RuntimeConfig {
            chain_env_suffixes: HashMap::from([(1, "MAINNET".to_string())]),
            default_rpc_urls: HashMap::from([(1, vec!["https://default-rpc.example".to_string()])]),
            chain_names: vec!["mainnet".to_string()],
            mainnet_chain_names: vec!["mainnet".to_string()],
            native_asset_address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE".to_string(),
            known_pools: HashMap::new(),
            explorer_urls: HashMap::new(),
            chains: HashMap::from([("mainnet".to_string(), chain)]),
        }
    }

    fn manifest_fixture() -> Manifest {
        Manifest {
            manifest_version: "1.0.0".to_string(),
            runtime_version: "runtime/v1".to_string(),
            cli_version: "1.0.0".to_string(),
            json_schema_version: "1.7.0".to_string(),
            command_paths: vec![],
            alias_map: HashMap::new(),
            root_help: String::new(),
            structured_root_help: String::new(),
            help_text_by_path: HashMap::new(),
            guide_structured_text: String::new(),
            guide_human_text: String::new(),
            capabilities_human_text: String::new(),
            describe_human_text_by_path: HashMap::new(),
            completion_spec: CompletionCommandSpec {
                name: "privacy-pools".to_string(),
                aliases: vec![],
                options: vec![],
                subcommands: vec![],
            },
            completion_scripts: HashMap::new(),
            runtime_config: runtime_config_fixture(),
            routes: ManifestRoutes {
                help_command_paths: vec![],
                command_routes: HashMap::new(),
            },
            capabilities_payload: Value::Null,
        }
    }

    #[test]
    fn normalized_chain_env_suffix_upcases_and_sanitizes() {
        assert_eq!(normalized_chain_env_suffix("op-sepolia"), "OP_SEPOLIA");
        assert_eq!(normalized_chain_env_suffix("mainnet"), "MAINNET");
        assert_eq!(normalized_chain_env_suffix("arb.one"), "ARB_ONE");
    }

    #[test]
    fn resolve_host_override_prefers_chain_scoped_values() {
        let value = with_env(
            &[
                (
                    "PRIVACY_POOLS_ASP_HOST_MAINNET",
                    Some("https://chain.example"),
                ),
                ("PRIVACY_POOLS_ASP_HOST", Some("https://global.example")),
            ],
            || resolve_host_override("ASP_HOST", "mainnet"),
        );

        assert_eq!(value.as_deref(), Some("https://chain.example"));
    }

    #[test]
    fn apply_chain_overrides_updates_hosts() {
        let chain = runtime_config_fixture().chains["mainnet"].clone();
        let overridden = with_env(
            &[
                ("PP_ASP_HOST_MAINNET", Some("https://asp.override")),
                ("PP_RELAYER_HOST", Some("https://relayer.override")),
            ],
            || apply_chain_overrides(chain),
        );

        assert_eq!(overridden.asp_host, "https://asp.override");
        assert_eq!(overridden.relayer_host, "https://relayer.override");
    }

    #[test]
    fn config_home_prefers_privacy_pools_home_then_config_dir() {
        let home = with_env(
            &[
                ("PRIVACY_POOLS_HOME", Some("/tmp/pp-home")),
                ("PRIVACY_POOLS_CONFIG_DIR", Some("/tmp/pp-config")),
            ],
            config_home,
        );
        assert_eq!(home, PathBuf::from("/tmp/pp-home"));

        let config_dir = with_env(
            &[
                ("PRIVACY_POOLS_HOME", None),
                ("PRIVACY_POOLS_CONFIG_DIR", Some("/tmp/pp-config")),
            ],
            config_home,
        );
        assert_eq!(config_dir, PathBuf::from("/tmp/pp-config"));
    }

    #[test]
    fn load_config_returns_defaults_when_file_is_missing() {
        let temp_root = env::temp_dir().join("pp-native-config-missing");
        if temp_root.exists() {
            let _ = fs::remove_dir_all(&temp_root);
        }

        let config = with_env(
            &[(
                "PRIVACY_POOLS_HOME",
                Some(temp_root.to_string_lossy().as_ref()),
            )],
            load_config,
        )
        .expect("missing config should return defaults");

        assert_eq!(config.default_chain, "mainnet");
        assert!(config.rpc_overrides.is_empty());
    }

    #[test]
    fn load_config_parses_default_chain_and_rpc_overrides() {
        let temp_root = env::temp_dir().join("pp-native-config-valid");
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).unwrap();
        fs::write(
            temp_root.join("config.json"),
            r#"{"defaultChain":"sepolia","rpcOverrides":{"1":"https://rpc.example"}}"#,
        )
        .unwrap();

        let config = with_env(
            &[(
                "PRIVACY_POOLS_HOME",
                Some(temp_root.to_string_lossy().as_ref()),
            )],
            load_config,
        )
        .expect("valid config should parse");

        assert_eq!(config.default_chain, "sepolia");
        assert_eq!(
            config.rpc_overrides.get(&1).map(String::as_str),
            Some("https://rpc.example")
        );
    }

    #[test]
    fn load_config_rejects_invalid_rpc_override_values() {
        let temp_root = env::temp_dir().join("pp-native-config-invalid");
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(&temp_root).unwrap();
        fs::write(
            temp_root.join("config.json"),
            r#"{"defaultChain":"mainnet","rpcOverrides":{"1":123}}"#,
        )
        .unwrap();

        let error = with_env(
            &[(
                "PRIVACY_POOLS_HOME",
                Some(temp_root.to_string_lossy().as_ref()),
            )],
            load_config,
        )
        .expect_err("invalid rpc override should fail");

        assert_eq!(error.code, "INPUT_ERROR");
        assert!(error.message.contains("invalid value"));
    }

    #[test]
    fn resolve_rpc_env_var_prefers_chain_scoped_then_global() {
        let runtime_config = runtime_config_fixture();
        let scoped = with_env(
            &[
                (
                    "PRIVACY_POOLS_RPC_URL_MAINNET",
                    Some("https://scoped.example"),
                ),
                ("PRIVACY_POOLS_RPC_URL", Some("https://global.example")),
            ],
            || resolve_rpc_env_var(1, &runtime_config),
        );
        assert_eq!(scoped.as_deref(), Some("https://scoped.example"));

        let global = with_env(
            &[
                ("PRIVACY_POOLS_RPC_URL_MAINNET", None),
                ("PRIVACY_POOLS_RPC_URL", Some("https://global.example")),
            ],
            || resolve_rpc_env_var(1, &runtime_config),
        );
        assert_eq!(global.as_deref(), Some("https://global.example"));
    }

    #[test]
    fn get_rpc_urls_respects_override_precedence() {
        let runtime_config = runtime_config_fixture();
        let config = CliConfig {
            default_chain: "mainnet".to_string(),
            rpc_overrides: HashMap::from([(1, "https://config.example".to_string())]),
        };

        let from_flag = with_env(
            &[("PRIVACY_POOLS_RPC_URL_MAINNET", Some("https://env.example"))],
            || {
                get_rpc_urls(
                    1,
                    Some("https://flag.example".to_string()),
                    &config,
                    &runtime_config,
                )
            },
        )
        .expect("flag override should win");
        assert_eq!(from_flag, vec!["https://flag.example".to_string()]);

        let from_env = with_env(
            &[("PRIVACY_POOLS_RPC_URL_MAINNET", Some("https://env.example"))],
            || get_rpc_urls(1, None, &config, &runtime_config),
        )
        .expect("env override should win");
        assert_eq!(from_env, vec!["https://env.example".to_string()]);

        let from_config = with_env(&[("PRIVACY_POOLS_RPC_URL_MAINNET", None)], || {
            get_rpc_urls(1, None, &config, &runtime_config)
        })
        .expect("config override should win");
        assert_eq!(from_config, vec!["https://config.example".to_string()]);

        let from_default = with_env(
            &[
                ("PRIVACY_POOLS_RPC_URL_MAINNET", None),
                ("PP_RPC_URL_MAINNET", None),
                ("PRIVACY_POOLS_RPC_URL", None),
                ("PP_RPC_URL", None),
            ],
            || {
                get_rpc_urls(
                    1,
                    None,
                    &CliConfig {
                        default_chain: "mainnet".to_string(),
                        rpc_overrides: HashMap::new(),
                    },
                    &runtime_config,
                )
            },
        )
        .expect("default rpc should win");
        assert_eq!(
            from_default,
            vec!["https://default-rpc.example".to_string()]
        );
    }

    #[test]
    fn get_rpc_urls_errors_when_no_source_exists() {
        let mut runtime_config = runtime_config_fixture();
        runtime_config.default_rpc_urls.clear();
        let error = get_rpc_urls(
            1,
            None,
            &CliConfig {
                default_chain: "mainnet".to_string(),
                rpc_overrides: HashMap::new(),
            },
            &runtime_config,
        )
        .expect_err("missing rpc should fail");

        assert_eq!(error.code, "RPC_ERROR");
        assert!(error.message.contains("No RPC URL configured"));
    }

    #[test]
    fn resolve_chain_uses_manifest_runtime_config() {
        let manifest = manifest_fixture();
        let chain = resolve_chain("mainnet", &manifest).expect("chain should resolve");
        assert_eq!(chain.id, 1);

        let error = resolve_chain("unknown", &manifest).expect_err("unknown chain should fail");
        assert_eq!(error.code, "INPUT_ERROR");
        assert!(error.message.contains("Unsupported chain"));
    }
}
