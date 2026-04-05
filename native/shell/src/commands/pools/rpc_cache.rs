use super::model::PoolResolutionCacheEntry;
use super::rpc::{read_asset_config, read_pool_scope};
use super::rpc_token::resolve_token_metadata_lookup;
use crate::contract::ChainDefinition;
use crate::error::CliError;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

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

    let asset_config = read_asset_config(chain, asset_address, rpc_urls, timeout_ms)?;
    let scope = read_pool_scope(&asset_config.pool_address, rpc_urls, timeout_ms)?;
    let token_lookup =
        resolve_token_metadata_lookup(asset_address, rpc_urls, native_asset_address, timeout_ms);

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

fn pool_resolution_cache() -> &'static Mutex<HashMap<String, PoolResolutionCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, PoolResolutionCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pool_resolution_cache_key(chain_id: u64, asset_address: &str) -> String {
    format!("{chain_id}:{}", asset_address.to_lowercase())
}
