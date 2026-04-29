use super::format::{format_amount, json_numberish, ms_to_iso_timestamp};
use super::model::NormalizedActivityEvent;
use crate::contract::Manifest;
use crate::error::CliError;
use crate::json::parse_json_u64;
use num_bigint::BigUint;
use serde_json::Value;

pub(super) fn normalize_activity_events(
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
        "poa_required" | "poi_required" => "poa_required",
        "declined" | "rejected" | "denied" => "declined",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_activity_events;
    use crate::contract::Manifest;
    use crate::known_addresses::ZERO_ADDRESS_CHECKSUMMED;
    use serde_json::json;

    fn manifest() -> Manifest {
        serde_json::from_value(json!({
            "manifestVersion": "1",
            "runtimeVersion": "1",
            "cliVersion": "2.0.0",
            "jsonSchemaVersion": "2.0.0",
            "commandPaths": ["activity"],
            "aliasMap": {},
            "rootHelp": "help",
            "structuredRootHelp": "structured help",
            "helpTextByPath": {},
            "guideStructuredText": "guide",
            "guideStructuredPayload": { "mode": "help", "help": "guide", "topics": [] },
            "guideHumanText": "guide",
            "capabilitiesHumanText": "capabilities",
            "describeHumanTextByPath": {},
            "completionSpec": {
                "name": "privacy-pools",
                "aliases": [],
                "options": [],
                "subcommands": []
            },
            "completionScripts": {},
            "runtimeConfig": {
                "chainEnvSuffixes": {},
                "defaultRpcUrls": {},
                "chainNames": [],
                "mainnetChainNames": [],
                "nativeAssetAddress": ZERO_ADDRESS_CHECKSUMMED,
                "knownPools": {},
                "explorerUrls": { "1": "https://etherscan.io" },
                "chains": {}
            },
            "routes": {
                "helpCommandPaths": ["activity"],
                "commandRoutes": {
                    "activity": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] }
                }
            },
            "capabilitiesPayload": {}
        }))
        .expect("manifest")
    }

    #[test]
    fn normalizes_withdrawals_to_approved() {
        let events = normalize_activity_events(
            json!([{
                "type": "withdrawal",
                "txHash": "0xabc",
                "timestamp": 1700000000,
                "amount": "1000000000000000000",
                "reviewStatus": { "decisionStatus": "pending" },
                "pool": {
                    "chainId": 1,
                    "denomination": 18,
                    "tokenSymbol": "ETH",
                    "poolAddress": "0xpool"
                }
            }]),
            None,
            &manifest(),
        )
        .expect("events");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].review_status, "approved");
        assert_eq!(
            events[0].explorer_url.as_deref(),
            Some("https://etherscan.io/tx/0xabc")
        );
    }

    #[test]
    fn fills_pending_when_review_status_is_missing() {
        let events = normalize_activity_events(
            json!([{ "type": "deposit", "pool": { "denomination": 18 } }]),
            Some("ETH"),
            &manifest(),
        )
        .expect("events");

        assert_eq!(events[0].review_status, "pending");
        assert_eq!(events[0].pool_symbol.as_deref(), Some("ETH"));
    }
}
