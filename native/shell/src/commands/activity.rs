use crate::commands::pools::{default_read_only_chains, resolve_pool_native};
use crate::config::{load_config, resolve_chain};
use crate::contract::Manifest;
use crate::dispatch::{commander_too_many_arguments_error, commander_unknown_option_error};
use crate::error::CliError;
use crate::json::parse_json_u64;
use crate::output::{
    format_address, format_time_ago, print_csv, print_json_success, print_table, write_stderr_text,
};
use crate::parse_timeout_ms;
use crate::read_only_api::{fetch_global_events, fetch_pool_events};
use crate::root_argv::{
    is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option, ParsedRootArgv,
};
use crate::routing::{resolve_mode, NativeMode};
use num_bigint::BigUint;
use serde_json::{json, Map, Value};
use std::time::{Duration, UNIX_EPOCH};

#[derive(Debug, Clone)]
struct ActivityCommandOptions {
    asset: Option<String>,
    page: u64,
    per_page: u64,
}

#[derive(Debug, Clone)]
struct ActivityRenderData {
    mode: &'static str,
    chain: String,
    chains: Option<Vec<String>>,
    page: u64,
    per_page: u64,
    total: Option<u64>,
    total_pages: Option<u64>,
    events: Vec<NormalizedActivityEvent>,
    asset: Option<String>,
    pool: Option<String>,
    scope: Option<String>,
    chain_filtered: bool,
}

#[derive(Debug, Clone)]
struct NormalizedActivityEvent {
    event_type: String,
    tx_hash: Option<String>,
    explorer_url: Option<String>,
    review_status: String,
    amount_raw: Option<String>,
    amount_formatted: String,
    pool_symbol: Option<String>,
    pool_address: Option<String>,
    chain_id: Option<u64>,
    timestamp_ms: Option<u64>,
    timestamp_iso: Option<String>,
}

pub fn handle_activity_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    let mode = resolve_mode(parsed);
    let opts = parse_activity_options(argv)?;
    let timeout_ms = parse_timeout_ms(argv);
    if !mode.is_json() && !mode.is_quiet {
        write_stderr_text("- Fetching public activity...");
    }

    if let Some(asset) = opts.asset.as_deref() {
        let config = load_config()?;
        let explicit_chain = parsed
            .global_chain()
            .unwrap_or_else(|| config.default_chain.clone());
        let chain = resolve_chain(&explicit_chain, manifest)?;
        let pool = resolve_pool_native(
            &chain,
            asset,
            parsed.global_rpc_url(),
            &config,
            manifest,
            timeout_ms,
        )?;
        let response =
            fetch_pool_events(&chain, &pool.scope, opts.page, opts.per_page, timeout_ms)?;
        let events = normalize_activity_events(
            response.get("events").cloned().unwrap_or_else(|| json!([])),
            Some(pool.symbol.as_str()),
            manifest,
        )?;
        let page = parse_json_u64(response.get("page")).unwrap_or(opts.page);
        let per_page = parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page);
        let total = parse_json_u64(response.get("total"));
        let total_pages = parse_json_u64(response.get("totalPages"));
        render_activity_output(
            &mode,
            ActivityRenderData {
                mode: "pool-activity",
                chain: chain.name.clone(),
                chains: None,
                page,
                per_page,
                total,
                total_pages,
                events,
                asset: Some(pool.symbol),
                pool: Some(pool.pool_address),
                scope: Some(pool.scope),
                chain_filtered: false,
            },
        );
        return Ok(0);
    }

    if let Some(explicit_chain) = parsed.global_chain() {
        let chain = resolve_chain(&explicit_chain, manifest)?;
        let response = fetch_global_events(&chain, opts.page, opts.per_page, timeout_ms)?;
        let events = normalize_activity_events(
            response.get("events").cloned().unwrap_or_else(|| json!([])),
            None,
            manifest,
        )?
        .into_iter()
        .filter(|event| event.chain_id.is_none() || event.chain_id == Some(chain.id))
        .collect::<Vec<_>>();
        render_activity_output(
            &mode,
            ActivityRenderData {
                mode: "global-activity",
                chain: chain.name,
                chains: None,
                page: parse_json_u64(response.get("page")).unwrap_or(opts.page),
                per_page: parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
                total: None,
                total_pages: None,
                events,
                asset: None,
                pool: None,
                scope: None,
                chain_filtered: true,
            },
        );
        return Ok(0);
    }

    let chains = default_read_only_chains(manifest);
    let representative_chain = chains.first().ok_or_else(|| {
        CliError::unknown(
            "No default read-only chains configured.",
            Some("Regenerate the native command manifest.".to_string()),
        )
    })?;
    let response = fetch_global_events(representative_chain, opts.page, opts.per_page, timeout_ms)?;
    let events = normalize_activity_events(
        response.get("events").cloned().unwrap_or_else(|| json!([])),
        None,
        manifest,
    )?;

    render_activity_output(
        &mode,
        ActivityRenderData {
            mode: "global-activity",
            chain: "all-mainnets".to_string(),
            chains: Some(
                chains
                    .iter()
                    .map(|chain| chain.name.clone())
                    .collect::<Vec<_>>(),
            ),
            page: parse_json_u64(response.get("page")).unwrap_or(opts.page),
            per_page: parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
            total: parse_json_u64(response.get("total")),
            total_pages: parse_json_u64(response.get("totalPages")),
            events,
            asset: None,
            pool: None,
            scope: None,
            chain_filtered: false,
        },
    );

    Ok(0)
}

fn parse_activity_options(argv: &[String]) -> Result<ActivityCommandOptions, CliError> {
    let mut asset = None;
    let mut page = None;
    let mut per_page = None;
    let mut unexpected_args = 0;
    let mut index = argv
        .iter()
        .position(|token| token == "activity")
        .map(|value| value + 1)
        .unwrap_or(argv.len());

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            unexpected_args += argv.len().saturating_sub(index + 1);
            break;
        }
        if token == "--asset" || token == "-a" {
            asset = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--asset=") {
            asset = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--page" {
            page = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--page=") {
            page = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--limit" {
            per_page = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--limit=") {
            per_page = Some(value.to_string());
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
            "activity",
            0,
            unexpected_args,
        ));
    }

    Ok(ActivityCommandOptions {
        asset,
        page: parse_positive_int(page.as_deref(), "page", 1)?,
        per_page: parse_positive_int(per_page.as_deref(), "limit", 12)?,
    })
}

fn parse_positive_int(raw: Option<&str>, field_name: &str, fallback: u64) -> Result<u64, CliError> {
    let value = raw.unwrap_or_else(|| if field_name == "page" { "1" } else { "12" });
    let parsed = value
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(0);
    if parsed == 0 {
        return Err(CliError::input(
            format!("Invalid --{field_name} value: {value}."),
            Some(format!("--{field_name} must be a positive integer.")),
        ));
    }
    Ok(if raw.is_some() { parsed } else { fallback })
}

fn normalize_activity_events(
    events_value: Value,
    fallback_symbol: Option<&str>,
    manifest: &Manifest,
) -> Result<Vec<NormalizedActivityEvent>, CliError> {
    let events = events_value.as_array().cloned().unwrap_or_default();
    events
        .into_iter()
        .map(|event| normalize_activity_event(event, fallback_symbol, manifest))
        .collect()
}

fn normalize_activity_event(
    event: Value,
    fallback_symbol: Option<&str>,
    manifest: &Manifest,
) -> Result<NormalizedActivityEvent, CliError> {
    let pool = event
        .get("pool")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let chain_id = parse_json_u64(pool.get("chainId"));
    let amount_raw = event
        .get("amount")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .or_else(|| {
            event
                .get("publicAmount")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        });
    let symbol = pool
        .get("tokenSymbol")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| fallback_symbol.map(|value| value.to_string()));
    let decimals = parse_json_u64(pool.get("denomination")).unwrap_or(18) as u32;
    let amount_formatted = amount_raw
        .as_deref()
        .and_then(|value| value.parse::<BigUint>().ok())
        .map(|value| format_amount(&value, decimals, symbol.as_deref(), Some(2)))
        .unwrap_or_else(|| amount_raw.clone().unwrap_or_else(|| "-".to_string()));
    let timestamp_ms = event
        .get("timestamp")
        .and_then(json_numberish)
        .map(|value| {
            if value < 1_000_000_000_000f64 {
                (value * 1000.0).floor() as u64
            } else {
                value.floor() as u64
            }
        });
    let tx_hash = event
        .get("txHash")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let pool_address = pool
        .get("poolAddress")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let raw_review_status = extract_public_event_review_status(event.get("reviewStatus"));
    let review_status =
        normalize_public_event_review_status(&event_type, raw_review_status.as_deref());
    let explorer_url = tx_hash
        .as_ref()
        .and_then(|hash| chain_id.and_then(|id| explorer_tx_url(id, hash, manifest)));

    Ok(NormalizedActivityEvent {
        event_type,
        tx_hash,
        explorer_url,
        review_status,
        amount_raw,
        amount_formatted,
        pool_symbol: symbol,
        pool_address,
        chain_id,
        timestamp_ms,
        timestamp_iso: timestamp_ms.map(ms_to_iso_timestamp),
    })
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

fn render_activity_output(mode: &NativeMode, data: ActivityRenderData) {
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
                    event
                        .tx_hash
                        .as_deref()
                        .map(|tx| format_address(tx, 8))
                        .unwrap_or_else(|| "-".to_string()),
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
                event
                    .tx_hash
                    .as_deref()
                    .map(|tx| format_address(tx, 8))
                    .unwrap_or_else(|| "-".to_string()),
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

fn activity_pool_label(event: &NormalizedActivityEvent) -> String {
    match (&event.pool_symbol, event.chain_id) {
        (Some(symbol), Some(chain_id)) => format!("{symbol}@{chain_id}"),
        (Some(symbol), None) => symbol.clone(),
        (None, Some(chain_id)) => format!("chain-{chain_id}"),
        (None, None) => "-".to_string(),
    }
}

fn explorer_tx_url(chain_id: u64, tx_hash: &str, manifest: &Manifest) -> Option<String> {
    manifest
        .runtime_config
        .explorer_urls
        .get(&chain_id)
        .map(|base| format!("{base}/tx/{tx_hash}"))
}

fn extract_public_event_review_status(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(status)) if !status.trim().is_empty() => Some(status.clone()),
        Some(Value::Object(object)) => object
            .get("decisionStatus")
            .and_then(Value::as_str)
            .or_else(|| object.get("reviewStatus").and_then(Value::as_str))
            .or_else(|| object.get("status").and_then(Value::as_str))
            .map(|inner| inner.to_string())
            .filter(|inner| !inner.trim().is_empty()),
        _ => None,
    }
}

fn normalize_public_event_review_status(event_type: &str, raw_status: Option<&str>) -> String {
    let normalized_type = event_type.trim().to_lowercase();
    if matches!(normalized_type.as_str(), "withdrawal" | "ragequit" | "exit") {
        return "approved".to_string();
    }

    let normalized = normalize_asp_approval_status(raw_status);
    if normalized != "unknown" {
        return normalized.to_string();
    }

    if raw_status
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        "unknown".to_string()
    } else {
        "pending".to_string()
    }
}

fn normalize_asp_approval_status(raw_status: Option<&str>) -> &'static str {
    match raw_status
        .unwrap_or_default()
        .trim()
        .to_lowercase()
        .as_str()
    {
        "approved" | "accepted" => "approved",
        "pending" => "pending",
        "poi_required" => "poi_required",
        "declined" | "rejected" | "denied" => "declined",
        _ => "unknown",
    }
}

fn format_asp_approval_status_label(status: &str) -> String {
    match status.trim().to_lowercase().as_str() {
        "approved" => "Approved".to_string(),
        "pending" => "Pending".to_string(),
        "poi_required" => "POA Needed".to_string(),
        "declined" => "Declined".to_string(),
        _ => "Unknown".to_string(),
    }
}

fn json_numberish(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn ms_to_iso_timestamp(timestamp_ms: u64) -> String {
    let seconds = timestamp_ms / 1000;
    let milliseconds = timestamp_ms % 1000;
    chrono_like_iso(seconds as i64, milliseconds as u32)
}

fn chrono_like_iso(seconds: i64, milliseconds: u32) -> String {
    let datetime = UNIX_EPOCH + Duration::from_secs(seconds.max(0) as u64);
    let elapsed = datetime
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    let secs = elapsed.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let seconds_of_day = secs.rem_euclid(86_400);

    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds:03}Z")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
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
