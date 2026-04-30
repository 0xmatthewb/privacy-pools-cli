use crate::commands::pools::{default_read_only_chains, resolve_pool_native};
use crate::config::{load_config, resolve_chain};
use crate::contract::Manifest;
use crate::error::CliError;
use crate::output::{
    build_next_action, format_command_heading, format_count_number, format_key_value_rows,
    format_section_heading, print_csv, print_json_success, print_table, render_next_steps,
    should_render_wide_tables, start_spinner, write_stderr_text,
};
use crate::parse_timeout_ms;
use crate::read_only_api::{fetch_global_statistics, fetch_pool_statistics};
use crate::root_argv::{has_short_flag, ParsedRootArgv};
use crate::routing::{resolve_mode, NativeMode};
use serde_json::{json, Map, Value};

#[derive(Debug, Clone)]
struct GlobalStatsRenderData {
    chain: String,
    chains: Vec<String>,
    cache_timestamp: Value,
    all_time: Value,
    last_24h: Value,
}

#[derive(Debug, Clone)]
struct PoolStatsRenderData {
    chain: String,
    asset: String,
    pool: String,
    scope: String,
    cache_timestamp: Value,
    all_time: Value,
    last_24h: Value,
}

pub fn handle_stats_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    {
        if has_short_flag(argv, 't') {
            return Err(crate::dispatch::commander_unknown_option_error(
                "-t",
                &["--limit"],
            ));
        }

        let mode = resolve_mode(parsed);
        let stats_tokens = stats_non_option_tokens(argv);
        let is_pool = matches!(
            stats_tokens.as_slice(),
            [root, subcommand, _asset] if root == "pools" && subcommand == "stats"
        );

        if is_pool {
            let asset = stats_tokens.get(2).cloned().ok_or_else(|| {
                CliError::input_with_code(
                    "Missing asset argument.",
                    Some("Example: privacy-pools pools stats ETH".to_string()),
                    "INPUT_MISSING_ASSET",
                )
            })?;
            let mut loading = (!mode.is_json() && !mode.is_quiet)
                .then(|| start_spinner("Fetching pool statistics..."));
            let config = load_config()?;
            let explicit_chain = parsed
                .global_chain()
                .unwrap_or_else(|| config.default_chain.clone());
            let chain = resolve_chain(&explicit_chain, manifest)?;
            let timeout_ms = parse_timeout_ms(argv);
            let pool = resolve_pool_native(
                &chain,
                &asset,
                parsed.global_rpc_url(),
                &config,
                manifest,
                timeout_ms,
            )?;
            let response = fetch_pool_statistics(&chain, &pool.scope, timeout_ms)?;
            let pool_stats = response.get("pool").and_then(Value::as_object);

            if let Some(spinner) = loading.as_mut() {
                spinner.stop();
            }
            render_pool_stats_output(
                &mode,
                PoolStatsRenderData {
                    chain: chain.name,
                    asset: pool.symbol,
                    pool: pool.pool_address,
                    scope: pool.scope,
                    cache_timestamp: response
                        .get("cacheTimestamp")
                        .cloned()
                        .unwrap_or(Value::Null),
                    all_time: pool_stats
                        .and_then(|stats| stats.get("allTime"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    last_24h: pool_stats
                        .and_then(|stats| stats.get("last24h"))
                        .cloned()
                        .unwrap_or(Value::Null),
                },
            );

            return Ok(0);
        }

        if parsed.global_chain().is_some() {
            return Err(CliError::input_with_code(
                "Global statistics are aggregated across all chains. The --chain flag is not supported for this subcommand.",
                Some(
                    "For chain-specific data use: privacy-pools pools stats <symbol> --chain <chain>"
                        .to_string(),
                ),
                "INPUT_FLAG_CONFLICT",
            ));
        }

        let chains = default_read_only_chains(manifest);
        let representative_chain = chains.first().ok_or_else(|| {
            CliError::unknown(
                "No default read-only chains configured.",
                Some("Regenerate the native command manifest.".to_string()),
            )
        })?;
        let mut loading = (!mode.is_json() && !mode.is_quiet)
            .then(|| start_spinner("Fetching global statistics..."));
        let response = fetch_global_statistics(representative_chain, parse_timeout_ms(argv))?;

        if let Some(spinner) = loading.as_mut() {
            spinner.stop();
        }
        render_global_stats_output(
            &mode,
            GlobalStatsRenderData {
                chain: "all-mainnets".to_string(),
                chains: chains
                    .iter()
                    .map(|chain| chain.name.clone())
                    .collect::<Vec<_>>(),
                cache_timestamp: response
                    .get("cacheTimestamp")
                    .cloned()
                    .unwrap_or(Value::Null),
                all_time: response.get("allTime").cloned().unwrap_or(Value::Null),
                last_24h: response.get("last24h").cloned().unwrap_or(Value::Null),
            },
        );

        Ok(0)
    }
}

fn stats_non_option_tokens(argv: &[String]) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            tokens.extend(argv.iter().skip(index + 1).cloned());
            break;
        }
        if token == "--limit"
            || token == "-n"
            || crate::root_argv::is_command_global_value_option(token)
        {
            index += 2;
            continue;
        }
        if token.starts_with("--limit=")
            || crate::root_argv::is_command_global_inline_value_option(token)
            || crate::root_argv::is_command_global_boolean_option(token)
        {
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            index += 1;
            continue;
        }
        tokens.push(token.clone());
        index += 1;
    }
    tokens
}

fn normalize_cross_asset_stats(mut stats: Value) -> Value {
    let should_null_tvl = stats
        .as_object()
        .map(|object| {
            object.get("tvl").and_then(Value::as_str) == Some("0") && object.get("tvlUsd").is_some()
        })
        .unwrap_or(false);
    if should_null_tvl {
        if let Some(object) = stats.as_object_mut() {
            object.insert("tvl".to_string(), Value::Null);
        }
    }
    stats
}

fn render_global_stats_output(mode: &NativeMode, data: GlobalStatsRenderData) {
    if mode.is_json() {
        let mut options = Map::new();
        options.insert("agent".to_string(), Value::Bool(true));
        let payload = json!({
            "mode": "pools",
            "action": "stats",
            "operation": "pools.stats",
            "chain": data.chain,
            "chains": data.chains,
            "cacheTimestamp": data.cache_timestamp,
            "allTime": normalize_cross_asset_stats(data.all_time),
            "last24h": normalize_cross_asset_stats(data.last_24h),
            "nextActions": [build_next_action(
                "pools",
                "Browse live pool balances and minimum deposits.",
                "after_stats",
                None,
                Some(&options),
                None,
            )],
        });
        print_json_success(payload);
        return;
    }

    let rows = stats_rows(&data.all_time, &data.last_24h);
    if mode.is_csv() {
        print_csv(vec!["Metric", "All Time", "Last 24h"], rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    write_stderr_text(&format_command_heading(&format!(
        "Global statistics ({}):",
        data.chain
    )));
    write_stderr_text(&format_section_heading("Summary"));
    let mut summary_rows = vec![("Chain", data.chain.clone())];
    let cache_timestamp = value_as_display_string(&data.cache_timestamp, "");
    if !cache_timestamp.is_empty() {
        summary_rows.push(("Cache timestamp", cache_timestamp));
    }
    write_stderr_text(&format_key_value_rows(&summary_rows));
    render_stats_human_rows(mode, &rows);

    render_next_steps(&[build_next_action(
        "pools",
        "Browse live pool balances and minimum deposits.",
        "after_stats",
        None,
        None,
        None,
    )]);
}

fn render_pool_stats_output(mode: &NativeMode, data: PoolStatsRenderData) {
    if mode.is_json() {
        let mut options = Map::new();
        options.insert("agent".to_string(), Value::Bool(true));
        options.insert("chain".to_string(), Value::String(data.chain.clone()));
        let args = [data.asset.as_str()];
        let payload = json!({
            "mode": "pools",
            "action": "stats",
            "operation": "pools.stats",
            "chain": data.chain,
            "asset": data.asset,
            "pool": data.pool,
            "scope": data.scope,
            "cacheTimestamp": data.cache_timestamp,
            "allTime": data.all_time,
            "last24h": data.last_24h,
            "nextActions": [build_next_action(
                "pools show",
                "Open the detailed view for this pool.",
                "after_pool_stats",
                Some(&args),
                Some(&options),
                None,
            )],
        });
        print_json_success(payload);
        return;
    }

    let rows = stats_rows(&data.all_time, &data.last_24h);
    if mode.is_csv() {
        print_csv(vec!["Metric", "All Time", "Last 24h"], rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    write_stderr_text(&format_command_heading(&format!(
        "Pool statistics for {} on {}:",
        data.asset, data.chain
    )));
    write_stderr_text(&format_section_heading("Summary"));
    let mut summary_rows = vec![("Asset", data.asset.clone()), ("Chain", data.chain.clone())];
    let cache_timestamp = value_as_display_string(&data.cache_timestamp, "");
    if !cache_timestamp.is_empty() {
        summary_rows.push(("Cache timestamp", cache_timestamp));
    }
    write_stderr_text(&format_key_value_rows(&summary_rows));
    render_stats_human_rows(mode, &rows);

    let mut options = Map::new();
    options.insert("chain".to_string(), Value::String(data.chain.clone()));
    let args = [data.asset.as_str()];
    render_next_steps(&[build_next_action(
        "pools show",
        "Open the detailed view for this pool.",
        "after_pool_stats",
        Some(&args),
        Some(&options),
        None,
    )]);
}

fn stats_rows(all_time: &Value, last_24h: &Value) -> Vec<Vec<String>> {
    vec![
        vec![
            "Current TVL".to_string(),
            parse_usd_value(all_time.get("tvlUsd")),
            parse_usd_value(last_24h.get("tvlUsd")),
        ],
        vec![
            "Avg Deposit Size".to_string(),
            parse_usd_value(all_time.get("avgDepositSizeUsd")),
            parse_usd_value(last_24h.get("avgDepositSizeUsd")),
        ],
        vec![
            "Total Deposits".to_string(),
            parse_count_value(all_time.get("totalDepositsCount")),
            parse_count_value(last_24h.get("totalDepositsCount")),
        ],
        vec![
            "Total Withdrawals".to_string(),
            parse_count_value(all_time.get("totalWithdrawalsCount")),
            parse_count_value(last_24h.get("totalWithdrawalsCount")),
        ],
    ]
}

fn render_stats_human_rows(mode: &NativeMode, rows: &[Vec<String>]) {
    if should_render_wide_tables(mode.is_wide()) {
        print_table(vec!["Metric", "All Time", "Last 24h"], rows.to_vec());
        return;
    }

    let all_time_rows = rows
        .iter()
        .map(|row| {
            (
                row.first().map(String::as_str).unwrap_or("Metric"),
                row.get(1).cloned().unwrap_or_else(|| "-".to_string()),
            )
        })
        .collect::<Vec<_>>();
    let last_24h_rows = rows
        .iter()
        .map(|row| {
            (
                row.first().map(String::as_str).unwrap_or("Metric"),
                row.get(2).cloned().unwrap_or_else(|| "-".to_string()),
            )
        })
        .collect::<Vec<_>>();

    write_stderr_text(&format_section_heading("All time"));
    write_stderr_text(&format_key_value_rows(&all_time_rows));
    write_stderr_text(&format_section_heading("Last 24h"));
    write_stderr_text(&format_key_value_rows(&last_24h_rows));
}

fn parse_usd_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(raw)) if !raw.trim().is_empty() => raw
            .replace(',', "")
            .parse::<f64>()
            .ok()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format!("${}", format_count_number(parsed.trunc() as u64)))
            .unwrap_or_else(|| "-".to_string()),
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format!("${}", format_count_number(parsed.trunc() as u64)))
            .unwrap_or_else(|| "-".to_string()),
        _ => "-".to_string(),
    }
}

fn parse_count_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::Number(number)) => number
            .as_u64()
            .map(format_count_number)
            .unwrap_or_else(|| "-".to_string()),
        Some(Value::String(raw)) if !raw.trim().is_empty() => raw
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format_count_number(parsed.trunc() as u64))
            .unwrap_or_else(|| "-".to_string()),
        _ => "-".to_string(),
    }
}

fn value_as_display_string(value: &Value, fallback: &str) -> String {
    match value {
        Value::String(raw) if !raw.trim().is_empty() => raw.clone(),
        Value::Number(number) => number.to_string(),
        _ => fallback.to_string(),
    }
}
