use serde_json::Map;
use serde_json::Value;

pub(super) const POOL_RESOLUTION_MAX_WORKERS: usize = 4;

#[derive(Debug, Clone)]
pub(super) struct PoolsCommandOptions {
    pub(super) all_chains: bool,
    pub(super) limit: Option<usize>,
    pub(super) search: Option<String>,
    pub(super) sort: String,
}

#[derive(Debug, Clone)]
pub(super) struct PoolListingEntry {
    pub(super) chain: String,
    pub(super) chain_id: u64,
    pub(super) asset: String,
    pub(super) token_address: String,
    pub(super) pool: String,
    pub(super) scope: String,
    pub(super) decimals: u32,
    pub(super) minimum_deposit: String,
    pub(super) vetting_fee_bps: String,
    pub(super) max_relay_fee_bps: String,
    pub(super) total_in_pool_value: Option<String>,
    pub(super) total_in_pool_value_usd: Option<String>,
    pub(super) total_deposits_value: Option<String>,
    pub(super) total_deposits_value_usd: Option<String>,
    pub(super) accepted_deposits_value: Option<String>,
    pub(super) accepted_deposits_value_usd: Option<String>,
    pub(super) pending_deposits_value: Option<String>,
    pub(super) pending_deposits_value_usd: Option<String>,
    pub(super) total_deposits_count: Option<u64>,
    pub(super) accepted_deposits_count: Option<u64>,
    pub(super) pending_deposits_count: Option<u64>,
    pub(super) growth24h: Option<f64>,
    pub(super) pending_growth24h: Option<f64>,
    pub(super) my_pool_accounts_count: Option<u64>,
}

#[derive(Debug, Clone)]
pub(super) struct PoolWarning {
    pub(super) chain: String,
    pub(super) category: String,
    pub(super) message: String,
}

#[derive(Debug, Clone)]
pub(super) struct ChainSummary {
    pub(super) chain: String,
    pub(super) pools: usize,
    pub(super) error: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct PoolsChainQueryResult {
    pub(super) entries: Vec<PoolListingEntry>,
    pub(super) warning: Option<PoolWarning>,
    pub(super) summary: ChainSummary,
    pub(super) error: Option<crate::error::CliError>,
}

#[derive(Debug, Clone)]
pub(super) struct PoolStatsResolutionInput {
    pub(super) stats_entry: Map<String, Value>,
    pub(super) asset_address: String,
}

#[derive(Debug, Clone)]
pub(super) struct PoolsRenderData {
    pub(super) all_chains: bool,
    pub(super) chain_name: String,
    pub(super) search: Option<String>,
    pub(super) sort: String,
    pub(super) filtered_pools: Vec<PoolListingEntry>,
    pub(super) chain_summaries: Option<Vec<ChainSummary>>,
    pub(super) warnings: Vec<PoolWarning>,
}

#[derive(Debug, Clone)]
pub(super) struct PoolDetailAccount {
    pub(super) id: String,
    pub(super) status: String,
    pub(super) value: String,
}

#[derive(Debug, Clone)]
pub(super) struct PoolDetailMyFunds {
    pub(super) balance: String,
    pub(super) usd_value: Option<String>,
    #[allow(dead_code)]
    pub(super) pool_accounts: u64,
    pub(super) pending_count: u64,
    pub(super) poa_required_count: u64,
    pub(super) declined_count: u64,
    pub(super) accounts: Vec<PoolDetailAccount>,
}

#[derive(Debug, Clone)]
pub(super) struct PoolDetailActivityEvent {
    pub(super) event_type: String,
    pub(super) amount: String,
    pub(super) time_label: String,
    pub(super) status: String,
}

#[derive(Debug, Clone)]
pub(super) struct PoolDetailRenderData {
    pub(super) chain_name: String,
    pub(super) asset: String,
    #[allow(dead_code)]
    pub(super) token_address: String,
    #[allow(dead_code)]
    pub(super) pool: String,
    #[allow(dead_code)]
    pub(super) scope: String,
    pub(super) decimals: u32,
    pub(super) minimum_deposit: String,
    pub(super) vetting_fee_bps: String,
    #[allow(dead_code)]
    pub(super) max_relay_fee_bps: String,
    pub(super) total_in_pool_value: Option<String>,
    pub(super) total_in_pool_value_usd: Option<String>,
    pub(super) total_deposits_value: Option<String>,
    pub(super) total_deposits_value_usd: Option<String>,
    pub(super) pending_deposits_value: Option<String>,
    pub(super) pending_deposits_value_usd: Option<String>,
    pub(super) total_deposits_count: Option<u64>,
    pub(super) my_funds: Option<PoolDetailMyFunds>,
    pub(super) my_funds_warning: Option<String>,
    pub(super) recent_activity: Option<Vec<PoolDetailActivityEvent>>,
}

#[derive(Debug, Clone)]
pub(crate) struct NativePoolResolution {
    pub(crate) symbol: String,
    pub(crate) pool_address: String,
    pub(crate) scope: String,
}

#[derive(Debug, Clone)]
pub(super) struct AssetConfigResult {
    pub(super) pool_address: String,
    pub(super) minimum_deposit_amount: String,
    pub(super) vetting_fee_bps: String,
    pub(super) max_relay_fee_bps: String,
}

#[derive(Debug, Clone)]
pub(super) struct TokenMetadataResult {
    pub(super) symbol: String,
    pub(super) decimals: u32,
}

#[derive(Debug, Clone)]
pub(super) struct TokenMetadataLookupResult {
    pub(super) metadata: TokenMetadataResult,
    pub(super) cacheable: bool,
}

#[derive(Debug, Clone)]
pub(super) struct PoolResolutionCacheEntry {
    pub(super) asset_config: AssetConfigResult,
    pub(super) scope: String,
    pub(super) token_metadata: TokenMetadataResult,
}
