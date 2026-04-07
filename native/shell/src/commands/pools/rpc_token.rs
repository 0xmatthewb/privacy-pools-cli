use super::model::{TokenMetadataLookupResult, TokenMetadataResult};
use super::rpc_abi::{decode_abi_string, decode_abi_words, decode_uint256_word, function_selector};
use super::rpc_transport::rpc_call;
use crate::error::CliError;

#[cfg(test)]
pub(super) fn resolve_token_metadata(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<TokenMetadataResult, CliError> {
    resolve_token_metadata_lookup(asset_address, rpc_urls, native_asset_address, timeout_ms)
        .map(|result| result.metadata)
}

pub(super) fn resolve_token_metadata_lookup(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<TokenMetadataLookupResult, CliError> {
    if asset_address.eq_ignore_ascii_case(native_asset_address) {
        return Ok(TokenMetadataLookupResult {
            metadata: TokenMetadataResult {
                symbol: "ETH".to_string(),
                decimals: 18,
            },
            cacheable: true,
        });
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

    build_token_metadata_lookup(symbol_result, decimals_result)
}

fn build_token_metadata_lookup(
    symbol_result: Option<String>,
    decimals_result: Option<u32>,
) -> Result<TokenMetadataLookupResult, CliError> {
    match (symbol_result, decimals_result) {
        (Some(symbol), Some(decimals)) => Ok(TokenMetadataLookupResult {
            metadata: TokenMetadataResult { symbol, decimals },
            cacheable: true,
        }),
        _ => Err(CliError::rpc_retryable(
            "Failed to resolve ERC-20 metadata for pool discovery.".to_string(),
            Some("Check your RPC URL and network connectivity, then retry.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )),
    }
}

#[cfg(test)]
mod extended_tests {
    use super::{
        build_token_metadata_lookup, resolve_token_metadata, resolve_token_metadata_lookup,
    };
    use crate::error::ErrorCategory;

    #[test]
    fn native_asset_lookup_short_circuits_to_eth() {
        let metadata = resolve_token_metadata_lookup(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            &[],
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            1_000,
        )
        .expect("native asset lookup should succeed");
        assert_eq!(metadata.metadata.symbol, "ETH");
        assert_eq!(metadata.metadata.decimals, 18);
        assert!(metadata.cacheable);
    }

    #[test]
    fn build_token_metadata_lookup_requires_symbol_and_decimals() {
        let metadata = build_token_metadata_lookup(Some("USDC".to_string()), Some(6))
            .expect("complete metadata should succeed");
        assert_eq!(metadata.metadata.symbol, "USDC");
        assert_eq!(metadata.metadata.decimals, 6);
        assert!(metadata.cacheable);

        let error = build_token_metadata_lookup(None, None)
            .expect_err("missing metadata should fail closed");
        assert!(matches!(error.category, ErrorCategory::Rpc));
        assert_eq!(error.code, "RPC_POOL_RESOLUTION_FAILED");
    }

    #[test]
    fn token_lookup_fails_closed_when_rpc_metadata_is_unreachable() {
        let error = resolve_token_metadata_lookup(
            "0x1111111111111111111111111111111111111111",
            &["http://127.0.0.1:9".to_string()],
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            25,
        )
        .expect_err("unreachable metadata should fail closed");
        assert!(matches!(error.category, ErrorCategory::Rpc));
        assert_eq!(error.code, "RPC_POOL_RESOLUTION_FAILED");
    }

    #[test]
    fn resolve_token_metadata_returns_only_the_metadata_payload() {
        let metadata = resolve_token_metadata(
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            &[],
            "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            1_000,
        )
        .expect("native asset metadata should succeed");
        assert_eq!(metadata.symbol, "ETH");
        assert_eq!(metadata.decimals, 18);
    }
}
