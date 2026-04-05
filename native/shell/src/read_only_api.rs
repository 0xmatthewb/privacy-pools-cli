use crate::contract::ChainDefinition;
use crate::error::CliError;
use crate::http_client::{http_get_json, http_get_json_with_js_transport_error};
use serde_json::Value;

pub(crate) fn fetch_pool_events(
    chain: &ChainDefinition,
    scope: &str,
    page: u64,
    per_page: u64,
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let url = format!(
        "{}/{}/public/events?page={page}&perPage={per_page}",
        chain.asp_host, chain.id
    );
    http_get_json_with_js_transport_error(&url, &[("X-Pool-Scope", scope.to_string())], timeout_ms)
}

pub(crate) fn fetch_global_events(
    chain: &ChainDefinition,
    page: u64,
    per_page: u64,
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let url = format!(
        "{}/global/public/events?page={page}&perPage={per_page}",
        chain.asp_host
    );
    http_get_json_with_js_transport_error(&url, &[], timeout_ms)
}

pub(crate) fn fetch_global_statistics(
    chain: &ChainDefinition,
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let url = format!("{}/global/public/statistics", chain.asp_host);
    http_get_json_with_js_transport_error(&url, &[], timeout_ms)
}

pub(crate) fn fetch_pool_statistics(
    chain: &ChainDefinition,
    scope: &str,
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let url = format!("{}/{}/public/pool-statistics", chain.asp_host, chain.id);
    http_get_json_with_js_transport_error(&url, &[("X-Pool-Scope", scope.to_string())], timeout_ms)
}

pub(crate) fn fetch_pools_stats(
    chain: &ChainDefinition,
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let url = format!("{}/{}/public/pools-stats", chain.asp_host, chain.id);
    http_get_json(&url, &[], timeout_ms)
}
