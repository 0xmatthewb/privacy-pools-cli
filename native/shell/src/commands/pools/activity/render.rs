use super::format::{format_asp_approval_status_label, format_tx_hash_short};
use super::model::{ActivityRenderData, NormalizedActivityEvent};
use crate::output::{
    build_next_action, format_activity_direction_label, format_address, format_callout,
    format_command_heading, format_key_value_rows, format_section_heading, format_time_ago,
    print_csv, print_json_success, print_table, render_next_steps, write_stderr_text, CalloutKind,
};
use crate::routing::NativeMode;
use serde_json::{json, Map, Value};

pub(super) fn render_activity_output(mode: &NativeMode, data: ActivityRenderData) {
    if mode.is_json() {
        let asset_for_pagination = data.asset.clone();
        let has_next_page = data
            .total_pages
            .is_some_and(|total_pages| data.page < total_pages);

        let mut payload = Map::new();
        payload.insert("mode".to_string(), Value::String("pools".to_string()));
        payload.insert("action".to_string(), Value::String("activity".to_string()));
        payload.insert(
            "operation".to_string(),
            Value::String("pools.activity".to_string()),
        );
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
        insert_optional_u64(&mut payload, "totalEvents", data.total);
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

        let next_actions = if has_next_page {
            let mut opts = Map::new();
            opts.insert("agent".to_string(), Value::Bool(true));
            opts.insert("page".to_string(), Value::Number((data.page + 1).into()));
            opts.insert("limit".to_string(), Value::Number(data.per_page.into()));
            let next_args = if data.mode == "pool-activity" {
                asset_for_pagination.as_deref().map(|asset| [asset])
            } else {
                None
            };
            if data.chain != "all-mainnets" {
                opts.insert("chain".to_string(), Value::String(data.chain.clone()));
            }
            vec![build_next_action(
                "pools activity",
                "View the next page.",
                "after_activity",
                next_args.as_ref().map(|args| args.as_slice()),
                Some(&opts),
                None,
            )]
        } else if data.mode == "pool-activity" {
            let mut opts = Map::new();
            opts.insert("agent".to_string(), Value::Bool(true));
            opts.insert("chain".to_string(), Value::String(data.chain.clone()));
            let detail_args = asset_for_pagination.as_deref().map(|asset| [asset]);
            vec![build_next_action(
                "pools show",
                "Return to pool discovery after reviewing this activity page.",
                "after_activity",
                detail_args.as_ref().map(|args| args.as_slice()),
                Some(&opts),
                None,
            )]
        } else {
            let mut opts = Map::new();
            opts.insert("agent".to_string(), Value::Bool(true));
            if data.chain != "all-mainnets" {
                opts.insert("chain".to_string(), Value::String(data.chain.clone()));
            }
            vec![build_next_action(
                "accounts",
                "Inspect current Pool Account balances after reviewing public activity.",
                "after_activity",
                None,
                Some(&opts),
                None,
            )]
        };
        payload.insert("nextActions".to_string(), Value::Array(next_actions));

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

    let chain_label = data
        .chains
        .as_ref()
        .map(|chains| chains.join(", "))
        .unwrap_or_else(|| data.chain.clone());
    let header = if data.mode == "pool-activity" {
        format!(
            "Activity for {} on {}:",
            data.asset.as_deref().unwrap_or("unknown"),
            data.chain
        )
    } else {
        format!("Global activity ({chain_label}):")
    };
    write_stderr_text(&format_command_heading(&header));

    write_stderr_text(&format_section_heading("Summary"));
    let mut summary_rows = vec![
        ("Mode", data.mode.to_string()),
        ("Chain", chain_label.clone()),
        ("Page", data.page.to_string()),
        ("Results", data.events.len().to_string()),
    ];
    if let Some(total) = data.total {
        summary_rows.push(("Total events", total.to_string()));
    }
    write_stderr_text(&format_key_value_rows(&summary_rows));

    if data.events.is_empty() {
        write_stderr_text("No activity found.");
        write_stderr_text(&format_callout(
            CalloutKind::ReadOnly,
            &[if data.mode == "pool-activity" {
                format!(
                    "No public activity matched {} on {}. Browse the pool list or check status.",
                    data.asset.as_deref().unwrap_or("this asset"),
                    data.chain
                )
            } else {
                format!(
                    "No public activity matched {}. Browse pools or check status to confirm your setup.",
                    chain_label
                )
            }],
        ));

        let mut next_actions = Vec::<Value>::new();
        let mut status_options = Map::new();
        if data.chain != "all-mainnets" {
            status_options.insert("chain".to_string(), Value::String(data.chain.clone()));
        }
        next_actions.push(build_next_action(
            "status",
            "Check wallet and connection readiness.",
            "no_activity",
            None,
            (!status_options.is_empty()).then_some(&status_options),
            None,
        ));

        let mut pools_options = Map::new();
        if data.chain != "all-mainnets" {
            pools_options.insert("chain".to_string(), Value::String(data.chain.clone()));
        }
        let pools_args = if data.mode == "pool-activity" {
            data.asset
                .as_deref()
                .map(|asset| vec![asset])
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        next_actions.push(build_next_action(
            if data.mode == "pool-activity" {
                "pools show"
            } else {
                "pools"
            },
            if data.mode == "pool-activity" {
                "Open the pool detail view for this asset."
            } else {
                "Browse available pools before depositing."
            },
            "no_activity",
            (!pools_args.is_empty()).then_some(pools_args.as_slice()),
            (!pools_options.is_empty()).then_some(&pools_options),
            None,
        ));

        render_next_steps(&next_actions);
        return;
    }

    let rows = data
        .events
        .iter()
        .map(|event| {
            let mut row = vec![
                format_activity_direction_label(&event.event_type),
                activity_pool_label(event),
                event.amount_formatted.clone(),
                format_asp_approval_status_label(&event.review_status),
                format_time_ago(event.timestamp_ms),
                format_tx_hash_short(event.tx_hash.as_deref()),
            ];
            if mode.is_wide() {
                row.push(
                    event
                        .pool_address
                        .as_deref()
                        .map(|value| format_address(value, 8))
                        .unwrap_or_else(|| "-".to_string()),
                );
                row.push(
                    event
                        .chain_id
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "-".to_string()),
                );
            }
            row
        })
        .collect::<Vec<_>>();
    let headers = if mode.is_wide() {
        vec![
            "Type",
            "Pool",
            "Amount",
            "Status",
            "Time",
            "Tx",
            "Pool Address",
            "Chain",
        ]
    } else {
        vec!["Type", "Pool", "Amount", "Status", "Time", "Tx"]
    };
    print_table(headers, rows);

    let mut next_actions = Vec::<Value>::new();
    if let Some(total_pages) = data.total_pages {
        if total_pages > 1 {
            let total_suffix = data
                .total
                .map(|total| format!(" · {total} events"))
                .unwrap_or_default();
            let next_line = if data.page < total_pages {
                format!("\n  privacy-pools pools activity --page {}", data.page + 1)
            } else {
                String::new()
            };
            write_stderr_text(&format!(
                "\n  Page {} of {}{}{}\n",
                data.page, total_pages, total_suffix, next_line
            ));
        }
        if data.page < total_pages {
            let mut opts = Map::new();
            opts.insert("page".to_string(), Value::Number((data.page + 1).into()));
            opts.insert("limit".to_string(), Value::Number(data.per_page.into()));
            let next_args = if data.mode == "pool-activity" {
                data.asset.as_deref().map(|asset| [asset])
            } else {
                None
            };
            if data.chain != "all-mainnets" {
                opts.insert("chain".to_string(), Value::String(data.chain.clone()));
            }
            next_actions.push(build_next_action(
                "pools activity",
                "View the next page.",
                "after_activity",
                next_args.as_ref().map(|args| args.as_slice()),
                Some(&opts),
                None,
            ));
        }
    }

    if data.chain_filtered {
        write_stderr_text(&format_callout(
            CalloutKind::ReadOnly,
            &[format!(
                "Results are filtered to {}. Some pages may be sparse.",
                data.chain
            )],
        ));
    }

    render_next_steps(&next_actions);
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
