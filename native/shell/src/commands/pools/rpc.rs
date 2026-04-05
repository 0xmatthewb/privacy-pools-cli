use super::helpers::pool_resolution_worker_join_failure;
use super::model::{
    AssetConfigResult, NativePoolResolution, PoolResolutionCacheEntry, TokenMetadataLookupResult,
    TokenMetadataResult,
};
use crate::contract::ChainDefinition;
use crate::error::CliError;
use crate::http_client::http_post_json;
use num_bigint::BigUint;
use num_traits::{ToPrimitive, Zero};
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tiny_keccak::{Hasher, Keccak};

pub(super) fn resolve_cached_pool_resolution(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<PoolResolutionCacheEntry, CliError> {
    let cache_key = pool_resolution_cache_key(chain.id, asset_address);
    {
        let cache = pool_resolution_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(cached.clone());
        }
    }

    let chain_for_asset = chain.clone();
    let asset_address_for_asset = asset_address.to_string();
    let rpc_urls_for_asset = rpc_urls.to_vec();
    let asset_handle = std::thread::spawn(move || {
        read_asset_config(
            &chain_for_asset,
            &asset_address_for_asset,
            &rpc_urls_for_asset,
            timeout_ms,
        )
    });

    let asset_address_for_metadata = asset_address.to_string();
    let rpc_urls_for_metadata = rpc_urls.to_vec();
    let native_asset_address = native_asset_address.to_string();
    let metadata_handle = std::thread::spawn(move || {
        resolve_token_metadata_lookup(
            &asset_address_for_metadata,
            &rpc_urls_for_metadata,
            &native_asset_address,
            timeout_ms,
        )
    });

    let asset_config = match asset_handle.join() {
        Ok(result) => result?,
        Err(_) => return Err(pool_resolution_worker_join_failure(&chain.name)),
    };
    let token_lookup = match metadata_handle.join() {
        Ok(result) => result,
        Err(_) => TokenMetadataLookupResult {
            metadata: TokenMetadataResult {
                symbol: "???".to_string(),
                decimals: 18,
            },
            cacheable: false,
        },
    };
    let scope = read_pool_scope(&asset_config.pool_address, rpc_urls, timeout_ms)?;

    let resolved = PoolResolutionCacheEntry {
        asset_config,
        scope,
        token_metadata: token_lookup.metadata,
    };
    if token_lookup.cacheable {
        let mut cache = pool_resolution_cache()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.insert(cache_key, resolved.clone());
    }

    Ok(resolved)
}

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

pub(super) fn resolve_token_metadata(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> TokenMetadataResult {
    resolve_token_metadata_lookup(asset_address, rpc_urls, native_asset_address, timeout_ms)
        .metadata
}

pub(super) fn resolve_token_metadata_lookup(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> TokenMetadataLookupResult {
    if asset_address.eq_ignore_ascii_case(native_asset_address) {
        return TokenMetadataLookupResult {
            metadata: TokenMetadataResult {
                symbol: "ETH".to_string(),
                decimals: 18,
            },
            cacheable: true,
        };
    }

    let symbol_selector = function_selector("symbol()");
    let decimals_selector = function_selector("decimals()");
    let symbol_result = rpc_call(
        rpc_urls,
        asset_address,
        &format!("0x{}", hex::encode(symbol_selector)),
        timeout_ms,
    )
    .ok()
    .and_then(|value| decode_abi_string(&value).ok());
    let decimals_result = rpc_call(
        rpc_urls,
        asset_address,
        &format!("0x{}", hex::encode(decimals_selector)),
        timeout_ms,
    )
    .ok()
    .and_then(|value| decode_abi_words(&value).ok())
    .and_then(|words| words.first().cloned())
    .map(|word| decode_uint256_word(&word))
    .and_then(|value| value.to_u32_digits().first().copied());

    TokenMetadataLookupResult {
        metadata: TokenMetadataResult {
            symbol: symbol_result.clone().unwrap_or_else(|| "???".to_string()),
            decimals: decimals_result.unwrap_or(18),
        },
        cacheable: symbol_result.is_some() && decimals_result.is_some(),
    }
}

pub(super) fn resolve_pool_from_asset_address_native(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    let asset_config = read_asset_config(chain, asset_address, rpc_urls, timeout_ms)?;
    let scope = read_pool_scope(&asset_config.pool_address, rpc_urls, timeout_ms)?;
    let token_metadata =
        resolve_token_metadata(asset_address, rpc_urls, native_asset_address, timeout_ms);

    Ok(NativePoolResolution {
        symbol: token_metadata.symbol,
        pool_address: asset_config.pool_address,
        scope,
    })
}

fn pool_resolution_cache(
) -> &'static Mutex<std::collections::HashMap<String, PoolResolutionCacheEntry>> {
    static CACHE: OnceLock<Mutex<std::collections::HashMap<String, PoolResolutionCacheEntry>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn pool_resolution_cache_key(chain_id: u64, asset_address: &str) -> String {
    format!("{chain_id}:{}", asset_address.to_lowercase())
}

fn rpc_call(
    rpc_urls: &[String],
    to: &str,
    data: &str,
    timeout_ms: u64,
) -> Result<String, CliError> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [
            {
                "to": to,
                "data": data,
            },
            "latest"
        ]
    });

    let mut last_error = None;
    for rpc_url in rpc_urls {
        match http_post_json(rpc_url, &body, timeout_ms) {
            Ok(response) => {
                if let Some(result) = response.get("result").and_then(Value::as_str) {
                    return Ok(result.to_string());
                }

                if let Some(error_message) = response
                    .get("error")
                    .and_then(Value::as_object)
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                {
                    last_error = Some(CliError::rpc(
                        format!("RPC error: {error_message}"),
                        Some("Check your RPC connection and try again.".to_string()),
                        None,
                    ));
                    continue;
                }
            }
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        CliError::rpc(
            "RPC pool resolution failed.",
            Some("Check your RPC connection and try again.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    }))
}

fn function_selector(signature: &str) -> [u8; 4] {
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(signature.as_bytes());
    keccak.finalize(&mut hash);
    [hash[0], hash[1], hash[2], hash[3]]
}

fn encode_address_word(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::input(
            format!("Invalid asset address: {address}."),
            Some("Use a 0x-prefixed 20-byte address.".to_string()),
        ));
    }
    Ok(format!("{:0>64}", normalized.to_lowercase()))
}

fn decode_abi_words(hex_data: &str) -> Result<Vec<String>, CliError> {
    let normalized = hex_data.strip_prefix("0x").unwrap_or(hex_data);
    if normalized.is_empty() {
        return Ok(vec![]);
    }
    if !normalized.len().is_multiple_of(64) {
        return Err(CliError::rpc(
            "Malformed ABI response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(normalized
        .as_bytes()
        .chunks(64)
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect())
}

fn decode_uint256_word(word: &str) -> BigUint {
    BigUint::parse_bytes(word.as_bytes(), 16).unwrap_or_else(BigUint::zero)
}

fn decode_address_word(word: &str) -> Result<String, CliError> {
    if word.len() != 64 {
        return Err(CliError::rpc(
            "Malformed ABI address response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(format!("0x{}", &word[24..]))
}

fn checksum_address(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::rpc(
            "Malformed address returned from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let lowercase = normalized.to_lowercase();
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(lowercase.as_bytes());
    keccak.finalize(&mut hash);
    let hash_hex = hex::encode(hash);
    let mut checksummed = String::from("0x");
    for (index, character) in lowercase.chars().enumerate() {
        let nibble = u8::from_str_radix(&hash_hex[index..index + 1], 16).unwrap_or(0);
        if character.is_ascii_alphabetic() && nibble >= 8 {
            checksummed.push(character.to_ascii_uppercase());
        } else {
            checksummed.push(character);
        }
    }
    Ok(checksummed)
}

fn decode_abi_string(hex_data: &str) -> Result<String, CliError> {
    let words = decode_abi_words(hex_data)?;
    if words.len() < 2 {
        return Err(CliError::rpc(
            "Malformed ABI string response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let offset = decode_uint256_word(&words[0]).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string offset from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    if offset % 32 != 0 {
        return Err(CliError::rpc(
            "Invalid ABI string offset alignment from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    let index = offset / 32;
    let length_word = words.get(index).ok_or_else(|| {
        CliError::rpc(
            "Malformed ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    let length = decode_uint256_word(length_word).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;

    let mut bytes = vec![];
    let required_words = length.div_ceil(32);
    for word_index in 0..required_words {
        let word = words.get(index + 1 + word_index).ok_or_else(|| {
            CliError::rpc(
                "Malformed ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        let decoded = hex::decode(word).map_err(|_| {
            CliError::rpc(
                "Invalid ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        bytes.extend(decoded);
    }
    bytes.truncate(length);
    String::from_utf8(bytes).map_err(|_| {
        CliError::rpc(
            "ABI string payload was not valid UTF-8.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })
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
