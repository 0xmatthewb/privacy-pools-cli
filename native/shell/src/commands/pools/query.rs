use super::helpers::{
    apply_pool_search, deduplicate_pool_entries, normalize_pool_stats_entries,
    parse_json_decimal_string, parse_json_number, parse_json_string,
    pool_listing_entry_to_resolution, pool_resolution_worker_join_failure,
    prepare_pool_resolution_inputs, sort_pools,
};
use super::model::{
    ChainSummary, NativePoolResolution, PoolListingEntry, PoolStatsResolutionInput,
    PoolsChainQueryResult, PoolsCommandOptions,
};
use super::render::{render_pools_empty_output, render_pools_output};
use super::rpc::resolve_cached_pool_resolution;
use crate::config::{
    apply_chain_overrides, get_rpc_urls, has_custom_rpc_override, load_config, resolve_chain,
    CliConfig,
};
use crate::contract::{ChainDefinition, Manifest, RuntimeConfig};
use crate::dispatch::{commander_too_many_arguments_error, commander_unknown_option_error};
use crate::error::{CliError, ErrorCategory};
use crate::parse_timeout_ms;
use crate::read_only_api::fetch_pools_stats;
use crate::root_argv::{
    is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option, ParsedRootArgv,
};
use crate::routing::resolve_mode;

pub(crate) fn handle_pools_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    let mode = resolve_mode(parsed);
    let opts = parse_pools_options(argv)?;
    let config = load_config()?;
    let timeout_ms = parse_timeout_ms(argv);
    let explicit_chain = parsed.global_chain();
    let rpc_override = parsed.global_rpc_url();
    let is_multi_chain = opts.all_chains || explicit_chain.is_none();

    if is_multi_chain && rpc_override.is_some() {
        return Err(CliError::input(
            "--rpc-url cannot be combined with multi-chain queries.",
            Some("Use --chain <name> to target a single chain with --rpc-url.".to_string()),
        ));
    }

    let chains_to_query = if opts.all_chains {
        all_chains_with_overrides(manifest)
    } else if let Some(chain_name) = explicit_chain {
        vec![resolve_chain(&chain_name, manifest)?]
    } else {
        default_read_only_chains(manifest)
    };
    if !mode.is_json() && !mode.is_quiet && !mode.is_csv() {
        let message = if is_multi_chain {
            "- Fetching pools across chains...".to_string()
        } else {
            format!("- Fetching pools for {}...", chains_to_query[0].name)
        };
        crate::output::write_stderr_text(&message);
    }

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
                    query_pools_for_chain(chain, rpc_override, config, runtime_config, timeout_ms)
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
        }
    }

    if entries.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }

        if is_multi_chain {
            render_pools_empty_output(
                &mode,
                super::model::PoolsRenderData {
                    all_chains: true,
                    chain_name: String::new(),
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

    render_pools_output(
        &mode,
        super::model::PoolsRenderData {
            all_chains: is_multi_chain,
            chain_name: if is_multi_chain {
                String::new()
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

pub(crate) fn default_read_only_chains(manifest: &Manifest) -> Vec<ChainDefinition> {
    manifest
        .runtime_config
        .mainnet_chain_names
        .iter()
        .filter_map(|name| manifest.runtime_config.chains.get(name))
        .cloned()
        .map(apply_chain_overrides)
        .collect()
}

pub(crate) fn resolve_pool_native(
    chain: &ChainDefinition,
    asset: &str,
    rpc_override: Option<String>,
    config: &CliConfig,
    manifest: &Manifest,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    let has_custom_rpc = has_custom_rpc_override(
        chain.id,
        rpc_override.as_deref(),
        config,
        &manifest.runtime_config,
    );
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
                if !has_custom_rpc {
                    return Err(error);
                }
            }
        }
    }

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

    if has_custom_rpc {
        return Err(CliError::input(
            format!("No pool found for asset \"{asset}\" on {}.", chain.name),
            Some(if asp_lookup_failed {
                "The ASP may be offline. Try using --asset with a token contract address (0x...)."
                    .to_string()
            } else if let Some(hint) = available_assets_hint {
                format!("Available assets: {hint}")
            } else {
                "No pools found. Try using --asset with a contract address.".to_string()
            }),
        ));
    }

    let Some(known_asset_address) = manifest
        .runtime_config
        .known_pools
        .get(&chain.id)
        .and_then(|pools| pools.get(&normalized))
        .cloned()
    else {
        return Err(CliError::input(
            format!("No pool found for asset \"{asset}\" on {}.", chain.name),
            Some(if asp_lookup_failed {
                "The ASP may be offline. Try using --asset with a token contract address (0x...)."
                    .to_string()
            } else if let Some(hint) = available_assets_hint {
                format!("Available assets: {hint}")
            } else {
                "No pools found. Try using --asset with a contract address.".to_string()
            }),
        ));
    };

    super::rpc::resolve_pool_from_asset_address_native(
        chain,
        &known_asset_address,
        &rpc_urls,
        &manifest.runtime_config.native_asset_address,
        timeout_ms,
    )
    .map_err(|error| {
        if matches!(error.category, ErrorCategory::Rpc) {
            return CliError::rpc_retryable(
                format!(
                    "Built-in pool fallback also failed for \"{asset}\" on {}.",
                    chain.name
                ),
                Some("Check your RPC URL and network connectivity, then retry.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            );
        }
        error
    })
}

fn query_pools_for_chain(
    chain: ChainDefinition,
    rpc_override: Option<String>,
    config: CliConfig,
    runtime_config: RuntimeConfig,
    timeout_ms: u64,
) -> PoolsChainQueryResult {
    match list_pools_native(&chain, rpc_override, &config, &runtime_config, timeout_ms) {
        Ok(chain_entries) => PoolsChainQueryResult {
            summary: ChainSummary {
                chain: chain.name,
                pools: chain_entries.len(),
                error: None,
            },
            entries: chain_entries,
            warning: None,
            error: None,
        },
        Err(error) => {
            let message = error.message.clone();
            PoolsChainQueryResult {
                entries: vec![],
                warning: Some(super::model::PoolWarning {
                    chain: chain.name.clone(),
                    category: error.category.as_str().to_string(),
                    message: message.clone(),
                }),
                summary: ChainSummary {
                    chain: chain.name,
                    pools: 0,
                    error: Some(message),
                },
                error: Some(error),
            }
        }
    }
}

fn apply_pools_chain_query_result(
    result: PoolsChainQueryResult,
    entries: &mut Vec<PoolListingEntry>,
    warnings: &mut Vec<super::model::PoolWarning>,
    chain_summaries: &mut Vec<ChainSummary>,
    first_error: &mut Option<CliError>,
) {
    chain_summaries.push(result.summary);
    entries.extend(result.entries);
    if let Some(warning) = result.warning {
        warnings.push(warning);
    }
    if first_error.is_none() {
        *first_error = result.error;
    }
}

fn pools_worker_join_failure(chain_name: &str) -> PoolsChainQueryResult {
    let error = CliError::unknown(
        format!("Failed to resolve pools on {chain_name}."),
        Some("Retry the command. If the issue persists, reinstall the CLI and retry.".to_string()),
    );
    PoolsChainQueryResult {
        entries: vec![],
        warning: Some(super::model::PoolWarning {
            chain: chain_name.to_string(),
            category: error.category.as_str().to_string(),
            message: error.message.clone(),
        }),
        summary: ChainSummary {
            chain: chain_name.to_string(),
            pools: 0,
            error: Some(error.message.clone()),
        },
        error: Some(error),
    }
}

fn parse_pools_options(argv: &[String]) -> Result<PoolsCommandOptions, CliError> {
    let mut all_chains = false;
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
        if token == "--all-chains" {
            all_chains = true;
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

    Ok(PoolsCommandOptions {
        all_chains,
        search: search
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        sort: sort_value,
    })
}

fn all_chains_with_overrides(manifest: &Manifest) -> Vec<ChainDefinition> {
    manifest
        .runtime_config
        .chain_names
        .iter()
        .filter_map(|name| manifest.runtime_config.chains.get(name))
        .cloned()
        .map(apply_chain_overrides)
        .collect()
}

fn list_pools_native(
    chain: &ChainDefinition,
    rpc_override: Option<String>,
    config: &CliConfig,
    runtime_config: &RuntimeConfig,
    timeout_ms: u64,
) -> Result<Vec<PoolListingEntry>, CliError> {
    let stats_data = fetch_pools_stats(chain, timeout_ms).map_err(|_| {
        CliError::asp(
            format!("Cannot reach ASP ({}) to discover pools.", chain.asp_host),
            Some("Check your network connection, or try again later.".to_string()),
            None,
            false,
        )
    })?;
    let stats_entries = normalize_pool_stats_entries(&stats_data);
    if stats_entries.is_empty() {
        return Err(CliError::asp(
            format!("Cannot reach ASP ({}) to discover pools.", chain.asp_host),
            Some("Check your network connection, or try again later.".to_string()),
            None,
            false,
        ));
    }

    let rpc_urls = get_rpc_urls(chain.id, rpc_override, config, runtime_config)?;
    let resolution_inputs = prepare_pool_resolution_inputs(stats_entries, chain.id);
    let mut entries = vec![];
    let mut rpc_read_failures = 0usize;

    for chunk in resolution_inputs.chunks(super::model::POOL_RESOLUTION_BATCH_SIZE) {
        let handles = chunk
            .iter()
            .map(|input| {
                let chain = chain.clone();
                let input = input.clone();
                let rpc_urls = rpc_urls.clone();
                let native_asset_address = runtime_config.native_asset_address.clone();
                std::thread::spawn(move || {
                    resolve_pool_listing_entry(
                        chain,
                        input,
                        rpc_urls,
                        native_asset_address,
                        timeout_ms,
                    )
                })
            })
            .collect::<Vec<_>>();

        for handle in handles {
            let resolved_entry = match handle.join() {
                Ok(result) => result,
                Err(_) => Err(pool_resolution_worker_join_failure(&chain.name)),
            };

            match resolved_entry {
                Ok(entry) => entries.push(entry),
                Err(error) if matches!(error.category, ErrorCategory::Rpc) => {
                    rpc_read_failures += 1;
                }
                Err(error) => return Err(error),
            }
        }
    }

    if entries.is_empty() && rpc_read_failures > 0 {
        return Err(CliError::rpc_retryable(
            format!(
                "Failed to resolve pools on {} due to RPC errors.",
                chain.name
            ),
            Some("Check your RPC URL and network connectivity, then retry.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    Ok(deduplicate_pool_entries(entries))
}

fn resolve_pool_listing_entry(
    chain: ChainDefinition,
    input: PoolStatsResolutionInput,
    rpc_urls: Vec<String>,
    native_asset_address: String,
    timeout_ms: u64,
) -> Result<PoolListingEntry, CliError> {
    let resolved = resolve_cached_pool_resolution(
        &chain,
        &input.asset_address,
        &rpc_urls,
        &native_asset_address,
        timeout_ms,
    )?;

    Ok(PoolListingEntry {
        chain: chain.name.clone(),
        chain_id: chain.id,
        asset: resolved.token_metadata.symbol,
        token_address: input.asset_address,
        pool: resolved.asset_config.pool_address,
        scope: resolved.scope,
        decimals: resolved.token_metadata.decimals,
        minimum_deposit: resolved.asset_config.minimum_deposit_amount,
        vetting_fee_bps: resolved.asset_config.vetting_fee_bps,
        max_relay_fee_bps: resolved.asset_config.max_relay_fee_bps,
        total_in_pool_value: parse_json_decimal_string(input.stats_entry.get("totalInPoolValue")),
        total_in_pool_value_usd: parse_json_string(input.stats_entry.get("totalInPoolValueUsd")),
        total_deposits_value: parse_json_decimal_string(
            input.stats_entry.get("totalDepositsValue"),
        ),
        total_deposits_value_usd: parse_json_string(input.stats_entry.get("totalDepositsValueUsd")),
        accepted_deposits_value: parse_json_decimal_string(
            input.stats_entry.get("acceptedDepositsValue"),
        ),
        accepted_deposits_value_usd: parse_json_string(
            input.stats_entry.get("acceptedDepositsValueUsd"),
        ),
        pending_deposits_value: parse_json_decimal_string(
            input.stats_entry.get("pendingDepositsValue"),
        ),
        pending_deposits_value_usd: parse_json_string(
            input.stats_entry.get("pendingDepositsValueUsd"),
        ),
        total_deposits_count: crate::json::parse_json_u64(
            input.stats_entry.get("totalDepositsCount"),
        ),
        accepted_deposits_count: crate::json::parse_json_u64(
            input.stats_entry.get("acceptedDepositsCount"),
        ),
        pending_deposits_count: crate::json::parse_json_u64(
            input.stats_entry.get("pendingDepositsCount"),
        ),
        growth24h: parse_json_number(input.stats_entry.get("growth24h")),
        pending_growth24h: parse_json_number(input.stats_entry.get("pendingGrowth24h")),
    })
}
