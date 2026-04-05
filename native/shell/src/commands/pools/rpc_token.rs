use super::model::{TokenMetadataLookupResult, TokenMetadataResult};
use super::rpc_abi::{decode_abi_string, decode_abi_words, decode_uint256_word, function_selector};
use super::rpc_transport::rpc_call;

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
