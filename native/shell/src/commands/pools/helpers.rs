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
            "tvl-desc" => compare_pool_value_metric(right, left),
            "tvl-asc" => compare_pool_value_metric(left, right),
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

fn compare_pool_value_metric(
    left: &PoolListingEntry,
    right: &PoolListingEntry,
) -> std::cmp::Ordering {
    let left_usd = left
        .total_in_pool_value_usd
        .as_deref()
        .or(left.accepted_deposits_value_usd.as_deref())
        .and_then(parse_usd_metric);
    let right_usd = right
        .total_in_pool_value_usd
        .as_deref()
        .or(right.accepted_deposits_value_usd.as_deref())
        .and_then(parse_usd_metric);
    if left_usd.is_some() || right_usd.is_some() {
        return match (left_usd, right_usd) {
            (Some(left_value), Some(right_value)) => left_value.cmp(&right_value),
            (Some(_), None) => std::cmp::Ordering::Greater,
            (None, Some(_)) => std::cmp::Ordering::Less,
            (None, None) => std::cmp::Ordering::Equal,
        };
    }

    compare_normalized_biguint(
        left.total_in_pool_value
            .as_deref()
            .or(left.accepted_deposits_value.as_deref()),
        left.decimals,
        right
            .total_in_pool_value
            .as_deref()
            .or(right.accepted_deposits_value.as_deref()),
        right.decimals,
    )
}

#[cfg(test)]
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

fn compare_normalized_biguint(
    left: Option<&str>,
    left_decimals: u32,
    right: Option<&str>,
    right_decimals: u32,
) -> std::cmp::Ordering {
    normalize_token_metric(left, left_decimals).cmp(&normalize_token_metric(right, right_decimals))
}

fn normalize_token_metric(value: Option<&str>, decimals: u32) -> BigUint {
    let raw = value.and_then(parse_biguint).unwrap_or_else(BigUint::zero);
    let target_decimals = 18u32;
    if decimals == target_decimals {
        raw
    } else if decimals < target_decimals {
        raw * BigUint::from(10u32).pow(target_decimals - decimals)
    } else {
        raw / BigUint::from(10u32).pow(decimals - target_decimals)
    }
}

fn parse_usd_metric(value: &str) -> Option<i128> {
    let normalized = value.trim().replace(',', "");
    if normalized.is_empty() {
        return None;
    }
    let sign = if normalized.starts_with('-') { -1 } else { 1 };
    let unsigned = normalized.trim_start_matches('-');
    let whole = unsigned.split('.').next().unwrap_or(unsigned);
    whole.parse::<i128>().ok().map(|parsed| parsed * sign)
}

#[cfg(test)]
mod extended_tests {
    use super::*;
    use crate::commands::pools::model::PoolListingEntry;
    use serde_json::json;

    fn pool_entry(
        chain: &str,
        asset: &str,
        pool: &str,
        total_in_pool_value: Option<&str>,
        accepted_deposits_value: Option<&str>,
        total_deposits_count: Option<u64>,
    ) -> PoolListingEntry {
        PoolListingEntry {
            chain: chain.to_string(),
            chain_id: if chain == "mainnet" { 1 } else { 10 },
            asset: asset.to_string(),
            token_address: "0x1111111111111111111111111111111111111111".to_string(),
            pool: pool.to_string(),
            scope: "12345".to_string(),
            decimals: 18,
            minimum_deposit: "1000000000000000".to_string(),
            vetting_fee_bps: "50".to_string(),
            max_relay_fee_bps: "250".to_string(),
            total_in_pool_value: total_in_pool_value.map(str::to_string),
            total_in_pool_value_usd: total_in_pool_value.map(str::to_string),
            total_deposits_value: None,
            total_deposits_value_usd: None,
            accepted_deposits_value: accepted_deposits_value.map(str::to_string),
            accepted_deposits_value_usd: accepted_deposits_value.map(str::to_string),
            pending_deposits_value: None,
            pending_deposits_value_usd: None,
            total_deposits_count,
            accepted_deposits_count: None,
            pending_deposits_count: None,
            growth24h: None,
            pending_growth24h: None,
            my_pool_accounts_count: None,
        }
    }

    #[test]
    fn normalize_pool_stats_entries_accepts_arrays_and_objects() {
        let array_entries = normalize_pool_stats_entries(&json!([
            { "tokenAddress": "0x1111111111111111111111111111111111111111" },
            123,
        ]));
        assert_eq!(array_entries.len(), 1);

        let nested_entries = normalize_pool_stats_entries(&json!({
            "pools": [
                { "tokenAddress": "0x1111111111111111111111111111111111111111" },
                "ignored"
            ]
        }));
        assert_eq!(nested_entries.len(), 1);

        let keyed_entries = normalize_pool_stats_entries(&json!({
            "eth": { "tokenAddress": "0x1111111111111111111111111111111111111111" },
            "usdc": { "tokenAddress": "0x2222222222222222222222222222222222222222" },
            "pools": [{ "ignored": true }]
        }));
        assert_eq!(keyed_entries.len(), 1);

        assert!(normalize_pool_stats_entries(&json!("bad")).is_empty());
    }

    #[test]
    fn resolves_pool_addresses_and_filters_invalid_values() {
        let entry = json!({
            "assetAddress": "0x1111111111111111111111111111111111111111",
            "tokenAddress": "0x2222222222222222222222222222222222222222",
            "poolAddress": "0x3333333333333333333333333333333333333333",
            "pool": "0x4444444444444444444444444444444444444444"
        })
        .as_object()
        .cloned()
        .unwrap();
        assert_eq!(
            resolve_pool_asset_address(&entry).as_deref(),
            Some("0x1111111111111111111111111111111111111111"),
        );
        assert_eq!(
            resolve_pool_stats_pool_address(&entry).as_deref(),
            Some("0x3333333333333333333333333333333333333333"),
        );

        let fallback_entry = json!({
            "tokenAddress": "0x2222222222222222222222222222222222222222",
            "pool": "0x4444444444444444444444444444444444444444"
        })
        .as_object()
        .cloned()
        .unwrap();
        assert_eq!(
            resolve_pool_asset_address(&fallback_entry).as_deref(),
            Some("0x2222222222222222222222222222222222222222"),
        );
        assert_eq!(
            resolve_pool_stats_pool_address(&fallback_entry).as_deref(),
            Some("0x4444444444444444444444444444444444444444"),
        );

        let invalid_entry = json!({
            "assetAddress": "not-an-address",
            "poolAddress": "still-bad"
        })
        .as_object()
        .cloned()
        .unwrap();
        assert_eq!(resolve_pool_asset_address(&invalid_entry), None);
        assert_eq!(resolve_pool_stats_pool_address(&invalid_entry), None);
    }

    #[test]
    fn prepare_inputs_filters_chain_and_deduplicates_by_pool_then_asset() {
        let stats_entries = vec![
            json!({
                "chainId": 1,
                "poolAddress": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "tokenAddress": "0x1111111111111111111111111111111111111111"
            })
            .as_object()
            .cloned()
            .unwrap(),
            json!({
                "chainId": 1,
                "poolAddress": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "tokenAddress": "0x2222222222222222222222222222222222222222"
            })
            .as_object()
            .cloned()
            .unwrap(),
            json!({
                "chainId": 1,
                "tokenAddress": "0x3333333333333333333333333333333333333333"
            })
            .as_object()
            .cloned()
            .unwrap(),
            json!({
                "chainId": 10,
                "tokenAddress": "0x4444444444444444444444444444444444444444"
            })
            .as_object()
            .cloned()
            .unwrap(),
            json!({
                "chainId": 1,
                "tokenAddress": "bad-address"
            })
            .as_object()
            .cloned()
            .unwrap(),
        ];

        let prepared = prepare_pool_resolution_inputs(stats_entries, 1);
        assert_eq!(prepared.len(), 2);
        assert_eq!(
            prepared[0].asset_address,
            "0x1111111111111111111111111111111111111111",
        );
        assert_eq!(
            prepared[1].asset_address,
            "0x3333333333333333333333333333333333333333",
        );
    }

    #[test]
    fn deduplication_search_and_sort_cover_common_listing_modes() {
        let duplicate_pool = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let entries = vec![
            pool_entry(
                "optimism",
                "USDC",
                "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                Some("5"),
                None,
                Some(4),
            ),
            pool_entry("mainnet", "ETH", duplicate_pool, Some("10"), None, Some(2)),
            pool_entry("mainnet", "ETH", duplicate_pool, Some("12"), None, Some(5)),
            pool_entry(
                "arbitrum",
                "DAI",
                "0xcccccccccccccccccccccccccccccccccccccccc",
                None,
                Some("8"),
                Some(3),
            ),
        ];

        let deduped = deduplicate_pool_entries(entries.clone());
        assert_eq!(deduped.len(), 3);

        assert_eq!(apply_pool_search(entries.clone(), None).len(), 4);
        assert_eq!(apply_pool_search(entries.clone(), Some("   ")).len(), 4);
        let filtered = apply_pool_search(entries.clone(), Some("mainnet eth"));
        assert_eq!(filtered.len(), 2);
        assert!(apply_pool_search(entries.clone(), Some("no-match")).is_empty());

        let mut by_asset = deduped.clone();
        sort_pools(&mut by_asset, "asset-asc");
        assert_eq!(
            by_asset
                .iter()
                .map(|entry| entry.asset.as_str())
                .collect::<Vec<_>>(),
            vec!["DAI", "ETH", "USDC"],
        );

        sort_pools(&mut by_asset, "asset-desc");
        assert_eq!(
            by_asset
                .iter()
                .map(|entry| entry.asset.as_str())
                .collect::<Vec<_>>(),
            vec!["USDC", "ETH", "DAI"],
        );

        let mut by_tvl = deduped.clone();
        sort_pools(&mut by_tvl, "tvl-desc");
        assert_eq!(by_tvl[0].asset, "ETH");
        sort_pools(&mut by_tvl, "tvl-asc");
        assert_eq!(by_tvl[0].asset, "USDC");

        let mut by_deposits = deduped.clone();
        sort_pools(&mut by_deposits, "deposits-desc");
        assert_eq!(by_deposits[0].asset, "USDC");
        sort_pools(&mut by_deposits, "deposits-asc");
        assert_eq!(by_deposits[0].asset, "ETH");

        let mut by_chain_asset = deduped.clone();
        sort_pools(&mut by_chain_asset, "chain-asset");
        assert_eq!(
            by_chain_asset
                .iter()
                .map(|entry| format!("{}:{}", entry.chain, entry.asset))
                .collect::<Vec<_>>(),
            vec!["arbitrum:DAI", "mainnet:ETH", "optimism:USDC"],
        );
    }

    #[test]
    fn numeric_and_json_helpers_cover_hex_decimal_and_null_paths() {
        assert_eq!(
            compare_optional_biguint(Some("0x0f"), Some("12"), true),
            std::cmp::Ordering::Less,
        );
        assert_eq!(
            compare_optional_biguint(Some("2"), Some("12"), false),
            std::cmp::Ordering::Less,
        );

        let resolution = pool_listing_entry_to_resolution(&pool_entry(
            "mainnet",
            "ETH",
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            Some("10"),
            None,
            Some(1),
        ));
        assert_eq!(resolution.symbol, "ETH");

        assert_eq!(
            parse_json_string(Some(&json!("hello"))).as_deref(),
            Some("hello"),
        );
        assert_eq!(parse_json_string(Some(&json!(123))), None);

        assert_eq!(
            parse_json_decimal_string(Some(&json!("123"))).as_deref(),
            Some("123"),
        );
        assert_eq!(
            parse_json_decimal_string(Some(&json!(456))).as_deref(),
            Some("456"),
        );
        assert_eq!(parse_json_decimal_string(Some(&json!("12.3"))), None);

        assert_eq!(parse_json_number(Some(&json!(1.25))), Some(1.25));
        assert_eq!(parse_json_number(Some(&json!("bad"))), None);

        let error = pool_resolution_worker_join_failure("mainnet");
        assert_eq!(error.code, "UNKNOWN_ERROR");
        assert!(error.message.contains("mainnet"));
        assert_eq!(error.category.as_str(), "UNKNOWN");
    }
}
