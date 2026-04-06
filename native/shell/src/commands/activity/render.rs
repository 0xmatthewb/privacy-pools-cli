use super::format::{format_asp_approval_status_label, format_tx_hash_short};
use super::model::{ActivityRenderData, NormalizedActivityEvent};
use crate::output::{
    format_key_value_rows, format_section_heading, format_time_ago, print_csv, print_json_success,
    print_table, write_stderr_text,
};
use crate::routing::NativeMode;
use serde_json::{json, Map, Value};

pub(super) fn render_activity_output(mode: &NativeMode, data: ActivityRenderData) {
    if mode.is_json() {
        let mut payload = Map::new();
        payload.insert("mode".to_string(), Value::String(data.mode.to_string()));
        payload.insert("chain".to_string(), Value::String(data.chain.clone()));
        if let Some(chains) = data.chains {
            payload.insert(
                "chains".to_string(),
                Value::Array(chains.into_iter().map(Value::String).collect::<Vec<_>>()),
            );
        }
        payload.insert("page".to_string(), Value::Number(data.page.into()));
        payload.insert("perPage".to_string(), Value::Number(data.per_page.into()));
        insert_optional_u64(&mut payload, "total", data.total);
        insert_optional_u64(&mut payload, "totalPages", data.total_pages);
        payload.insert(
            "events".to_string(),
            Value::Array(
                data.events
                    .into_iter()
                    .map(activity_event_to_json)
                    .collect::<Vec<_>>(),
            ),
        );
        if data.mode == "pool-activity" {
            insert_optional_string(&mut payload, "asset", data.asset);
            insert_optional_string(&mut payload, "pool", data.pool);
            insert_optional_string(&mut payload, "scope", data.scope);
        }
        if data.chain_filtered {
            payload.insert("chainFiltered".to_string(), Value::Bool(true));
            payload.insert(
                "note".to_string(),
                Value::String(
                    "Pagination totals are unavailable when filtering by chain. Results may be sparse."
                        .to_string(),
                ),
            );
        }
        print_json_success(Value::Object(payload));
        return;
    }

    if mode.is_csv() {
        let rows = data
            .events
            .iter()
            .map(|event| {
                vec![
                    event.event_type.clone(),
                    activity_pool_label(event),
                    event.amount_formatted.clone(),
                    event.review_status.clone(),
                    format_time_ago(event.timestamp_ms),
                    format_tx_hash_short(event.tx_hash.as_deref()),
                ]
            })
            .collect::<Vec<_>>();
        print_csv(vec!["Type", "Pool", "Amount", "Status", "Time", "Tx"], rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    if data.mode == "pool-activity" {
        write_stderr_text(&format!(
            "\nActivity for {} on {}:\n\n",
            data.asset.as_deref().unwrap_or("unknown"),
            data.chain
        ));
    } else {
        let chain_label = data
            .chains
            .as_ref()
            .map(|chains| chains.join(", "))
            .unwrap_or_else(|| data.chain.clone());
        write_stderr_text(&format!("\nGlobal activity ({chain_label}):\n\n"));
    }

    let chain_label = data
        .chains
        .as_ref()
        .map(|chains| chains.join(", "))
        .unwrap_or_else(|| data.chain.clone());
    write_stderr_text(&format_section_heading("Summary"));
    let mut summary_rows = vec![
        ("Mode", data.mode.to_string()),
        ("Scope", chain_label),
        ("Page", data.page.to_string()),
        ("Results", data.events.len().to_string()),
    ];
    if let Some(total) = data.total {
        summary_rows.push(("Total events", total.to_string()));
    }
    write_stderr_text(&format_key_value_rows(&summary_rows));

    if data.events.is_empty() {
        write_stderr_text("No activity found.");
        return;
    }

    let rows = data
        .events
        .iter()
        .map(|event| {
            vec![
                event.event_type.clone(),
                activity_pool_label(event),
                event.amount_formatted.clone(),
                format_asp_approval_status_label(&event.review_status),
                format_time_ago(event.timestamp_ms),
                format_tx_hash_short(event.tx_hash.as_deref()),
            ]
        })
        .collect::<Vec<_>>();
    print_table(vec!["Type", "Pool", "Amount", "Status", "Time", "Tx"], rows);

    if let Some(total_pages) = data.total_pages {
        if total_pages > 1 {
            let total_suffix = data
                .total
                .map(|total| format!(" ({total} events)"))
                .unwrap_or_default();
            let next_suffix = if data.page < total_pages {
                format!(". Next: --page {}", data.page + 1)
            } else {
                String::new()
            };
            write_stderr_text(&format!(
                "\n  Page {} of {}{}{}\n",
                data.page, total_pages, total_suffix, next_suffix
            ));
        }
    }

    if data.chain_filtered {
        write_stderr_text(&format!(
            "\n  Note: Results filtered to {}. Some pages may be sparse.\n",
            data.chain
        ));
    }
}

fn activity_event_to_json(event: NormalizedActivityEvent) -> Value {
    json!({
        "type": event.event_type,
        "txHash": event.tx_hash,
        "explorerUrl": event.explorer_url,
        "reviewStatus": event.review_status,
        "amountRaw": event.amount_raw,
        "amountFormatted": event.amount_formatted,
        "poolSymbol": event.pool_symbol,
        "poolAddress": event.pool_address,
        "chainId": event.chain_id,
        "timestamp": event.timestamp_iso,
    })
}

fn activity_pool_label(event: &NormalizedActivityEvent) -> String {
    match (&event.pool_symbol, event.chain_id) {
        (Some(symbol), Some(chain_id)) => format!("{symbol}@{chain_id}"),
        (Some(symbol), None) => symbol.clone(),
        (None, Some(chain_id)) => format!("chain-{chain_id}"),
        (None, None) => "-".to_string(),
    }
}

fn insert_optional_string(target: &mut Map<String, Value>, key: &str, value: Option<String>) {
    target.insert(
        key.to_string(),
        value.map(Value::String).unwrap_or(Value::Null),
    );
}

fn insert_optional_u64(target: &mut Map<String, Value>, key: &str, value: Option<u64>) {
    target.insert(
        key.to_string(),
        value
            .map(|inner| Value::Number(inner.into()))
            .unwrap_or(Value::Null),
    );
}
