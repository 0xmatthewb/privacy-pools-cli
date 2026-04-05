use crate::config::{
    apply_chain_overrides, get_rpc_urls, has_custom_rpc_override, load_config, resolve_chain,
    CliConfig,
};
use crate::contract::{ChainDefinition, Manifest, RuntimeConfig};
use crate::dispatch::{commander_too_many_arguments_error, commander_unknown_option_error};
use crate::error::{CliError, ErrorCategory};
use crate::http_client::http_post_json;
use crate::json::{json_numberish, parse_json_u64};
use crate::output::{
    format_count_number, insert_optional_f64, insert_optional_string, insert_optional_u64,
    print_csv, print_json_success, print_table, write_info, write_stderr_text, write_warn,
};
use crate::parse_timeout_ms;
use crate::read_only_api::fetch_pools_stats;
use crate::root_argv::{
    is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option, ParsedRootArgv,
};
use crate::routing::{resolve_mode, NativeMode};
use num_bigint::BigUint;
use num_traits::{ToPrimitive, Zero};
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Mutex, OnceLock};
use tiny_keccak::{Hasher, Keccak};

const POOL_RESOLUTION_BATCH_SIZE: usize = 4;

#[derive(Debug, Clone)]
struct PoolsCommandOptions {
    all_chains: bool,
    search: Option<String>,
    sort: String,
}

#[derive(Debug, Clone)]
struct PoolListingEntry {
    chain: String,
    chain_id: u64,
    asset: String,
    token_address: String,
    pool: String,
    scope: String,
    decimals: u32,
    minimum_deposit: String,
    vetting_fee_bps: String,
    max_relay_fee_bps: String,
    total_in_pool_value: Option<String>,
    total_in_pool_value_usd: Option<String>,
    total_deposits_value: Option<String>,
    total_deposits_value_usd: Option<String>,
    accepted_deposits_value: Option<String>,
    accepted_deposits_value_usd: Option<String>,
    pending_deposits_value: Option<String>,
    pending_deposits_value_usd: Option<String>,
    total_deposits_count: Option<u64>,
    accepted_deposits_count: Option<u64>,
    pending_deposits_count: Option<u64>,
    growth24h: Option<f64>,
    pending_growth24h: Option<f64>,
}

#[derive(Debug, Clone)]
struct PoolWarning {
    chain: String,
    category: String,
    message: String,
}

#[derive(Debug, Clone)]
struct ChainSummary {
    chain: String,
    pools: usize,
    error: Option<String>,
}

struct PoolsChainQueryResult {
    entries: Vec<PoolListingEntry>,
    warning: Option<PoolWarning>,
    summary: ChainSummary,
    error: Option<CliError>,
}

#[derive(Debug, Clone)]
struct PoolStatsResolutionInput {
    stats_entry: Map<String, Value>,
    asset_address: String,
}

#[derive(Debug, Clone)]
struct PoolsRenderData {
    all_chains: bool,
    chain_name: String,
    search: Option<String>,
    sort: String,
    filtered_pools: Vec<PoolListingEntry>,
    chain_summaries: Option<Vec<ChainSummary>>,
    warnings: Vec<PoolWarning>,
}

#[derive(Debug, Clone)]
pub(crate) struct NativePoolResolution {
    pub(crate) symbol: String,
    pub(crate) pool_address: String,
    pub(crate) scope: String,
}

#[derive(Debug, Clone)]
struct AssetConfigResult {
    pool_address: String,
    minimum_deposit_amount: String,
    vetting_fee_bps: String,
    max_relay_fee_bps: String,
}

#[derive(Debug, Clone)]
struct TokenMetadataResult {
    symbol: String,
    decimals: u32,
}

#[derive(Debug, Clone)]
struct TokenMetadataLookupResult {
    metadata: TokenMetadataResult,
    cacheable: bool,
}

#[derive(Debug, Clone)]
struct PoolResolutionCacheEntry {
    asset_config: AssetConfigResult,
    scope: String,
    token_metadata: TokenMetadataResult,
}

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
        write_stderr_text(&message);
    }

    let mut entries = Vec::<PoolListingEntry>::new();
    let mut warnings = Vec::<PoolWarning>::new();
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
                PoolsRenderData {
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
                PoolsRenderData {
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
        PoolsRenderData {
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
    if is_hex_address(asset) {
        return resolve_pool_from_asset_address_native(
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
        match resolve_pool_from_asset_address_native(
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

    resolve_pool_from_asset_address_native(
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
                warning: Some(PoolWarning {
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
    warnings: &mut Vec<PoolWarning>,
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
        warning: Some(PoolWarning {
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

    for chunk in resolution_inputs.chunks(POOL_RESOLUTION_BATCH_SIZE) {
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

fn normalize_pool_stats_entries(stats_data: &Value) -> Vec<Map<String, Value>> {
    if let Some(array) = stats_data.as_array() {
        return array
            .iter()
            .filter_map(|entry| entry.as_object().cloned())
            .collect();
    }

    if let Some(object) = stats_data.as_object() {
        if let Some(pools) = object.get("pools").and_then(Value::as_array) {
            return pools
                .iter()
                .filter_map(|entry| entry.as_object().cloned())
                .collect();
        }

        return object
            .iter()
            .filter_map(|(key, value)| {
                if key == "pools" {
                    None
                } else {
                    value.as_object().cloned()
                }
            })
            .collect();
    }

    vec![]
}

fn resolve_pool_asset_address(entry: &Map<String, Value>) -> Option<String> {
    entry
        .get("assetAddress")
        .and_then(Value::as_str)
        .or_else(|| entry.get("tokenAddress").and_then(Value::as_str))
        .filter(|value| is_hex_address(value))
        .map(|value| value.to_string())
}

fn resolve_pool_stats_pool_address(entry: &Map<String, Value>) -> Option<String> {
    entry
        .get("poolAddress")
        .and_then(Value::as_str)
        .or_else(|| entry.get("pool").and_then(Value::as_str))
        .filter(|value| is_hex_address(value))
        .map(|value| value.to_string())
}

fn prepare_pool_resolution_inputs(
    stats_entries: Vec<Map<String, Value>>,
    chain_id: u64,
) -> Vec<PoolStatsResolutionInput> {
    let mut seen = BTreeSet::new();
    let mut prepared = vec![];

    for stats_entry in stats_entries {
        if let Some(entry_chain_id) = parse_json_u64(stats_entry.get("chainId")) {
            if entry_chain_id != chain_id {
                continue;
            }
        }

        let dedupe_key = resolve_pool_stats_pool_address(&stats_entry)
            .map(|address| format!("pool:{}", address.to_lowercase()))
            .or_else(|| {
                resolve_pool_asset_address(&stats_entry)
                    .map(|address| format!("asset:{}", address.to_lowercase()))
            });
        if let Some(key) = dedupe_key {
            if !seen.insert(key) {
                continue;
            }
        }

        let Some(asset_address) = resolve_pool_asset_address(&stats_entry) else {
            continue;
        };

        prepared.push(PoolStatsResolutionInput {
            stats_entry,
            asset_address,
        });
    }

    prepared
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
        total_deposits_count: parse_json_u64(input.stats_entry.get("totalDepositsCount")),
        accepted_deposits_count: parse_json_u64(input.stats_entry.get("acceptedDepositsCount")),
        pending_deposits_count: parse_json_u64(input.stats_entry.get("pendingDepositsCount")),
        growth24h: parse_json_number(input.stats_entry.get("growth24h")),
        pending_growth24h: parse_json_number(input.stats_entry.get("pendingGrowth24h")),
    })
}

fn pool_resolution_worker_join_failure(chain_name: &str) -> CliError {
    CliError::unknown(
        format!("Failed to resolve pools on {chain_name}."),
        Some("Retry the command. If the issue persists, reinstall the CLI and retry.".to_string()),
    )
}

fn parse_json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(|value| value.to_string())
}

fn parse_json_decimal_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(string)) if is_decimal_string(string) => Some(string.to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

fn parse_json_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(json_numberish)
}

fn deduplicate_pool_entries(entries: Vec<PoolListingEntry>) -> Vec<PoolListingEntry> {
    let mut seen = BTreeSet::new();
    let mut deduped = vec![];
    for entry in entries {
        let key = entry.pool.to_lowercase();
        if seen.insert(key) {
            deduped.push(entry);
        }
    }
    deduped
}

fn apply_pool_search(entries: Vec<PoolListingEntry>, query: Option<&str>) -> Vec<PoolListingEntry> {
    let Some(query) = query else {
        return entries;
    };
    let terms = query
        .trim()
        .to_lowercase()
        .split_whitespace()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return entries;
    }

    entries
        .into_iter()
        .filter(|entry| {
            let haystack = format!(
                "{} {} {} {} {} {}",
                entry.chain,
                entry.chain_id,
                entry.asset,
                entry.token_address,
                entry.pool,
                entry.scope
            )
            .to_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        })
        .collect()
}

fn sort_pools(entries: &mut [PoolListingEntry], sort_mode: &str) {
    entries.sort_by(|left, right| {
        let ordering = match sort_mode {
            "asset-asc" => left.asset.cmp(&right.asset),
            "asset-desc" => right.asset.cmp(&left.asset),
            "tvl-desc" => compare_optional_biguint(
                left.total_in_pool_value
                    .as_deref()
                    .or(left.accepted_deposits_value.as_deref()),
                right
                    .total_in_pool_value
                    .as_deref()
                    .or(right.accepted_deposits_value.as_deref()),
                true,
            ),
            "tvl-asc" => compare_optional_biguint(
                left.total_in_pool_value
                    .as_deref()
                    .or(left.accepted_deposits_value.as_deref()),
                right
                    .total_in_pool_value
                    .as_deref()
                    .or(right.accepted_deposits_value.as_deref()),
                false,
            ),
            "deposits-desc" => right.total_deposits_count.cmp(&left.total_deposits_count),
            "deposits-asc" => left.total_deposits_count.cmp(&right.total_deposits_count),
            "chain-asset" => left
                .chain
                .cmp(&right.chain)
                .then(left.asset.cmp(&right.asset)),
            _ => std::cmp::Ordering::Equal,
        };

        if ordering != std::cmp::Ordering::Equal {
            ordering
        } else {
            left.chain
                .cmp(&right.chain)
                .then(left.asset.cmp(&right.asset))
                .then(left.pool.cmp(&right.pool))
        }
    });
}

fn compare_optional_biguint(
    left: Option<&str>,
    right: Option<&str>,
    descending: bool,
) -> std::cmp::Ordering {
    let left_value = left.and_then(parse_biguint).unwrap_or_else(BigUint::zero);
    let right_value = right.and_then(parse_biguint).unwrap_or_else(BigUint::zero);
    if descending {
        right_value.cmp(&left_value)
    } else {
        left_value.cmp(&right_value)
    }
}

fn pool_entry_to_json(entry: &PoolListingEntry, include_chain: bool) -> Value {
    let mut object = Map::new();
    if include_chain {
        object.insert("chain".to_string(), Value::String(entry.chain.clone()));
    }
    object.insert("asset".to_string(), Value::String(entry.asset.clone()));
    object.insert(
        "tokenAddress".to_string(),
        Value::String(entry.token_address.clone()),
    );
    object.insert("pool".to_string(), Value::String(entry.pool.clone()));
    object.insert("scope".to_string(), Value::String(entry.scope.clone()));
    object.insert("decimals".to_string(), Value::Number(entry.decimals.into()));
    object.insert(
        "minimumDeposit".to_string(),
        Value::String(entry.minimum_deposit.clone()),
    );
    object.insert(
        "vettingFeeBPS".to_string(),
        Value::String(entry.vetting_fee_bps.clone()),
    );
    object.insert(
        "maxRelayFeeBPS".to_string(),
        Value::String(entry.max_relay_fee_bps.clone()),
    );
    insert_optional_string(
        &mut object,
        "totalInPoolValue",
        entry.total_in_pool_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalInPoolValueUsd",
        entry.total_in_pool_value_usd.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalDepositsValue",
        entry.total_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalDepositsValueUsd",
        entry.total_deposits_value_usd.clone(),
    );
    insert_optional_string(
        &mut object,
        "acceptedDepositsValue",
        entry.accepted_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "acceptedDepositsValueUsd",
        entry.accepted_deposits_value_usd.clone(),
    );
    insert_optional_string(
        &mut object,
        "pendingDepositsValue",
        entry.pending_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "pendingDepositsValueUsd",
        entry.pending_deposits_value_usd.clone(),
    );
    insert_optional_u64(
        &mut object,
        "totalDepositsCount",
        entry.total_deposits_count,
    );
    insert_optional_u64(
        &mut object,
        "acceptedDepositsCount",
        entry.accepted_deposits_count,
    );
    insert_optional_u64(
        &mut object,
        "pendingDepositsCount",
        entry.pending_deposits_count,
    );
    insert_optional_f64(&mut object, "growth24h", entry.growth24h);
    insert_optional_f64(&mut object, "pendingGrowth24h", entry.pending_growth24h);
    Value::Object(object)
}

fn pool_warning_to_json(warning: PoolWarning) -> Value {
    json!({
        "chain": warning.chain,
        "category": warning.category,
        "message": warning.message,
    })
}

fn chain_summary_to_json(summary: ChainSummary) -> Value {
    json!({
        "chain": summary.chain,
        "pools": summary.pools,
        "error": summary.error,
    })
}

fn render_pools_empty_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        if data.all_chains {
            print_json_success(json!({
                "allChains": true,
                "search": data.search,
                "sort": data.sort,
                "pools": [],
            }));
        } else {
            print_json_success(json!({
                "chain": data.chain_name,
                "search": data.search,
                "sort": data.sort,
                "pools": [],
            }));
        }
        return;
    }

    if mode.is_csv() {
        print_csv(
            vec![
                "Chain",
                "Asset",
                "Total Deposits",
                "Pool Balance",
                "USD Value",
                "Pending",
                "Min Deposit",
                "Vetting Fee",
            ],
            vec![],
        );
        return;
    }

    if mode.is_quiet {
        return;
    }

    if data.all_chains {
        write_info("No pools found across supported chains.");
    } else {
        write_info(&format!("No pools found on {}.", data.chain_name));
    }
}

fn render_pools_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        if data.all_chains {
            let mut payload = Map::new();
            payload.insert("allChains".to_string(), Value::Bool(true));
            payload.insert(
                "search".to_string(),
                data.search.map(Value::String).unwrap_or(Value::Null),
            );
            payload.insert("sort".to_string(), Value::String(data.sort));
            payload.insert(
                "chains".to_string(),
                Value::Array(
                    data.chain_summaries
                        .unwrap_or_default()
                        .into_iter()
                        .map(chain_summary_to_json)
                        .collect::<Vec<_>>(),
                ),
            );
            payload.insert(
                "pools".to_string(),
                Value::Array(
                    data.filtered_pools
                        .iter()
                        .map(|entry| pool_entry_to_json(entry, true))
                        .collect::<Vec<_>>(),
                ),
            );
            if !data.warnings.is_empty() {
                payload.insert(
                    "warnings".to_string(),
                    Value::Array(
                        data.warnings
                            .into_iter()
                            .map(pool_warning_to_json)
                            .collect::<Vec<_>>(),
                    ),
                );
            }
            print_json_success(Value::Object(payload));
        } else {
            print_json_success(json!({
                "chain": data.chain_name,
                "search": data.search,
                "sort": data.sort,
                "pools": data
                    .filtered_pools
                    .iter()
                    .map(|entry| pool_entry_to_json(entry, false))
                    .collect::<Vec<_>>(),
            }));
        }
        return;
    }

    if mode.is_csv() {
        let headers = if data.all_chains {
            vec![
                "Chain",
                "Asset",
                "Total Deposits",
                "Pool Balance",
                "USD Value",
                "Pending",
                "Min Deposit",
                "Vetting Fee",
            ]
        } else {
            vec![
                "Asset",
                "Total Deposits",
                "Pool Balance",
                "USD Value",
                "Pending",
                "Min Deposit",
                "Vetting Fee",
            ]
        };
        let rows = data
            .filtered_pools
            .iter()
            .map(|entry| pool_listing_row(entry, data.all_chains))
            .collect::<Vec<_>>();
        print_csv(headers, rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    if data.all_chains {
        write_stderr_text("\nPools across supported chains:\n\n");
    } else {
        write_stderr_text(&format!("\nPools on {}:\n\n", data.chain_name));
    }

    for warning in &data.warnings {
        write_warn(&format!(
            "{} ({}): {}",
            warning.chain, warning.category, warning.message
        ));
    }
    if !data.warnings.is_empty() {
        write_stderr_text("");
    }

    if data.filtered_pools.is_empty() {
        if let Some(search) = data.search {
            if !search.is_empty() {
                write_info(&format!("No pools matched search query \"{search}\"."));
                return;
            }
        }
        write_info("No pools found.");
        return;
    }

    let headers = if data.all_chains {
        vec![
            "Chain",
            "Asset",
            "Total Deposits",
            "Pool Balance",
            "USD Value",
            "Pending",
            "Min Deposit",
            "Vetting Fee",
        ]
    } else {
        vec![
            "Asset",
            "Total Deposits",
            "Pool Balance",
            "USD Value",
            "Pending",
            "Min Deposit",
            "Vetting Fee",
        ]
    };
    let rows = data
        .filtered_pools
        .iter()
        .map(|entry| pool_listing_row(entry, data.all_chains))
        .collect::<Vec<_>>();
    print_table(headers, rows);
    write_stderr_text(
        "\nVetting fees are deducted on deposit.\nPool Balance: current total value in the pool (accepted + pending deposits).\nPending: deposits still under ASP review.\n",
    );
}

fn pool_listing_row(entry: &PoolListingEntry, include_chain: bool) -> Vec<String> {
    let mut row = Vec::new();
    if include_chain {
        row.push(entry.chain.clone());
    }
    row.push(entry.asset.clone());
    row.push(format_pool_deposits_count(entry));
    row.push(format_pool_stat_amount(
        entry
            .total_in_pool_value
            .as_deref()
            .or(entry.accepted_deposits_value.as_deref()),
        entry.decimals,
        &entry.asset,
    ));
    row.push(parse_usd_string(
        entry
            .total_in_pool_value_usd
            .as_deref()
            .or(entry.accepted_deposits_value_usd.as_deref()),
    ));
    row.push(format_pool_stat_amount(
        entry.pending_deposits_value.as_deref(),
        entry.decimals,
        &entry.asset,
    ));
    row.push(format_pool_minimum_deposit(entry));
    row.push(format_bps_value(&entry.vetting_fee_bps));
    row
}

fn format_pool_deposits_count(entry: &PoolListingEntry) -> String {
    entry
        .total_deposits_count
        .map(format_count_number)
        .unwrap_or_else(|| "-".to_string())
}

fn format_pool_stat_amount(value: Option<&str>, decimals: u32, symbol: &str) -> String {
    value
        .and_then(parse_biguint)
        .map(|value| format_amount(&value, decimals, Some(symbol), Some(2)))
        .unwrap_or_else(|| "-".to_string())
}

fn format_pool_minimum_deposit(entry: &PoolListingEntry) -> String {
    parse_biguint(&entry.minimum_deposit)
        .map(|value| format_amount(&value, entry.decimals, Some(&entry.asset), Some(2)))
        .unwrap_or_else(|| entry.minimum_deposit.clone())
}

fn format_bps_value(value: &str) -> String {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|bps| format!("{:.2}%", bps / 100.0))
        .unwrap_or_else(|| value.to_string())
}

fn parse_usd_string(value: Option<&str>) -> String {
    match value {
        Some(raw) if !raw.trim().is_empty() => raw
            .replace(',', "")
            .parse::<f64>()
            .ok()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format!("${}", format_count_number(parsed.trunc() as u64)))
            .unwrap_or_else(|| "-".to_string()),
        _ => "-".to_string(),
    }
}

fn pool_resolution_cache() -> &'static Mutex<HashMap<String, PoolResolutionCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, PoolResolutionCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pool_resolution_cache_key(chain_id: u64, asset_address: &str) -> String {
    format!("{chain_id}:{}", asset_address.to_lowercase())
}

fn resolve_cached_pool_resolution(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<PoolResolutionCacheEntry, CliError> {
    let cache_key = pool_resolution_cache_key(chain.id, asset_address);
    {
        let cache = pool_resolution_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let chain_for_asset = chain.clone();
    let asset_address_for_asset = asset_address.to_string();
    let rpc_urls_for_asset = rpc_urls.to_vec();
    let asset_handle = std::thread::spawn(move || {
        read_asset_config(
            &chain_for_asset,
            &asset_address_for_asset,
            &rpc_urls_for_asset,
            timeout_ms,
        )
    });

    let asset_address_for_metadata = asset_address.to_string();
    let rpc_urls_for_metadata = rpc_urls.to_vec();
    let native_asset_address = native_asset_address.to_string();
    let metadata_handle = std::thread::spawn(move || {
        resolve_token_metadata_lookup(
            &asset_address_for_metadata,
            &rpc_urls_for_metadata,
            &native_asset_address,
            timeout_ms,
        )
    });

    let asset_config = match asset_handle.join() {
        Ok(result) => result?,
        Err(_) => return Err(pool_resolution_worker_join_failure(&chain.name)),
    };
    let token_lookup = match metadata_handle.join() {
        Ok(result) => result,
        Err(_) => TokenMetadataLookupResult {
            metadata: TokenMetadataResult {
                symbol: "???".to_string(),
                decimals: 18,
            },
            cacheable: false,
        },
    };
    let scope = read_pool_scope(&asset_config.pool_address, rpc_urls, timeout_ms)?;

    let resolved = PoolResolutionCacheEntry {
        asset_config,
        scope,
        token_metadata: token_lookup.metadata,
    };
    if token_lookup.cacheable {
        let mut cache = pool_resolution_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.insert(cache_key, resolved.clone());
    }

    Ok(resolved)
}

fn read_asset_config(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    timeout_ms: u64,
) -> Result<AssetConfigResult, CliError> {
    let selector = function_selector("assetConfig(address)");
    let data = format!(
        "0x{}{}",
        hex::encode(selector),
        encode_address_word(asset_address)?
    );
    let response = rpc_call(rpc_urls, &chain.entrypoint, &data, timeout_ms)?;
    let words = decode_abi_words(&response)?;
    if words.len() < 4 {
        return Err(CliError::rpc(
            "Malformed RPC response while resolving pool asset config.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    Ok(AssetConfigResult {
        pool_address: checksum_address(&decode_address_word(&words[0])?)?,
        minimum_deposit_amount: decode_uint256_word(&words[1]).to_string(),
        vetting_fee_bps: decode_uint256_word(&words[2]).to_string(),
        max_relay_fee_bps: decode_uint256_word(&words[3]).to_string(),
    })
}

fn read_pool_scope(
    pool_address: &str,
    rpc_urls: &[String],
    timeout_ms: u64,
) -> Result<String, CliError> {
    let selector = function_selector("SCOPE()");
    let data = format!("0x{}", hex::encode(selector));
    let response = rpc_call(rpc_urls, pool_address, &data, timeout_ms)?;
    let words = decode_abi_words(&response)?;
    let first = words.first().ok_or_else(|| {
        CliError::rpc(
            "Malformed RPC response while resolving pool scope.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    Ok(decode_uint256_word(first).to_string())
}

fn resolve_token_metadata(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> TokenMetadataResult {
    resolve_token_metadata_lookup(asset_address, rpc_urls, native_asset_address, timeout_ms)
        .metadata
}

fn resolve_token_metadata_lookup(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> TokenMetadataLookupResult {
    if asset_address.eq_ignore_ascii_case(native_asset_address) {
        return TokenMetadataLookupResult {
            metadata: TokenMetadataResult {
                symbol: "ETH".to_string(),
                decimals: 18,
            },
            cacheable: true,
        };
    }

    let symbol_selector = function_selector("symbol()");
    let decimals_selector = function_selector("decimals()");
    let symbol_result = rpc_call(
        rpc_urls,
        asset_address,
        &format!("0x{}", hex::encode(symbol_selector)),
        timeout_ms,
    )
    .ok()
    .and_then(|value| decode_abi_string(&value).ok());
    let decimals_result = rpc_call(
        rpc_urls,
        asset_address,
        &format!("0x{}", hex::encode(decimals_selector)),
        timeout_ms,
    )
    .ok()
    .and_then(|value| decode_abi_words(&value).ok())
    .and_then(|words| words.first().cloned())
    .map(|word| decode_uint256_word(&word))
    .and_then(|value| value.to_u32_digits().first().copied());

    TokenMetadataLookupResult {
        metadata: TokenMetadataResult {
            symbol: symbol_result.clone().unwrap_or_else(|| "???".to_string()),
            decimals: decimals_result.unwrap_or(18),
        },
        cacheable: symbol_result.is_some() && decimals_result.is_some(),
    }
}

fn rpc_call(
    rpc_urls: &[String],
    to: &str,
    data: &str,
    timeout_ms: u64,
) -> Result<String, CliError> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [
            {
                "to": to,
                "data": data,
            },
            "latest"
        ]
    });

    let mut last_error = None;
    for rpc_url in rpc_urls {
        match http_post_json(rpc_url, &body, timeout_ms) {
            Ok(response) => {
                if let Some(result) = response.get("result").and_then(Value::as_str) {
                    return Ok(result.to_string());
                }

                if let Some(error_message) = response
                    .get("error")
                    .and_then(Value::as_object)
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                {
                    last_error = Some(CliError::rpc(
                        format!("RPC error: {error_message}"),
                        Some("Check your RPC connection and try again.".to_string()),
                        None,
                    ));
                    continue;
                }
            }
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        CliError::rpc(
            "RPC pool resolution failed.",
            Some("Check your RPC connection and try again.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    }))
}

fn function_selector(signature: &str) -> [u8; 4] {
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(signature.as_bytes());
    keccak.finalize(&mut hash);
    [hash[0], hash[1], hash[2], hash[3]]
}

fn encode_address_word(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::input(
            format!("Invalid asset address: {address}."),
            Some("Use a 0x-prefixed 20-byte address.".to_string()),
        ));
    }
    Ok(format!("{:0>64}", normalized.to_lowercase()))
}

fn decode_abi_words(hex_data: &str) -> Result<Vec<String>, CliError> {
    let normalized = hex_data.strip_prefix("0x").unwrap_or(hex_data);
    if normalized.is_empty() {
        return Ok(vec![]);
    }
    if !normalized.len().is_multiple_of(64) {
        return Err(CliError::rpc(
            "Malformed ABI response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(normalized
        .as_bytes()
        .chunks(64)
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect())
}

fn decode_uint256_word(word: &str) -> BigUint {
    BigUint::parse_bytes(word.as_bytes(), 16).unwrap_or_else(BigUint::zero)
}

fn decode_address_word(word: &str) -> Result<String, CliError> {
    if word.len() != 64 {
        return Err(CliError::rpc(
            "Malformed ABI address response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(format!("0x{}", &word[24..]))
}

fn checksum_address(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::rpc(
            "Malformed address returned from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let lowercase = normalized.to_lowercase();
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(lowercase.as_bytes());
    keccak.finalize(&mut hash);
    let hash_hex = hex::encode(hash);
    let mut checksummed = String::from("0x");
    for (index, character) in lowercase.chars().enumerate() {
        let nibble = u8::from_str_radix(&hash_hex[index..index + 1], 16).unwrap_or(0);
        if character.is_ascii_alphabetic() && nibble >= 8 {
            checksummed.push(character.to_ascii_uppercase());
        } else {
            checksummed.push(character);
        }
    }
    Ok(checksummed)
}

fn decode_abi_string(hex_data: &str) -> Result<String, CliError> {
    let words = decode_abi_words(hex_data)?;
    if words.len() < 2 {
        return Err(CliError::rpc(
            "Malformed ABI string response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let offset = decode_uint256_word(&words[0]).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string offset from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    if offset % 32 != 0 {
        return Err(CliError::rpc(
            "Invalid ABI string offset alignment from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    let index = offset / 32;
    let length_word = words.get(index).ok_or_else(|| {
        CliError::rpc(
            "Malformed ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    let length = decode_uint256_word(length_word).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;

    let mut bytes = vec![];
    let required_words = length.div_ceil(32);
    for word_index in 0..required_words {
        let word = words.get(index + 1 + word_index).ok_or_else(|| {
            CliError::rpc(
                "Malformed ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        let decoded = hex::decode(word).map_err(|_| {
            CliError::rpc(
                "Invalid ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        bytes.extend(decoded);
    }
    bytes.truncate(length);
    String::from_utf8(bytes).map_err(|_| {
        CliError::rpc(
            "ABI string payload was not valid UTF-8.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })
}

fn is_hex_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].chars().all(|char| char.is_ascii_hexdigit())
}

fn is_decimal_string(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|char| char.is_ascii_digit())
}

fn parse_biguint(value: &str) -> Option<BigUint> {
    if value.is_empty() {
        return None;
    }
    if value.starts_with("0x") {
        BigUint::parse_bytes(value.trim_start_matches("0x").as_bytes(), 16)
    } else {
        BigUint::parse_bytes(value.as_bytes(), 10)
    }
}

fn format_amount(
    value: &BigUint,
    decimals: u32,
    symbol: Option<&str>,
    max_decimals: Option<usize>,
) -> String {
    let mut digits = value.to_string();
    let decimals = decimals as usize;
    let formatted = if decimals == 0 {
        digits
    } else if digits.len() <= decimals {
        let padding = "0".repeat(decimals + 1 - digits.len());
        digits = format!("{padding}{digits}");
        format!(
            "{}.{}",
            &digits[..digits.len() - decimals],
            &digits[digits.len() - decimals..]
        )
    } else {
        format!(
            "{}.{}",
            &digits[..digits.len() - decimals],
            &digits[digits.len() - decimals..]
        )
    };

    let formatted = truncate_decimals(&formatted, max_decimals.unwrap_or(decimals));
    match symbol {
        Some(symbol) => format!("{formatted} {symbol}"),
        None => formatted,
    }
}

fn truncate_decimals(value: &str, max: usize) -> String {
    let Some(dot_index) = value.find('.') else {
        return value.to_string();
    };
    let int_part = &value[..dot_index];
    let dec_part = &value[dot_index + 1..];
    if dec_part.len() <= max {
        let trimmed = dec_part.trim_end_matches('0');
        return if trimmed.is_empty() {
            int_part.to_string()
        } else {
            format!("{int_part}.{trimmed}")
        };
    }

    let mut digits = max;
    if int_part == "0" && dec_part[..max].chars().all(|char| char == '0') {
        if let Some(first_sig) = dec_part.find(|char| char != '0') {
            if first_sig >= max {
                digits = first_sig + 1;
            }
        }
    }

    let truncated = &dec_part[..digits];
    let trimmed = truncated.trim_end_matches('0');
    if trimmed.is_empty() {
        int_part.to_string()
    } else {
        format!("{int_part}.{trimmed}")
    }
}

fn resolve_pool_from_asset_address_native(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    let asset_config = read_asset_config(chain, asset_address, rpc_urls, timeout_ms)?;
    let scope = read_pool_scope(&asset_config.pool_address, rpc_urls, timeout_ms)?;
    let token_metadata =
        resolve_token_metadata(asset_address, rpc_urls, native_asset_address, timeout_ms);

    Ok(NativePoolResolution {
        symbol: token_metadata.symbol,
        pool_address: asset_config.pool_address,
        scope,
    })
}

fn pool_listing_entry_to_resolution(entry: &PoolListingEntry) -> NativePoolResolution {
    NativePoolResolution {
        symbol: entry.asset.clone(),
        pool_address: entry.pool.clone(),
        scope: entry.scope.clone(),
    }
}
