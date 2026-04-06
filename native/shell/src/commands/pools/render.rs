use super::model::{ChainSummary, PoolListingEntry, PoolWarning, PoolsRenderData};
use crate::output::{
    build_next_action, format_count_number, format_key_value_rows, format_section_heading,
    insert_optional_f64, insert_optional_string, insert_optional_u64, print_csv,
    print_json_success, print_table, write_info, write_stderr_text, write_warn,
};
use crate::routing::NativeMode;
use serde_json::{json, Map, Value};

pub(super) fn render_pools_empty_output(mode: &NativeMode, data: PoolsRenderData) {
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

pub(super) fn render_pools_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        // Build nextActions: deposit template with chain context when single-chain.
        let mut next_opts = Map::new();
        next_opts.insert("agent".to_string(), Value::Bool(true));
        if !data.all_chains {
            next_opts.insert("chain".to_string(), Value::String(data.chain_name.clone()));
        }
        let next_actions = Value::Array(vec![build_next_action(
            "deposit",
            "Deposit into a pool.",
            "after_pools",
            Some(&["<amount>", "<asset>"]),
            Some(&next_opts),
            Some(false),
        )]);

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
            payload.insert("nextActions".to_string(), next_actions);
            print_json_success(Value::Object(payload));
        } else {
            let mut payload = Map::new();
            payload.insert("chain".to_string(), Value::String(data.chain_name));
            payload.insert(
                "search".to_string(),
                data.search.map(Value::String).unwrap_or(Value::Null),
            );
            payload.insert("sort".to_string(), Value::String(data.sort));
            payload.insert(
                "pools".to_string(),
                Value::Array(
                    data.filtered_pools
                        .iter()
                        .map(|entry| pool_entry_to_json(entry, false))
                        .collect::<Vec<_>>(),
                ),
            );
            payload.insert("nextActions".to_string(), next_actions);
            print_json_success(Value::Object(payload));
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

    let mut summary_rows = vec![
        (
            "Scope",
            if data.all_chains {
                "all supported chains".to_string()
            } else {
                data.chain_name.clone()
            },
        ),
        ("Matched pools", data.filtered_pools.len().to_string()),
        ("Sort", data.sort.clone()),
    ];
    if let Some(search) = data.search.clone() {
        if !search.is_empty() {
            summary_rows.push(("Search", search));
        }
    }
    write_stderr_text(&format_section_heading("Summary"));
    write_stderr_text(&format_key_value_rows(&summary_rows));

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

fn parse_biguint(value: &str) -> Option<num_bigint::BigUint> {
    super::rpc::parse_biguint(value)
}

fn format_amount(
    value: &num_bigint::BigUint,
    decimals: u32,
    symbol: Option<&str>,
    max_decimals: Option<usize>,
) -> String {
    super::rpc::format_amount(value, decimals, symbol, max_decimals)
}

#[cfg(test)]
mod extended_tests {
    use super::*;

    fn sample_entry() -> PoolListingEntry {
        PoolListingEntry {
            chain: "mainnet".to_string(),
            chain_id: 1,
            asset: "ETH".to_string(),
            token_address: "0x1111111111111111111111111111111111111111".to_string(),
            pool: "0x2222222222222222222222222222222222222222".to_string(),
            scope: "12345".to_string(),
            decimals: 18,
            minimum_deposit: "1000000000000000".to_string(),
            vetting_fee_bps: "50".to_string(),
            max_relay_fee_bps: "250".to_string(),
            total_in_pool_value: Some("5000000000000000000".to_string()),
            total_in_pool_value_usd: Some("1,234.99".to_string()),
            total_deposits_value: Some("10000000000000000000".to_string()),
            total_deposits_value_usd: Some("2,468.00".to_string()),
            accepted_deposits_value: Some("4500000000000000000".to_string()),
            accepted_deposits_value_usd: Some("1,100.00".to_string()),
            pending_deposits_value: Some("500000000000000000".to_string()),
            pending_deposits_value_usd: Some("134.00".to_string()),
            total_deposits_count: Some(42),
            accepted_deposits_count: Some(35),
            pending_deposits_count: Some(7),
            growth24h: Some(0.5),
            pending_growth24h: Some(0.25),
        }
    }

    #[test]
    fn pool_entry_json_includes_chain_only_when_requested() {
        let entry = sample_entry();
        let with_chain = pool_entry_to_json(&entry, true);
        assert_eq!(with_chain["chain"], Value::String("mainnet".to_string()));
        assert_eq!(with_chain["asset"], Value::String("ETH".to_string()));
        assert_eq!(with_chain["decimals"], Value::Number(18.into()));
        assert_eq!(with_chain["pendingDepositsCount"], Value::Number(7.into()));

        let without_chain = pool_entry_to_json(&entry, false);
        assert!(without_chain.get("chain").is_none());
        assert_eq!(
            without_chain["tokenAddress"],
            Value::String("0x1111111111111111111111111111111111111111".to_string()),
        );

        let mut sparse = entry.clone();
        sparse.total_in_pool_value = None;
        sparse.total_deposits_count = None;
        let sparse_json = pool_entry_to_json(&sparse, false);
        assert_eq!(sparse_json["totalInPoolValue"], Value::Null);
        assert_eq!(sparse_json["totalDepositsCount"], Value::Null);
    }

    #[test]
    fn warning_and_summary_json_helpers_preserve_shape() {
        let warning = pool_warning_to_json(PoolWarning {
            chain: "mainnet".to_string(),
            category: "rpc".to_string(),
            message: "retry".to_string(),
        });
        assert_eq!(warning["chain"], Value::String("mainnet".to_string()));
        assert_eq!(warning["category"], Value::String("rpc".to_string()));

        let summary = chain_summary_to_json(ChainSummary {
            chain: "mainnet".to_string(),
            pools: 3,
            error: Some("down".to_string()),
        });
        assert_eq!(summary["pools"], Value::Number(3.into()));
        assert_eq!(summary["error"], Value::String("down".to_string()));
    }

    #[test]
    fn listing_rows_format_amounts_usd_and_fees_for_single_and_multi_chain() {
        let entry = sample_entry();
        let single = pool_listing_row(&entry, false);
        assert_eq!(single[0], "ETH");
        assert_eq!(single[1], "42");
        assert_eq!(single[2], "5 ETH");
        assert_eq!(single[3], "$1,234");
        assert_eq!(single[4], "0.5 ETH");
        assert_eq!(single[5], "0.001 ETH");
        assert_eq!(single[6], "0.50%");

        let multi = pool_listing_row(&entry, true);
        assert_eq!(multi[0], "mainnet");
        assert_eq!(multi[1], "ETH");
    }

    #[test]
    fn formatting_helpers_handle_fallback_and_invalid_values() {
        let mut entry = sample_entry();
        entry.total_deposits_count = None;
        entry.total_in_pool_value = None;
        entry.accepted_deposits_value = Some("1200000000000000000".to_string());
        entry.minimum_deposit = "not-a-number".to_string();
        entry.vetting_fee_bps = "oops".to_string();

        assert_eq!(format_pool_deposits_count(&entry), "-");
        assert_eq!(
            format_pool_stat_amount(entry.accepted_deposits_value.as_deref(), 18, "ETH"),
            "1.2 ETH",
        );
        assert_eq!(format_pool_stat_amount(Some("bad"), 18, "ETH"), "-");
        assert_eq!(format_pool_minimum_deposit(&entry), "not-a-number");
        assert_eq!(format_bps_value(&entry.vetting_fee_bps), "oops");
        assert_eq!(parse_usd_string(Some("bad")), "-");
        assert_eq!(parse_usd_string(Some("  ")), "-");
        assert_eq!(parse_usd_string(None), "-");
    }
}
