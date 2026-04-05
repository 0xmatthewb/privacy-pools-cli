use crate::output::format_address;
use num_bigint::BigUint;
use serde_json::Value;
use std::time::{Duration, UNIX_EPOCH};

pub(super) fn format_amount(
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

pub(super) fn format_asp_approval_status_label(status: &str) -> String {
    match status.trim().to_lowercase().as_str() {
        "approved" => "Approved".to_string(),
        "pending" => "Pending".to_string(),
        "poi_required" => "POA Needed".to_string(),
        "declined" => "Declined".to_string(),
        _ => "Unknown".to_string(),
    }
}

pub(super) fn format_tx_hash_short(tx_hash: Option<&str>) -> String {
    tx_hash
        .map(|tx| format_address(tx, 8))
        .unwrap_or_else(|| "-".to_string())
}

pub(super) fn json_numberish(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub(super) fn ms_to_iso_timestamp(timestamp_ms: u64) -> String {
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

#[cfg(test)]
mod tests {
    use super::{format_amount, format_asp_approval_status_label, ms_to_iso_timestamp};
    use num_bigint::BigUint;

    #[test]
    fn amount_formatting_keeps_significant_fraction_digits() {
        let value = BigUint::parse_bytes(b"123450000000000000", 10).expect("bigint");
        assert_eq!(format_amount(&value, 18, Some("ETH"), Some(2)), "0.12 ETH");
    }

    #[test]
    fn approval_labels_match_cli_contract() {
        assert_eq!(
            format_asp_approval_status_label("poi_required"),
            "POA Needed"
        );
        assert_eq!(format_asp_approval_status_label("declined"), "Declined");
    }

    #[test]
    fn millisecond_timestamps_render_as_iso() {
        assert_eq!(
            ms_to_iso_timestamp(1_700_000_000_123),
            "2023-11-14T22:13:20.123Z"
        );
    }
}
