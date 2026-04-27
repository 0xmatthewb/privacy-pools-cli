use super::helpers::{apply_pool_search, pool_listing_entry_to_resolution, sort_pools};
use super::model::{
    ChainSummary, NativePoolResolution, PoolDetailAccount, PoolDetailActivityEvent,
    PoolDetailMyFunds, PoolDetailRenderData, PoolListingEntry, PoolsCommandOptions,
};
use super::query_chain_selection::{all_chains_with_overrides, default_read_only_chains};
use super::query_execution::{
    apply_pools_chain_query_result, pools_worker_join_failure, query_pools_for_chain,
};
use super::query_resolution::list_pools_native;
use super::render::{render_pool_detail_output, render_pools_empty_output, render_pools_output};
use crate::bridge::capture_js_worker_stdout;
use crate::config::{get_rpc_urls, load_config, resolve_chain, resolve_rpc_env_var, CliConfig};
use crate::contract::{ChainDefinition, Manifest};
use crate::dispatch::{commander_too_many_arguments_error, commander_unknown_option_error};
use crate::error::{CliError, ErrorCategory};
use crate::output::start_spinner;
use crate::parse_timeout_ms;
use crate::root_argv::{
    is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option, ParsedRootArgv,
};
use crate::routing::resolve_mode;
use serde_json::Value;
pub(crate) fn handle_pools_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    {
        let mode = resolve_mode(parsed);
        if !mode.is_json() && !mode.is_csv() {
            if let Some(asset) = detail_asset_from_argv(argv) {
                return handle_pools_detail_native(argv, &mode, &asset);
            }
        }
        let opts = parse_pools_options(argv)?;
        let config = load_config()?;
        let timeout_ms = parse_timeout_ms(argv);
        let explicit_chain = parsed.global_chain();
        let rpc_override = parsed.global_rpc_url();
        let is_multi_chain = opts.all_chains || explicit_chain.is_none();

        if is_multi_chain && rpc_override.is_some() {
            return Err(CliError::input_with_code(
                "--rpc-url cannot be combined with multi-chain queries.",
                Some("Use --chain <name> to target a single chain with --rpc-url.".to_string()),
                "INPUT_FLAG_CONFLICT",
            ));
        }

        let chains_to_query = if opts.all_chains {
            all_chains_with_overrides(manifest)
        } else if let Some(chain_name) = explicit_chain {
            vec![resolve_chain(&chain_name, manifest)?]
        } else {
            default_read_only_chains(manifest)
        };
        let loading_message = if !mode.is_json() && !mode.is_quiet && !mode.is_csv() {
            Some(if is_multi_chain {
                "Fetching pools across chains...".to_string()
            } else {
                format!("Fetching pools for {}...", chains_to_query[0].name)
            })
        } else {
            None
        };
        let mut loading = loading_message.as_deref().map(start_spinner);

        let mut entries = Vec::<PoolListingEntry>::new();
        let mut warnings = Vec::<super::model::PoolWarning>::new();
        let mut chain_summaries = Vec::<ChainSummary>::new();
        let mut first_error: Option<CliError> = None;

        if is_multi_chain && chains_to_query.len() > 1 {
            let runtime_config = manifest.runtime_config.clone();
            let handles = chains_to_query
                .iter()
                .map(|chain| {
                    let chain = chain.clone();
                    let rpc_override = rpc_override.clone();
                    let config = config.clone();
                    let runtime_config = runtime_config.clone();
                    std::thread::spawn(move || {
                        query_pools_for_chain(
                            chain,
                            rpc_override,
                            config,
                            runtime_config,
                            timeout_ms,
                        )
                    })
                })
                .collect::<Vec<_>>();

            for (index, handle) in handles.into_iter().enumerate() {
                let result = match handle.join() {
                    Ok(result) => result,
                    Err(_) => pools_worker_join_failure(&chains_to_query[index].name),
                };
                apply_pools_chain_query_result(
                    result,
                    &mut entries,
                    &mut warnings,
                    &mut chain_summaries,
                    &mut first_error,
                );
                if let Some(spinner) = loading.as_mut() {
                    spinner.set_text(&format!(
                        "Fetching pools... ({}/{} chains done)",
                        index + 1,
                        chains_to_query.len()
                    ));
                }
            }
        } else {
            for chain in &chains_to_query {
                apply_pools_chain_query_result(
                    query_pools_for_chain(
                        chain.clone(),
                        rpc_override.clone(),
                        config.clone(),
                        manifest.runtime_config.clone(),
                        timeout_ms,
                    ),
                    &mut entries,
                    &mut warnings,
                    &mut chain_summaries,
                    &mut first_error,
                );
                if is_multi_chain && chains_to_query.len() > 1 {
                    let completed = chain_summaries.len();
                    if let Some(spinner) = loading.as_mut() {
                        spinner.set_text(&format!(
                            "Fetching pools... ({completed}/{total} chains done)",
                            total = chains_to_query.len()
                        ));
                    }
                }
            }
        }

        if entries.is_empty() {
            if let Some(error) = first_error {
                return Err(error);
            }

            if let Some(spinner) = loading.as_mut() {
                spinner.stop();
            }
            if is_multi_chain {
                render_pools_empty_output(
                    &mode,
                    super::model::PoolsRenderData {
                        all_chains: true,
                        chain_name: if opts.all_chains {
                            "all-chains".to_string()
                        } else {
                            "all-mainnets".to_string()
                        },
                        search: opts.search.clone(),
                        sort: opts.sort.clone(),
                        filtered_pools: vec![],
                        chain_summaries: Some(chain_summaries),
                        warnings,
                    },
                );
            } else {
                render_pools_empty_output(
                    &mode,
                    super::model::PoolsRenderData {
                        all_chains: false,
                        chain_name: chains_to_query[0].name.clone(),
                        search: opts.search.clone(),
                        sort: opts.sort.clone(),
                        filtered_pools: vec![],
                        chain_summaries: None,
                        warnings,
                    },
                );
            }
            return Ok(0);
        }

        let mut filtered = apply_pool_search(entries, opts.search.as_deref());
        sort_pools(&mut filtered, &opts.sort);
        if let Some(limit) = opts.limit {
            filtered.truncate(limit);
        }

        if let Some(spinner) = loading.as_mut() {
            spinner.stop();
        }
        render_pools_output(
            &mode,
            super::model::PoolsRenderData {
                all_chains: is_multi_chain,
                chain_name: if is_multi_chain {
                    if opts.all_chains {
                        "all-chains".to_string()
                    } else {
                        "all-mainnets".to_string()
                    }
                } else {
                    chains_to_query[0].name.clone()
                },
                search: opts.search,
                sort: opts.sort,
                filtered_pools: filtered,
                chain_summaries: if is_multi_chain {
                    Some(chain_summaries)
                } else {
                    None
                },
                warnings,
            },
        );

        Ok(0)
    }
}

fn handle_pools_detail_native(
    argv: &[String],
    mode: &crate::routing::NativeMode,
    _asset: &str,
) -> Result<i32, CliError> {
    let mut agent_argv = Vec::with_capacity(argv.len() + 1);
    agent_argv.push("--agent".to_string());
    agent_argv.extend(argv.iter().cloned());

    let stdout = capture_js_worker_stdout(&agent_argv)?;
    let payload: Value = serde_json::from_str(stdout.trim()).map_err(|error| {
        CliError::unknown(
            format!("Native pools detail bridge returned invalid JSON: {error}"),
            Some("Disable native mode and retry if the problem persists.".to_string()),
        )
    })?;

    if payload.get("success").and_then(Value::as_bool) != Some(true) {
        let message = payload
            .get("errorMessage")
            .and_then(Value::as_str)
            .unwrap_or("Unknown JS worker failure.");
        return Err(CliError::unknown(
            format!("Native pools detail bridge failed: {message}"),
            Some("Disable native mode and retry if the problem persists.".to_string()),
        ));
    }

    render_pool_detail_output(mode, parse_pool_detail_render_data(&payload)?);
    Ok(0)
}

fn detail_asset_from_argv(argv: &[String]) -> Option<String> {
    let mut positional = Vec::new();
    let mut index = argv
        .iter()
        .position(|token| token == "pools")
        .map(|value| value + 1)
        .unwrap_or(argv.len());

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            positional.extend(argv.iter().skip(index + 1).cloned());
            break;
        }
        if token == "--search" || token == "--sort" || is_command_global_value_option(token) {
            index += 2;
            continue;
        }
        if token.starts_with("--search=")
            || token.starts_with("--sort=")
            || is_command_global_inline_value_option(token)
            || is_command_global_boolean_option(token)
        {
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            return None;
        }
        positional.push(token.clone());
        index += 1;
    }

    if positional.len() == 1 && !matches!(positional[0].as_str(), "list" | "ls") {
        return positional.into_iter().next();
    }
    None
}

fn parse_pool_detail_render_data(payload: &Value) -> Result<PoolDetailRenderData, CliError> {
    let root = payload.as_object().ok_or_else(|| {
        CliError::unknown(
            "Native pools detail bridge returned a non-object payload.",
            Some("Disable native mode and retry if the problem persists.".to_string()),
        )
    })?;

    Ok(PoolDetailRenderData {
        chain_name: required_string(root, "chain")?,
        asset: required_string(root, "asset")?,
        token_address: required_string(root, "tokenAddress")?,
        pool: required_string(root, "pool")?,
        scope: required_string(root, "scope")?,
        decimals: root.get("decimals").and_then(Value::as_u64).unwrap_or(18) as u32,
        minimum_deposit: required_string(root, "minimumDeposit")?,
        vetting_fee_bps: required_string(root, "vettingFeeBPS")?,
        max_relay_fee_bps: required_string(root, "maxRelayFeeBPS")?,
        total_in_pool_value: optional_string(root, "totalInPoolValue"),
        total_in_pool_value_usd: optional_string(root, "totalInPoolValueUsd"),
        total_deposits_value: optional_string(root, "totalDepositsValue"),
        total_deposits_value_usd: optional_string(root, "totalDepositsValueUsd"),
        pending_deposits_value: optional_string(root, "pendingDepositsValue"),
        pending_deposits_value_usd: optional_string(root, "pendingDepositsValueUsd"),
        total_deposits_count: root.get("totalDepositsCount").and_then(Value::as_u64),
        my_funds: parse_pool_detail_my_funds(root.get("myFunds"))?,
        my_funds_warning: optional_string(root, "myFundsWarning"),
        recent_activity: parse_pool_detail_activity(root.get("recentActivity"))?,
    })
}

fn parse_pool_detail_my_funds(
    value: Option<&Value>,
) -> Result<Option<PoolDetailMyFunds>, CliError> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or_else(|| {
        CliError::unknown(
            "Native pools detail bridge returned malformed myFunds data.",
            Some("Disable native mode and retry if the problem persists.".to_string()),
        )
    })?;
    let accounts = object
        .get("accounts")
        .and_then(Value::as_array)
        .map(|accounts| {
            accounts
                .iter()
                .filter_map(|account| {
                    let item = account.as_object()?;
                    Some(PoolDetailAccount {
                        id: required_string(item, "id").ok()?,
                        status: required_string(item, "status").ok()?,
                        value: required_string(item, "value").ok()?,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(Some(PoolDetailMyFunds {
        balance: required_string(object, "balance")?,
        usd_value: optional_string(object, "usdValue"),
        pool_accounts: object
            .get("poolAccounts")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        pending_count: object
            .get("pendingCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        poa_required_count: object
            .get("poaRequiredCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        declined_count: object
            .get("declinedCount")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        accounts,
    }))
}

fn parse_pool_detail_activity(
    value: Option<&Value>,
) -> Result<Option<Vec<PoolDetailActivityEvent>>, CliError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some(items) = value.as_array() else {
        return Ok(None);
    };
    Ok(Some(
        items
            .iter()
            .filter_map(|item| {
                let object = item.as_object()?;
                Some(PoolDetailActivityEvent {
                    event_type: required_string(object, "type").ok()?,
                    amount: object
                        .get("amount")
                        .and_then(Value::as_str)
                        .unwrap_or("-")
                        .to_string(),
                    time_label: object
                        .get("timeLabel")
                        .and_then(Value::as_str)
                        .unwrap_or("-")
                        .to_string(),
                    status: object
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown")
                        .to_string(),
                })
            })
            .collect::<Vec<_>>(),
    ))
}

fn required_string(object: &serde_json::Map<String, Value>, key: &str) -> Result<String, CliError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| {
            CliError::unknown(
                format!("Native pools detail bridge omitted required field '{key}'."),
                Some("Disable native mode and retry if the problem persists.".to_string()),
            )
        })
}

fn optional_string(object: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
}
pub(crate) fn resolve_pool_native(
    chain: &ChainDefinition,
    asset: &str,
    rpc_override: Option<String>,
    config: &CliConfig,
    manifest: &Manifest,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    let rpc_urls = get_rpc_urls(
        chain.id,
        rpc_override.clone(),
        config,
        &manifest.runtime_config,
    )?;
    if crate::commands::pools::rpc::is_hex_address(asset) {
        return super::rpc::resolve_pool_from_asset_address_native(
            chain,
            asset,
            &rpc_urls,
            &manifest.runtime_config.native_asset_address,
            timeout_ms,
        )
        .map_err(|error| {
            if matches!(error.category, ErrorCategory::Rpc) {
                return CliError::rpc_retryable(
                    format!(
                        "Failed to resolve pool for {asset} on {} due to RPC error.",
                        chain.name
                    ),
                    Some("Check your RPC URL and network connectivity, then retry.".to_string()),
                    Some("RPC_POOL_RESOLUTION_FAILED"),
                );
            }
            error
        });
    }

    let normalized = asset.to_uppercase();
    let mut available_assets_hint: Option<String> = None;
    let mut asp_lookup_failed = false;

    match list_pools_native(
        chain,
        rpc_override.clone(),
        config,
        &manifest.runtime_config,
        timeout_ms,
    ) {
        Ok(entries) => {
            if let Some(entry) = entries
                .iter()
                .find(|entry| entry.asset.eq_ignore_ascii_case(&normalized))
            {
                return Ok(pool_listing_entry_to_resolution(entry));
            }

            let available_assets = entries
                .iter()
                .map(|entry| entry.asset.clone())
                .collect::<Vec<_>>();
            if !available_assets.is_empty() {
                available_assets_hint = Some(available_assets.join(", "));
            }
        }
        Err(error) => {
            if !matches!(error.category, ErrorCategory::Asp) {
                return Err(error);
            }
            asp_lookup_failed = true;
        }
    }

    if let Some(known_asset_address) = manifest
        .runtime_config
        .known_pools
        .get(&chain.id)
        .and_then(|pools| pools.get(&normalized))
        .cloned()
    {
        match super::rpc::resolve_pool_from_asset_address_native(
            chain,
            &known_asset_address,
            &rpc_urls,
            &manifest.runtime_config.native_asset_address,
            timeout_ms,
        ) {
            Ok(resolution) => return Ok(resolution),
            Err(error) => {
                if asp_lookup_failed
                    && has_custom_rpc_override(chain.id, rpc_override.as_deref(), config, manifest)
                {
                    // Match the JS launcher: when both ASP lookup and a custom RPC fallback
                    // fail for a symbol, keep the actionable "unknown asset / ASP may be
                    // offline" guidance instead of surfacing the lower-level RPC failure.
                } else if matches!(error.category, ErrorCategory::Rpc) {
                    return Err(CliError::rpc_retryable(
                        format!(
                            "Built-in pool fallback also failed for \"{asset}\" on {}.",
                            chain.name
                        ),
                        Some(
                            "Check your RPC URL and network connectivity, then retry.".to_string(),
                        ),
                        Some("RPC_POOL_RESOLUTION_FAILED"),
                    ));
                } else {
                    return Err(error);
                }
            }
        }
    }

    Err(pool_not_found_error(
        chain,
        asset,
        asp_lookup_failed,
        available_assets_hint,
    ))
}

fn has_custom_rpc_override(
    chain_id: u64,
    rpc_override: Option<&str>,
    config: &CliConfig,
    manifest: &Manifest,
) -> bool {
    rpc_override
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        || resolve_rpc_env_var(chain_id, &manifest.runtime_config).is_some()
        || config.rpc_overrides.contains_key(&chain_id)
}

fn pool_not_found_error(
    chain: &ChainDefinition,
    asset: &str,
    asp_lookup_failed: bool,
    available_assets_hint: Option<String>,
) -> CliError {
    CliError::input_with_code(
        format!("No pool found for asset \"{asset}\" on {}.", chain.name),
        Some(if asp_lookup_failed {
            "The ASP may be offline. Try using the token contract address as the positional asset (0x...)."
                .to_string()
        } else if let Some(hint) = available_assets_hint {
            format!("Available assets: {hint}")
        } else {
            "No pools found. Try using the token contract address as the positional asset."
                .to_string()
        }),
        "INPUT_UNKNOWN_ASSET",
    )
}

fn parse_pools_options(argv: &[String]) -> Result<PoolsCommandOptions, CliError> {
    let mut all_chains = false;
    let mut limit = None;
    let mut search = None;
    let mut sort = None;
    let mut unexpected_args = 0;
    let mut index = argv
        .iter()
        .position(|token| token == "pools")
        .map(|value| value + 1)
        .unwrap_or(argv.len());

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            unexpected_args += argv.len().saturating_sub(index + 1);
            break;
        }
        if token == "--include-testnets" {
            all_chains = true;
            index += 1;
            continue;
        }
        if (token == "list" || token == "ls") && unexpected_args == 0 {
            index += 1;
            continue;
        }
        if token == "--search" {
            search = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--search=") {
            search = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--sort" {
            sort = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--sort=") {
            sort = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--limit" {
            limit = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--limit=") {
            limit = Some(value.to_string());
            index += 1;
            continue;
        }
        if is_command_global_value_option(token) {
            index += 2;
            continue;
        }
        if is_command_global_inline_value_option(token) || is_command_global_boolean_option(token) {
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            return Err(commander_unknown_option_error(token));
        }
        unexpected_args += 1;
        index += 1;
    }

    if unexpected_args > 0 {
        return Err(commander_too_many_arguments_error(
            "pools",
            1,
            unexpected_args,
        ));
    }

    let sort_value = sort
        .unwrap_or_else(|| "tvl-desc".to_string())
        .to_lowercase();
    let supported = [
        "asset-asc",
        "asset-desc",
        "tvl-desc",
        "tvl-asc",
        "deposits-desc",
        "deposits-asc",
        "chain-asset",
        "default",
    ];
    if !supported.contains(&sort_value.as_str()) {
        return Err(CliError::input(
            format!("Invalid --sort value: {sort_value}."),
            Some(format!("Use one of: {}.", supported.join(", "))),
        ));
    }
    let parsed_limit = match limit {
        Some(raw) => match raw.parse::<usize>() {
            Ok(value) if value > 0 => Some(value),
            _ => {
                return Err(CliError::input_with_code(
                    format!("Invalid --limit value: {raw}."),
                    Some("--limit must be a positive integer.".to_string()),
                    "INPUT_INVALID_VALUE",
                ));
            }
        },
        None => None,
    };

    Ok(PoolsCommandOptions {
        all_chains,
        limit: parsed_limit,
        search: search
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        sort: sort_value,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        detail_asset_from_argv, handle_pools_native, parse_pools_options, resolve_pool_native,
    };
    use crate::config::CliConfig;
    use crate::contract::{manifest, ChainDefinition, Manifest};
    use crate::error::ErrorCategory;
    use crate::root_argv::parse_root_argv;
    use std::collections::HashMap;

    fn cli_config() -> CliConfig {
        CliConfig {
            default_chain: "mainnet".to_string(),
            rpc_overrides: HashMap::new(),
        }
    }

    fn manifest_and_chain(chain_name: &str) -> (Manifest, ChainDefinition) {
        let manifest = manifest().clone();
        let chain = manifest
            .runtime_config
            .chains
            .get(chain_name)
            .cloned()
            .expect("chain should exist in manifest");
        (manifest, chain)
    }

    #[test]
    fn handle_pools_native_rejects_multi_chain_custom_rpc_queries() {
        let argv = vec![
            "privacy-pools".to_string(),
            "--rpc-url".to_string(),
            "https://rpc.example".to_string(),
            "pools".to_string(),
        ];
        let parsed = parse_root_argv(&argv);
        let error = handle_pools_native(&argv, &parsed, manifest())
            .expect_err("multi-chain custom rpc should fail");
        assert_eq!(error.code, "INPUT_FLAG_CONFLICT");
        assert!(error.message.contains("--rpc-url"));
    }

    #[test]
    fn parse_pools_options_supports_inline_values_and_global_flags() {
        let options = parse_pools_options(&[
            "privacy-pools".to_string(),
            "--chain".to_string(),
            "sepolia".to_string(),
            "--output=json".to_string(),
            "--quiet".to_string(),
            "pools".to_string(),
            "--include-testnets".to_string(),
            "--search= eth  ".to_string(),
            "--sort".to_string(),
            "CHAIN-ASSET".to_string(),
        ])
        .expect("options should parse");

        assert!(options.all_chains);
        assert_eq!(options.search.as_deref(), Some("eth"));
        assert_eq!(options.sort, "chain-asset");

        let defaults = parse_pools_options(&["privacy-pools".to_string(), "pools".to_string()])
            .expect("default options should parse");
        assert_eq!(defaults.search, None);
        assert_eq!(defaults.sort, "tvl-desc");
    }

    #[test]
    fn parse_pools_options_rejects_invalid_sort_unknown_flags_and_extra_args() {
        let invalid_sort = parse_pools_options(&[
            "privacy-pools".to_string(),
            "pools".to_string(),
            "--sort".to_string(),
            "weird".to_string(),
        ])
        .expect_err("invalid sort should fail");
        assert_eq!(invalid_sort.code, "INPUT_ERROR");
        assert!(invalid_sort.message.contains("Invalid --sort value"));

        let unknown = parse_pools_options(&[
            "privacy-pools".to_string(),
            "pools".to_string(),
            "--mystery".to_string(),
        ])
        .expect_err("unknown option should fail");
        assert_eq!(unknown.category, ErrorCategory::Input);
        assert!(unknown.message.contains("unknown option"));

        let extra = parse_pools_options(&[
            "privacy-pools".to_string(),
            "pools".to_string(),
            "--".to_string(),
            "unexpected".to_string(),
        ])
        .expect_err("extra args should fail");
        assert_eq!(extra.category, ErrorCategory::Input);
        assert!(extra.message.contains("too many arguments"));
    }

    #[test]
    fn detail_asset_detection_ignores_search_and_sort_option_values() {
        assert_eq!(
            detail_asset_from_argv(&[
                "privacy-pools".to_string(),
                "pools".to_string(),
                "ETH".to_string(),
            ]),
            Some("ETH".to_string())
        );
        assert_eq!(
            detail_asset_from_argv(&[
                "privacy-pools".to_string(),
                "--chain".to_string(),
                "sepolia".to_string(),
                "pools".to_string(),
                "--search".to_string(),
                "ZZZ".to_string(),
            ]),
            None
        );
        assert_eq!(
            detail_asset_from_argv(&[
                "privacy-pools".to_string(),
                "pools".to_string(),
                "--sort=chain-asset".to_string(),
                "--search=ETH".to_string(),
            ]),
            None
        );
    }

    #[test]
    fn resolve_pool_native_maps_direct_rpc_failures_to_retryable_errors() {
        let (mut manifest, chain) = manifest_and_chain("mainnet");
        manifest
            .runtime_config
            .default_rpc_urls
            .insert(chain.id, vec!["http://127.0.0.1:1".to_string()]);

        let error = resolve_pool_native(
            &chain,
            "0x1111111111111111111111111111111111111111",
            None,
            &cli_config(),
            &manifest,
            100,
        )
        .expect_err("bad rpc should fail");

        assert_eq!(error.code, "RPC_POOL_RESOLUTION_FAILED");
        assert!(error.retryable);
        assert!(error.message.contains("Failed to resolve pool"));
    }

    #[test]
    fn resolve_pool_native_returns_asp_hint_for_custom_rpc_symbol_lookup_failures() {
        let (mut manifest, mut chain) = manifest_and_chain("mainnet");
        manifest
            .runtime_config
            .known_pools
            .entry(chain.id)
            .or_default()
            .remove("MISSING");
        chain.asp_host = "http://127.0.0.1:1".to_string();

        let error = resolve_pool_native(
            &chain,
            "MISSING",
            Some("http://127.0.0.1:1".to_string()),
            &cli_config(),
            &manifest,
            100,
        )
        .expect_err("asp lookup failure should surface an input hint");

        assert_eq!(error.code, "INPUT_UNKNOWN_ASSET");
        assert!(error
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("ASP may be offline"));
    }
}
