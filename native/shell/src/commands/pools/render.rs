use super::model::{
    ChainSummary, PoolDetailActivityEvent, PoolDetailRenderData, PoolListingEntry, PoolWarning,
    PoolsRenderData,
};
use crate::output::{
    build_next_action, format_activity_direction_label, format_address, format_callout,
    format_command_heading, format_count_number, format_key_value_rows, format_section_heading,
    insert_optional_f64, insert_optional_string, insert_optional_u64, print_csv,
    print_json_success, print_table, render_next_steps, write_info, write_stderr_text, CalloutKind,
};
use crate::routing::NativeMode;
use serde_json::{json, Map, Value};

fn build_pools_empty_json_payload(data: &PoolsRenderData) -> Value {
    let mut status_options = Map::new();
    status_options.insert("agent".to_string(), Value::Bool(true));
    if !data.all_chains {
        status_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
    }
    let next_actions = Value::Array(vec![build_next_action(
        "status",
        "Check CLI and chain connectivity.",
        "no_pools_found",
        None,
        Some(&status_options),
        None,
    )]);

    if data.all_chains {
        json!({
            "chain": data.chain_name,
            "search": data.search,
            "sort": data.sort,
            "chainSummaries": data.chain_summaries.clone().unwrap_or_default().into_iter().map(chain_summary_to_json).collect::<Vec<_>>(),
            "pools": [],
            "nextActions": next_actions,
        })
    } else {
        json!({
            "chain": data.chain_name,
            "search": data.search,
            "sort": data.sort,
            "pools": [],
            "nextActions": next_actions,
        })
    }
}

pub(super) fn render_pools_empty_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        print_json_success(build_pools_empty_json_payload(&data));
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

    write_stderr_text(&format_callout(
        CalloutKind::ReadOnly,
        &[if data.all_chains {
            "Try checking status or browsing public activity to confirm the current network state."
                .to_string()
        } else {
            format!(
                "Try checking status on {} or browsing public activity on the same chain.",
                data.chain_name
            )
        }],
    ));

    let mut next_actions = Vec::<Value>::new();
    let mut status_options = Map::new();
    if !data.all_chains {
        status_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
    }
    next_actions.push(build_next_action(
        "status",
        "Check wallet and connection readiness.",
        "no_pools_found",
        None,
        (!status_options.is_empty()).then_some(&status_options),
        None,
    ));

    let mut activity_options = Map::new();
    if !data.all_chains {
        activity_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
    }
    next_actions.push(build_next_action(
        "activity",
        if data.all_chains {
            "Review public activity before depositing."
        } else {
            "Review public activity on this chain before depositing."
        },
        "no_pools_found",
        None,
        (!activity_options.is_empty()).then_some(&activity_options),
        None,
    ));

    render_next_steps(&next_actions);
}

pub(super) fn render_pools_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        let next_actions = Value::Array(vec![build_deposit_template_next_action(&data)]);

        if data.all_chains {
            let mut payload = Map::new();
            payload.insert("chain".to_string(), Value::String(data.chain_name));
            payload.insert(
                "search".to_string(),
                data.search.map(Value::String).unwrap_or(Value::Null),
            );
            payload.insert("sort".to_string(), Value::String(data.sort));
            payload.insert(
                "chainSummaries".to_string(),
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
            .map(|entry| pool_listing_csv_row(entry, data.all_chains))
            .collect::<Vec<_>>();
        print_csv(headers, rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    let header = if data.all_chains {
        "Pools across supported chains:".to_string()
    } else {
        format!("Pools on {}:", data.chain_name)
    };
    write_stderr_text(&format_command_heading(&header));

    if !data.warnings.is_empty() {
        write_stderr_text(&format_callout(
            CalloutKind::Warning,
            &data
                .warnings
                .iter()
                .map(|warning| {
                    format!(
                        "{} ({}): {}",
                        warning.chain, warning.category, warning.message
                    )
                })
                .collect::<Vec<_>>(),
        ));
    }

    if data.filtered_pools.is_empty() {
        if let Some(search) = data.search {
            if !search.is_empty() {
                write_info(&format!("No pools matched search query \"{search}\"."));
                let mut status_options = Map::new();
                if !data.all_chains {
                    status_options
                        .insert("chain".to_string(), Value::String(data.chain_name.clone()));
                }
                render_next_steps(&[build_next_action(
                    "status",
                    "Check wallet and connection readiness.",
                    "no_pools",
                    None,
                    (!status_options.is_empty()).then_some(&status_options),
                    None,
                )]);
                return;
            }
        }
        write_info("No pools found.");
        write_stderr_text(&format_callout(
            CalloutKind::ReadOnly,
            &[if data.all_chains {
                "Try checking status or browsing public activity to confirm the current network state."
                    .to_string()
            } else {
                format!(
                    "Try checking status on {} or browsing public activity on the same chain.",
                    data.chain_name
                )
            }],
        ));
        let mut next_actions = Vec::<Value>::new();
        let mut status_options = Map::new();
        if !data.all_chains {
            status_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
        }
        next_actions.push(build_next_action(
            "status",
            "Check wallet and connection readiness.",
            "no_pools",
            None,
            (!status_options.is_empty()).then_some(&status_options),
            None,
        ));
        let mut activity_options = Map::new();
        if !data.all_chains {
            activity_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
        }
        next_actions.push(build_next_action(
            "activity",
            if data.all_chains {
                "Review public activity before depositing."
            } else {
                "Review public activity on this chain before depositing."
            },
            "no_pools",
            None,
            (!activity_options.is_empty()).then_some(&activity_options),
            None,
        ));
        render_next_steps(&next_actions);
        return;
    }

    let mut summary_rows = vec![
        (
            "Chain",
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

    let mut headers = if data.all_chains {
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
    if mode.is_wide() {
        headers.extend(["Pool Address", "Scope"]);
    }
    let rows = data
        .filtered_pools
        .iter()
        .map(|entry| pool_listing_row(entry, data.all_chains, mode.is_wide()))
        .collect::<Vec<_>>();
    print_table(headers, rows);

    let mut next_actions = Vec::<Value>::new();
    if data.filtered_pools.len() == 1 {
        let entry = &data.filtered_pools[0];
        let mut detail_options = Map::new();
        let detail_args = [entry.asset.as_str()];
        if data.all_chains {
            detail_options.insert("chain".to_string(), Value::String(entry.chain.clone()));
        } else {
            detail_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
        }
        next_actions.push(build_next_action(
            "pools",
            "Open the detailed view for this pool.",
            "after_pools",
            Some(&detail_args),
            Some(&detail_options),
            None,
        ));
    }

    let mut activity_options = Map::new();
    if !data.all_chains {
        activity_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
    }
    next_actions.push(build_next_action(
        "activity",
        "Review recent public activity before depositing.",
        "after_pools",
        None,
        (!activity_options.is_empty()).then_some(&activity_options),
        None,
    ));

    render_next_steps(&next_actions);
}

fn build_deposit_template_next_action(data: &PoolsRenderData) -> Value {
    let mut action = Map::new();
    action.insert("command".to_string(), Value::String("deposit".to_string()));
    action.insert(
        "reason".to_string(),
        Value::String("Deposit into a pool.".to_string()),
    );
    action.insert("when".to_string(), Value::String("after_pools".to_string()));
    action.insert("runnable".to_string(), Value::Bool(false));
    action.insert(
        "parameters".to_string(),
        Value::Array(vec![
            json!({
                "name": "amount",
                "type": "token_amount",
                "required": true,
            }),
            json!({
                "name": "asset",
                "type": "asset_symbol",
                "required": true,
            }),
        ]),
    );

    if !data.all_chains {
        let mut options = Map::new();
        options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
        action.insert("options".to_string(), Value::Object(options));
    }

    Value::Object(action)
}

pub(super) fn render_pool_detail_output(mode: &NativeMode, data: PoolDetailRenderData) {
    if mode.is_quiet {
        return;
    }

    write_stderr_text(&format_command_heading(&format!(
        "{} Pool on {}",
        data.asset, data.chain_name
    )));

    write_stderr_text(&format_section_heading("Summary"));
    let pool_balance = format_pool_stat_amount(
        data.total_in_pool_value.as_deref(),
        data.decimals,
        &data.asset,
    );
    let pending_funds = format_pool_stat_amount(
        data.pending_deposits_value.as_deref(),
        data.decimals,
        &data.asset,
    );
    let all_time_deposits = format_pool_stat_amount(
        data.total_deposits_value.as_deref(),
        data.decimals,
        &data.asset,
    );
    write_stderr_text(&format_key_value_rows(&[
        (
            "Pool Balance",
            format!(
                "{} ({})",
                pool_balance,
                parse_usd_string(data.total_in_pool_value_usd.as_deref())
            ),
        ),
        (
            "Pending Funds",
            format!(
                "{} ({})",
                pending_funds,
                parse_usd_string(data.pending_deposits_value_usd.as_deref())
            ),
        ),
        (
            "All-Time Deposits",
            format!(
                "{} ({})",
                all_time_deposits,
                parse_usd_string(data.total_deposits_value_usd.as_deref())
            ),
        ),
        (
            "Total Deposits",
            data.total_deposits_count
                .map(format_count_number)
                .unwrap_or_else(|| "-".to_string()),
        ),
        (
            "Min Deposit",
            parse_biguint(&data.minimum_deposit)
                .map(|value| format_amount(&value, data.decimals, Some(&data.asset), Some(2)))
                .unwrap_or_else(|| data.minimum_deposit.clone()),
        ),
        ("Vetting Fee", format_bps_value(&data.vetting_fee_bps)),
        ("Max Relay Fee", format_bps_value(&data.max_relay_fee_bps)),
        ("Pool Address", format_address(&data.pool, 6)),
        ("Token", format_address(&data.token_address, 6)),
        ("Scope", data.scope.clone()),
    ]));

    write_stderr_text(&format_section_heading("My funds"));
    if let Some(my_funds) = data.my_funds.clone() {
        let mut summary = vec![
            (
                "Balance",
                parse_biguint(&my_funds.balance)
                    .map(|value| format_amount(&value, data.decimals, Some(&data.asset), Some(2)))
                    .unwrap_or_else(|| my_funds.balance.clone()),
            ),
            (
                "Pool Accounts",
                format!(
                    "{}{}",
                    format_count_number(my_funds.pool_accounts),
                    format_review_summary(
                        my_funds.pending_count,
                        my_funds.poa_required_count,
                        my_funds.declined_count,
                    )
                ),
            ),
        ];
        if let Some(usd_value) = my_funds.usd_value.clone() {
            summary.push(("Balance USD", usd_value));
        }
        write_stderr_text(&format_key_value_rows(&summary));
        write_stderr_text(&format_callout(
            CalloutKind::Success,
            &[
                if my_funds.pending_count == 0
                    && my_funds.poa_required_count == 0
                    && my_funds.declined_count == 0
                {
                    "Wallet funds loaded successfully. Approved Pool Accounts in this pool are ready for withdraw.".to_string()
                } else {
                    "Wallet funds loaded successfully. Review each Pool Account status below before choosing withdraw or ragequit.".to_string()
                },
            ],
        ));

        if !my_funds.accounts.is_empty() {
            let rows = my_funds
                .accounts
                .iter()
                .map(|account| {
                    vec![
                        account.id.clone(),
                        parse_biguint(&account.value)
                            .map(|value| {
                                format_amount(&value, data.decimals, Some(&data.asset), Some(2))
                            })
                            .unwrap_or_else(|| account.value.clone()),
                        format_pool_account_status(&account.status),
                    ]
                })
                .collect::<Vec<_>>();
            print_table(vec!["PA", "Amount", "Status"], rows);
        }

        if let Some(warning) = data.my_funds_warning.clone() {
            write_stderr_text(&format_callout(CalloutKind::Warning, &[warning]));
        }
        if my_funds.declined_count > 0 {
            write_stderr_text(&format_callout(
                CalloutKind::Danger,
                &[String::from(
                    "Declined Pool Accounts cannot use withdraw. Use ragequit for public recovery to the original deposit address.",
                )],
            ));
        }
        if my_funds.poa_required_count > 0 {
            write_stderr_text(&format_callout(
                CalloutKind::Recovery,
                &[String::from(
                    "PoA-needed Pool Accounts cannot use withdraw yet. Complete Proof of Association first, or recover publicly instead.",
                )],
            ));
        }
    } else if let Some(warning) = data.my_funds_warning.clone() {
        write_stderr_text(&format_callout(CalloutKind::Warning, &[warning]));
    } else {
        write_stderr_text(&format_callout(
            CalloutKind::ReadOnly,
            &[String::from(
                "Run privacy-pools init to load your wallet funds here.",
            )],
        ));
    }

    write_stderr_text(&format_section_heading("Recent activity"));
    match data.recent_activity.clone() {
        Some(events) if !events.is_empty() => {
            let rows = events.iter().map(activity_row).collect::<Vec<_>>();
            print_table(vec!["Type", "Amount", "Time", "Status"], rows);
        }
        _ => {
            write_stderr_text(&format_callout(
                CalloutKind::ReadOnly,
                &[format!(
                    "No recent public activity is available for {} on {} right now.",
                    data.asset, data.chain_name
                )],
            ));
        }
    }
    write_stderr_text(&format_callout(
        CalloutKind::Privacy,
        &[format!(
            "Public activity is visible onchain. Private withdrawals still require an ASP-approved Pool Account on {}.",
            data.chain_name
        )],
    ));

    let mut next_actions = Vec::<Value>::new();
    let mut activity_options = Map::new();
    activity_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
    activity_options.insert("asset".to_string(), Value::String(data.asset.clone()));
    next_actions.push(build_next_action(
        "activity",
        "Review recent public activity for this pool.",
        "after_pool_detail",
        None,
        Some(&activity_options),
        None,
    ));

    let mut accounts_options = Map::new();
    accounts_options.insert("chain".to_string(), Value::String(data.chain_name.clone()));
    next_actions.push(build_next_action(
        "accounts",
        "Inspect your Pool Accounts on this chain.",
        "after_pool_detail",
        None,
        Some(&accounts_options),
        None,
    ));

    render_next_steps(&next_actions);
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
        entry
            .total_in_pool_value_usd
            .as_deref()
            .and_then(normalize_usd_json),
    );
    insert_optional_string(
        &mut object,
        "totalDepositsValue",
        entry.total_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalDepositsValueUsd",
        entry
            .total_deposits_value_usd
            .as_deref()
            .and_then(normalize_usd_json),
    );
    insert_optional_string(
        &mut object,
        "acceptedDepositsValue",
        entry.accepted_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "acceptedDepositsValueUsd",
        entry
            .accepted_deposits_value_usd
            .as_deref()
            .and_then(normalize_usd_json),
    );
    insert_optional_string(
        &mut object,
        "pendingDepositsValue",
        entry.pending_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "pendingDepositsValueUsd",
        entry
            .pending_deposits_value_usd
            .as_deref()
            .and_then(normalize_usd_json),
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
    insert_optional_u64(
        &mut object,
        "myPoolAccountsCount",
        entry.my_pool_accounts_count,
    );
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

fn pool_listing_row(entry: &PoolListingEntry, include_chain: bool, is_wide: bool) -> Vec<String> {
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
    if is_wide {
        row.push(format_address(&entry.pool, 8));
        row.push(entry.scope.clone());
    }
    row
}

fn pool_listing_csv_row(entry: &PoolListingEntry, include_chain: bool) -> Vec<String> {
    let mut row = Vec::new();
    if include_chain {
        row.push(entry.chain.clone());
    }
    row.push(entry.asset.clone());
    row.push(
        entry
            .total_deposits_count
            .map(|count| count.to_string())
            .unwrap_or_default(),
    );
    row.push(
        entry
            .total_in_pool_value
            .clone()
            .or_else(|| entry.accepted_deposits_value.clone())
            .unwrap_or_default(),
    );
    row.push(
        entry
            .total_in_pool_value_usd
            .as_deref()
            .or(entry.accepted_deposits_value_usd.as_deref())
            .and_then(normalize_usd_json)
            .unwrap_or_default(),
    );
    row.push(entry.pending_deposits_value.clone().unwrap_or_default());
    row.push(entry.minimum_deposit.clone());
    row.push(entry.vetting_fee_bps.clone());
    row
}

fn format_pool_deposits_count(entry: &PoolListingEntry) -> String {
    entry
        .total_deposits_count
        .map(format_count_number)
        .unwrap_or_else(|| "-".to_string())
}

fn format_review_summary(
    pending_count: u64,
    poa_required_count: u64,
    declined_count: u64,
) -> String {
    let mut parts = Vec::new();
    if pending_count > 0 {
        parts.push(format!("{} pending", format_count_number(pending_count)));
    }
    if poa_required_count > 0 {
        parts.push(format!(
            "{} PoA needed",
            format_count_number(poa_required_count)
        ));
    }
    if declined_count > 0 {
        parts.push(format!("{} declined", format_count_number(declined_count)));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ({})", parts.join(", "))
    }
}

fn format_pool_account_status(status: &str) -> String {
    match status {
        "approved" => crate::output::format_success_text("approved"),
        "pending" => crate::output::format_notice_text("pending"),
        "poa_required" | "poi_required" => crate::output::format_notice_text("PoA needed"),
        "declined" => crate::output::format_danger_text("declined"),
        "unknown" => crate::output::format_muted_text("unknown"),
        other => other.to_string(),
    }
}

fn activity_row(event: &PoolDetailActivityEvent) -> Vec<String> {
    vec![
        format_activity_direction_label(&event.event_type),
        event.amount.clone(),
        event.time_label.clone(),
        format_pool_account_status(&event.status),
    ]
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

fn normalize_usd_json(value: &str) -> Option<String> {
    let normalized = value.trim().replace('$', "").replace(',', "");
    if normalized.is_empty() {
        return None;
    }
    normalized
        .parse::<f64>()
        .ok()
        .filter(|parsed| parsed.is_finite())
        .map(|_| normalized)
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
    use crate::commands::pools::model::{PoolDetailAccount, PoolDetailMyFunds};
    use crate::routing::OutputFormat;

    fn table_mode() -> NativeMode {
        NativeMode {
            format: OutputFormat::Table,
            is_wide: false,
            is_quiet: false,
        }
    }

    fn wide_mode() -> NativeMode {
        NativeMode {
            format: OutputFormat::Table,
            is_wide: true,
            is_quiet: false,
        }
    }

    fn csv_mode() -> NativeMode {
        NativeMode {
            format: OutputFormat::Csv,
            is_wide: false,
            is_quiet: false,
        }
    }

    fn json_mode() -> NativeMode {
        NativeMode {
            format: OutputFormat::Json,
            is_wide: false,
            is_quiet: false,
        }
    }

    fn quiet_mode() -> NativeMode {
        NativeMode {
            format: OutputFormat::Table,
            is_wide: false,
            is_quiet: true,
        }
    }

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
            my_pool_accounts_count: Some(0),
        }
    }

    fn sample_warning() -> PoolWarning {
        PoolWarning {
            chain: "mainnet".to_string(),
            category: "rpc".to_string(),
            message: "retry later".to_string(),
        }
    }

    fn sample_chain_summary() -> ChainSummary {
        ChainSummary {
            chain: "mainnet".to_string(),
            pools: 1,
            error: None,
        }
    }

    fn sample_pools_render_data(all_chains: bool) -> PoolsRenderData {
        PoolsRenderData {
            all_chains,
            chain_name: if all_chains {
                "all-mainnets".to_string()
            } else {
                "mainnet".to_string()
            },
            search: None,
            sort: "tvl-desc".to_string(),
            filtered_pools: vec![sample_entry()],
            chain_summaries: all_chains.then(|| vec![sample_chain_summary()]),
            warnings: vec![],
        }
    }

    fn sample_detail_data() -> PoolDetailRenderData {
        PoolDetailRenderData {
            chain_name: "mainnet".to_string(),
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
            pending_deposits_value: Some("500000000000000000".to_string()),
            pending_deposits_value_usd: Some("134.00".to_string()),
            total_deposits_count: Some(42),
            my_funds: Some(PoolDetailMyFunds {
                balance: "4000000000000000000".to_string(),
                usd_value: Some("$1,000.00".to_string()),
                pool_accounts: 3,
                pending_count: 0,
                poa_required_count: 0,
                declined_count: 0,
                accounts: vec![
                    PoolDetailAccount {
                        id: "PA-1".to_string(),
                        status: "approved".to_string(),
                        value: "2500000000000000000".to_string(),
                    },
                    PoolDetailAccount {
                        id: "PA-2".to_string(),
                        status: "pending".to_string(),
                        value: "1500000000000000000".to_string(),
                    },
                ],
            }),
            my_funds_warning: None,
            recent_activity: Some(vec![PoolDetailActivityEvent {
                event_type: "withdrawal".to_string(),
                amount: "0.5 ETH".to_string(),
                time_label: "5m ago".to_string(),
                status: "approved".to_string(),
            }]),
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
        assert_eq!(with_chain["myPoolAccountsCount"], Value::Number(0.into()));

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
        assert_eq!(sparse_json["myPoolAccountsCount"], Value::Number(0.into()));
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
        let single = pool_listing_row(&entry, false, false);
        assert_eq!(single[0], "ETH");
        assert_eq!(single[1], "42");
        assert_eq!(single[2], "5 ETH");
        assert_eq!(single[3], "$1,234");
        assert_eq!(single[4], "0.5 ETH");
        assert_eq!(single[5], "0.001 ETH");
        assert_eq!(single[6], "0.50%");

        let multi = pool_listing_row(&entry, true, false);
        assert_eq!(multi[0], "mainnet");
        assert_eq!(multi[1], "ETH");

        let wide = pool_listing_row(&entry, false, true);
        assert_eq!(wide[7], "0x22222222...22222222");
        assert_eq!(wide[8], "12345");
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

    #[test]
    fn empty_pools_json_payload_includes_parity_next_actions() {
        let payload = build_pools_empty_json_payload(&PoolsRenderData {
            all_chains: false,
            chain_name: "sepolia".to_string(),
            search: None,
            sort: "tvl-desc".to_string(),
            filtered_pools: vec![],
            chain_summaries: None,
            warnings: vec![],
        });

        assert_eq!(payload["chain"], Value::String("sepolia".to_string()));
        assert_eq!(payload["pools"], Value::Array(vec![]));
        assert_eq!(
            payload["nextActions"][0]["command"],
            Value::String("status".to_string())
        );
        assert_eq!(
            payload["nextActions"][0]["when"],
            Value::String("no_pools_found".to_string())
        );
        assert_eq!(
            payload["nextActions"][0]["cliCommand"],
            Value::String("privacy-pools status --agent --chain sepolia".to_string())
        );
    }

    #[test]
    fn render_pools_empty_output_covers_supported_modes() {
        let single_chain = sample_pools_render_data(false);
        render_pools_empty_output(&json_mode(), single_chain.clone());
        render_pools_empty_output(&csv_mode(), single_chain.clone());
        render_pools_empty_output(&quiet_mode(), single_chain.clone());
        render_pools_empty_output(&table_mode(), single_chain);

        let mut all_chains = sample_pools_render_data(true);
        all_chains.filtered_pools.clear();
        render_pools_empty_output(&table_mode(), all_chains);
    }

    #[test]
    fn render_pools_output_covers_json_csv_empty_and_human_variants() {
        let mut json_all_chains = sample_pools_render_data(true);
        json_all_chains.search = Some("ETH".to_string());
        json_all_chains.warnings = vec![sample_warning()];
        render_pools_output(&json_mode(), json_all_chains.clone());
        render_pools_output(&csv_mode(), json_all_chains.clone());

        let mut json_single_chain = sample_pools_render_data(false);
        json_single_chain.search = Some("ETH".to_string());
        render_pools_output(&json_mode(), json_single_chain.clone());
        render_pools_output(&csv_mode(), json_single_chain.clone());
        render_pools_output(&quiet_mode(), json_single_chain.clone());

        let mut empty_with_search = sample_pools_render_data(false);
        empty_with_search.filtered_pools.clear();
        empty_with_search.search = Some("zzz".to_string());
        render_pools_output(&table_mode(), empty_with_search);

        let mut empty_all_chains = sample_pools_render_data(true);
        empty_all_chains.filtered_pools.clear();
        render_pools_output(&table_mode(), empty_all_chains);

        let mut single_chain_wide = sample_pools_render_data(false);
        single_chain_wide.search = Some("ETH".to_string());
        single_chain_wide.warnings = vec![sample_warning()];
        render_pools_output(&wide_mode(), single_chain_wide);

        let all_chains_wide = sample_pools_render_data(true);
        render_pools_output(&wide_mode(), all_chains_wide);
    }

    #[test]
    fn render_pool_detail_output_covers_wallet_and_activity_variants() {
        let ready = sample_detail_data();
        render_pool_detail_output(&quiet_mode(), ready.clone());
        render_pool_detail_output(&table_mode(), ready.clone());

        let mut mixed_status = sample_detail_data();
        mixed_status.my_funds = Some(PoolDetailMyFunds {
            balance: "4000000000000000000".to_string(),
            usd_value: None,
            pool_accounts: 3,
            pending_count: 1,
            poa_required_count: 1,
            declined_count: 1,
            accounts: vec![],
        });
        mixed_status.my_funds_warning = Some("Balance may be stale.".to_string());
        mixed_status.recent_activity = None;
        render_pool_detail_output(&table_mode(), mixed_status);

        let mut warning_only = sample_detail_data();
        warning_only.my_funds = None;
        warning_only.my_funds_warning = Some("Wallet sync unavailable.".to_string());
        warning_only.recent_activity = Some(vec![]);
        render_pool_detail_output(&table_mode(), warning_only);

        let mut read_only = sample_detail_data();
        read_only.my_funds = None;
        read_only.my_funds_warning = None;
        read_only.recent_activity = None;
        render_pool_detail_output(&table_mode(), read_only);
    }
}
