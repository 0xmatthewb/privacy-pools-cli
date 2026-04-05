use super::helpers::{
    deduplicate_pool_entries, normalize_pool_stats_entries, parse_json_decimal_string,
    parse_json_number, parse_json_string, pool_resolution_worker_join_failure,
    prepare_pool_resolution_inputs,
};
use super::model::{PoolListingEntry, PoolStatsResolutionInput, POOL_RESOLUTION_MAX_WORKERS};
use super::rpc::resolve_cached_pool_resolution;
use crate::config::{get_rpc_urls, CliConfig};
use crate::contract::{ChainDefinition, RuntimeConfig};
use crate::error::{CliError, ErrorCategory};
use crate::read_only_api::fetch_pools_stats;
use std::collections::VecDeque;
use std::sync::{mpsc, Arc, Mutex};

pub(super) fn list_pools_native(
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
    let (entries, rpc_read_failures) = resolve_pool_listing_entries_bounded(
        chain,
        resolution_inputs,
        &rpc_urls,
        &runtime_config.native_asset_address,
        timeout_ms,
    )?;

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

pub(super) fn resolve_pool_listing_entries_bounded(
    chain: &ChainDefinition,
    resolution_inputs: Vec<PoolStatsResolutionInput>,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<(Vec<PoolListingEntry>, usize), CliError> {
    if resolution_inputs.is_empty() {
        return Ok((vec![], 0));
    }

    let total_inputs = resolution_inputs.len();
    let worker_count = bounded_pool_resolution_worker_count(resolution_inputs.len());
    let queue = Arc::new(Mutex::new(
        resolution_inputs
            .into_iter()
            .enumerate()
            .collect::<VecDeque<_>>(),
    ));
    let (tx, rx) = mpsc::channel();
    let mut handles = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let queue = Arc::clone(&queue);
        let tx = tx.clone();
        let chain = chain.clone();
        let rpc_urls = rpc_urls.to_vec();
        let native_asset_address = native_asset_address.to_string();
        handles.push(std::thread::spawn(move || loop {
            let next = {
                let mut queue = queue
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                queue.pop_front()
            };
            let Some((index, input)) = next else {
                break;
            };

            let result = resolve_pool_listing_entry(
                chain.clone(),
                input,
                rpc_urls.clone(),
                native_asset_address.clone(),
                timeout_ms,
            );
            if tx.send((index, result)).is_err() {
                break;
            }
        }));
    }
    drop(tx);

    let mut results = vec![None; total_inputs];
    for (index, result) in rx {
        if index >= results.len() {
            return Err(pool_resolution_worker_join_failure(&chain.name));
        }
        results[index] = Some(result);
    }

    for handle in handles {
        if handle.join().is_err() {
            return Err(pool_resolution_worker_join_failure(&chain.name));
        }
    }

    if results.iter().any(Option::is_none) {
        return Err(pool_resolution_worker_join_failure(&chain.name));
    }

    let mut entries = vec![];
    let mut rpc_read_failures = 0usize;
    for result in results.into_iter().flatten() {
        match result {
            Ok(entry) => entries.push(entry),
            Err(error) if matches!(error.category, ErrorCategory::Rpc) => {
                rpc_read_failures += 1;
            }
            Err(error) => return Err(error),
        }
    }

    Ok((entries, rpc_read_failures))
}

pub(super) fn resolve_pool_listing_entry(
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

pub(super) fn bounded_pool_resolution_worker_count(input_count: usize) -> usize {
    input_count.clamp(1, POOL_RESOLUTION_MAX_WORKERS)
}

#[cfg(test)]
mod tests {
    use super::bounded_pool_resolution_worker_count;

    #[test]
    fn bounded_pool_resolution_worker_count_caps_and_stays_positive() {
        assert_eq!(bounded_pool_resolution_worker_count(1), 1);
        assert_eq!(bounded_pool_resolution_worker_count(2), 2);
        assert_eq!(bounded_pool_resolution_worker_count(4), 4);
        assert_eq!(bounded_pool_resolution_worker_count(8), 4);
        assert_eq!(bounded_pool_resolution_worker_count(0), 1);
    }
}
