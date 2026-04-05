#[derive(Debug, Clone)]
pub(super) struct ActivityRenderData {
    pub(super) mode: &'static str,
    pub(super) chain: String,
    pub(super) chains: Option<Vec<String>>,
    pub(super) page: u64,
    pub(super) per_page: u64,
    pub(super) total: Option<u64>,
    pub(super) total_pages: Option<u64>,
    pub(super) events: Vec<NormalizedActivityEvent>,
    pub(super) asset: Option<String>,
    pub(super) pool: Option<String>,
    pub(super) scope: Option<String>,
    pub(super) chain_filtered: bool,
}

#[derive(Debug, Clone)]
pub(super) struct NormalizedActivityEvent {
    pub(super) event_type: String,
    pub(super) tx_hash: Option<String>,
    pub(super) explorer_url: Option<String>,
    pub(super) review_status: String,
    pub(super) amount_raw: Option<String>,
    pub(super) amount_formatted: String,
    pub(super) pool_symbol: Option<String>,
    pub(super) pool_address: Option<String>,
    pub(super) chain_id: Option<u64>,
    pub(super) timestamp_ms: Option<u64>,
    pub(super) timestamp_iso: Option<String>,
}
