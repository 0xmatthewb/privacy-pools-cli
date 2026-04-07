use super::model::{AssetConfigResult, NativePoolResolution};
use super::rpc_abi::{
    checksum_address, decode_abi_string, decode_abi_words, decode_address_word,
    decode_uint256_word, encode_address_word, function_selector,
};
pub(super) use super::rpc_cache::resolve_cached_pool_resolution;
use super::rpc_token::resolve_token_metadata;
use super::rpc_transport::{rpc_batch_call, rpc_call};
use crate::contract::ChainDefinition;
use crate::error::CliError;
use num_bigint::BigUint;

pub(super) fn read_asset_config(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    timeout_ms: u64,
) -> Result<AssetConfigResult, CliError> {
    let selector = function_selector("assetConfig(address)");
    let data = format!(
        "0x{}{}",
        hex::encode(selector),
        encode_address_word(asset_address)?
    );
    let response = rpc_call(rpc_urls, &chain.entrypoint, &data, timeout_ms)?;
    let words = decode_abi_words(&response)?;
    if words.len() < 4 {
        return Err(CliError::rpc(
            "Malformed RPC response while resolving pool asset config.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    Ok(AssetConfigResult {
        pool_address: checksum_address(&decode_address_word(&words[0])?)?,
        minimum_deposit_amount: decode_uint256_word(&words[1]).to_string(),
        vetting_fee_bps: decode_uint256_word(&words[2]).to_string(),
        max_relay_fee_bps: decode_uint256_word(&words[3]).to_string(),
    })
}

pub(super) fn read_pool_scope(
    pool_address: &str,
    rpc_urls: &[String],
    timeout_ms: u64,
) -> Result<String, CliError> {
    let selector = function_selector("SCOPE()");
    let data = format!("0x{}", hex::encode(selector));
    let response = rpc_call(rpc_urls, pool_address, &data, timeout_ms)?;
    let words = decode_abi_words(&response)?;
    let first = words.first().ok_or_else(|| {
        CliError::rpc(
            "Malformed RPC response while resolving pool scope.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    Ok(decode_uint256_word(first).to_string())
}

pub(super) fn resolve_pool_from_asset_address_native(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    // Step 1: assetConfig to get pool address (must be first — pool address needed for SCOPE).
    let asset_config = read_asset_config(chain, asset_address, rpc_urls, timeout_ms)?;

    // Step 2: Batch SCOPE + token metadata (symbol + decimals) in one roundtrip.
    // For native assets (ETH), skip the token metadata calls entirely.
    let is_native = asset_address.eq_ignore_ascii_case(native_asset_address);

    let scope_selector = function_selector("SCOPE()");
    let scope_data = format!("0x{}", hex::encode(scope_selector));

    if is_native {
        // Native asset: only need SCOPE (symbol/decimals are hardcoded).
        let scope_response = rpc_call(
            rpc_urls,
            &asset_config.pool_address,
            &scope_data,
            timeout_ms,
        )?;
        let scope_words = decode_abi_words(&scope_response)?;
        let scope = scope_words.first().ok_or_else(|| {
            CliError::rpc(
                "Malformed RPC response while resolving pool scope.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        Ok(NativePoolResolution {
            symbol: "ETH".to_string(),
            pool_address: asset_config.pool_address,
            scope: decode_uint256_word(scope).to_string(),
        })
    } else {
        // ERC-20: batch SCOPE + symbol + decimals.
        let symbol_selector = function_selector("symbol()");
        let decimals_selector = function_selector("decimals()");
        let symbol_data = format!("0x{}", hex::encode(symbol_selector));
        let decimals_data = format!("0x{}", hex::encode(decimals_selector));

        let batch_results = rpc_batch_call(
            rpc_urls,
            &[
                (&asset_config.pool_address, &scope_data),
                (asset_address, &symbol_data),
                (asset_address, &decimals_data),
            ],
            timeout_ms,
        )?;

        // Parse SCOPE result.
        let scope_hex = batch_results[0].as_ref().map_err(|e| e.clone())?;
        let scope_words = decode_abi_words(scope_hex)?;
        let scope = scope_words.first().ok_or_else(|| {
            CliError::rpc(
                "Malformed RPC response while resolving pool scope.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        let scope_str = decode_uint256_word(scope).to_string();

        // Parse symbol result.
        let symbol = batch_results[1]
            .as_ref()
            .ok()
            .and_then(|hex| decode_abi_string(hex).ok())
            .ok_or_else(|| {
                CliError::rpc(
                    "Failed to resolve ERC-20 symbol.",
                    Some("Check your RPC URL and retry.".to_string()),
                    Some("RPC_POOL_RESOLUTION_FAILED"),
                )
            })?;

        // Parse decimals result.
        let decimals = batch_results[2]
            .as_ref()
            .ok()
            .and_then(|hex| decode_abi_words(hex).ok())
            .and_then(|words| words.first().cloned())
            .map(|word| decode_uint256_word(&word))
            .and_then(|value| value.to_u32_digits().first().copied())
            .ok_or_else(|| {
                CliError::rpc(
                    "Failed to resolve ERC-20 decimals.",
                    Some("Check your RPC URL and retry.".to_string()),
                    Some("RPC_POOL_RESOLUTION_FAILED"),
                )
            })?;

        Ok(NativePoolResolution {
            symbol,
            pool_address: asset_config.pool_address,
            scope: scope_str,
        })
    }
}
pub(super) fn is_hex_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].chars().all(|char| char.is_ascii_hexdigit())
}

pub(super) fn parse_biguint(value: &str) -> Option<BigUint> {
    if value.is_empty() {
        return None;
    }
    if value.starts_with("0x") {
        BigUint::parse_bytes(value.trim_start_matches("0x").as_bytes(), 16)
    } else {
        BigUint::parse_bytes(value.as_bytes(), 10)
    }
}

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
    use super::*;

    #[test]
    fn address_and_biguint_helpers_validate_expected_inputs() {
        assert!(is_hex_address("0x1234567890abcdef1234567890abcdef12345678"));
        assert!(!is_hex_address("0x1234"));
        assert!(!is_hex_address("ETH"));

        assert_eq!(
            parse_biguint("0x10")
                .expect("hex value should parse")
                .to_string(),
            "16"
        );
        assert_eq!(
            parse_biguint("42")
                .expect("decimal value should parse")
                .to_string(),
            "42"
        );
        assert!(parse_biguint("").is_none());
    }

    #[test]
    fn format_amount_truncates_and_preserves_significant_digits() {
        assert_eq!(
            format_amount(&BigUint::from(123_450_000u64), 6, Some("USDC"), Some(2)),
            "123.45 USDC"
        );
        assert_eq!(
            format_amount(&BigUint::from(42u32), 0, Some("ETH"), Some(2)),
            "42 ETH"
        );
        assert_eq!(
            format_amount(&BigUint::from(123u32), 6, None, Some(2)),
            "0.0001"
        );
        assert_eq!(
            format_amount(&BigUint::from(1_230_000u64), 6, None, Some(4)),
            "1.23"
        );
        assert_eq!(
            format_amount(&BigUint::from(1u32), 18, Some("ETH"), Some(2)),
            "0.000000000000000001 ETH"
        );
    }
}
