use super::model::{NativePoolResolution, PoolListingEntry, PoolStatsResolutionInput};
use crate::error::CliError;
use crate::json::{json_numberish, parse_json_u64};
use num_bigint::BigUint;
use num_traits::Zero;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub(super) fn normalize_pool_stats_entries(stats_data: &Value) -> Vec<Map<String, Value>> {
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

pub(super) fn resolve_pool_asset_address(entry: &Map<String, Value>) -> Option<String> {
    entry
        .get("assetAddress")
        .and_then(Value::as_str)
        .or_else(|| entry.get("tokenAddress").and_then(Value::as_str))
        .filter(|value| is_hex_address(value))
        .map(|value| value.to_string())
}

pub(super) fn resolve_pool_stats_pool_address(entry: &Map<String, Value>) -> Option<String> {
    entry
        .get("poolAddress")
        .and_then(Value::as_str)
        .or_else(|| entry.get("pool").and_then(Value::as_str))
        .filter(|value| is_hex_address(value))
        .map(|value| value.to_string())
}

pub(super) fn prepare_pool_resolution_inputs(
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

pub(super) fn deduplicate_pool_entries(entries: Vec<PoolListingEntry>) -> Vec<PoolListingEntry> {
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

pub(super) fn apply_pool_search(
    entries: Vec<PoolListingEntry>,
    query: Option<&str>,
) -> Vec<PoolListingEntry> {
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

pub(super) fn sort_pools(entries: &mut [PoolListingEntry], sort_mode: &str) {
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

pub(super) fn compare_optional_biguint(
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

pub(super) fn pool_listing_entry_to_resolution(entry: &PoolListingEntry) -> NativePoolResolution {
    NativePoolResolution {
        symbol: entry.asset.clone(),
        pool_address: entry.pool.clone(),
        scope: entry.scope.clone(),
    }
}

pub(super) fn parse_json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(|value| value.to_string())
}

pub(super) fn parse_json_decimal_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(string)) if is_decimal_string(string) => Some(string.to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

pub(super) fn parse_json_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(json_numberish)
}

pub(super) fn pool_resolution_worker_join_failure(chain_name: &str) -> CliError {
    CliError::unknown(
        format!("Failed to resolve pools on {chain_name}."),
        Some("Retry the command. If the issue persists, reinstall the CLI and retry.".to_string()),
    )
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
