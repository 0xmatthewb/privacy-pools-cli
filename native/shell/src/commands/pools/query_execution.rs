use super::model::{ChainSummary, PoolListingEntry, PoolWarning, PoolsChainQueryResult};
use crate::config::CliConfig;
use crate::contract::{ChainDefinition, RuntimeConfig};
use crate::error::CliError;

pub(super) fn query_pools_for_chain(
    chain: ChainDefinition,
    rpc_override: Option<String>,
    config: CliConfig,
    runtime_config: RuntimeConfig,
    timeout_ms: u64,
) -> PoolsChainQueryResult {
    match super::query_resolution::list_pools_native(
        &chain,
        rpc_override,
        &config,
        &runtime_config,
        timeout_ms,
    ) {
        Ok(chain_entries) => PoolsChainQueryResult {
            summary: ChainSummary {
                chain: chain.name,
                pools: chain_entries.len(),
                error: None,
            },
            entries: chain_entries,
            warning: None,
            error: None,
        },
        Err(error) => {
            let message = error.message.clone();
            PoolsChainQueryResult {
                entries: vec![],
                warning: Some(PoolWarning {
                    chain: chain.name.clone(),
                    category: error.category.as_str().to_string(),
                    message: message.clone(),
                }),
                summary: ChainSummary {
                    chain: chain.name,
                    pools: 0,
                    error: Some(message),
                },
                error: Some(error),
            }
        }
    }
}

pub(super) fn apply_pools_chain_query_result(
    result: PoolsChainQueryResult,
    entries: &mut Vec<PoolListingEntry>,
    warnings: &mut Vec<PoolWarning>,
    chain_summaries: &mut Vec<ChainSummary>,
    first_error: &mut Option<CliError>,
) {
    chain_summaries.push(result.summary);
    entries.extend(result.entries);
    if let Some(warning) = result.warning {
        warnings.push(warning);
    }
    if first_error.is_none() {
        *first_error = result.error;
    }
}

pub(super) fn pools_worker_join_failure(chain_name: &str) -> PoolsChainQueryResult {
    let error = CliError::unknown(
        format!("Failed to resolve pools on {chain_name}."),
        Some("Retry the command. If the issue persists, reinstall the CLI and retry.".to_string()),
    );
    PoolsChainQueryResult {
        entries: vec![],
        warning: Some(PoolWarning {
            chain: chain_name.to_string(),
            category: error.category.as_str().to_string(),
            message: error.message.clone(),
        }),
        summary: ChainSummary {
            chain: chain_name.to_string(),
            pools: 0,
            error: Some(error.message.clone()),
        },
        error: Some(error),
    }
}
