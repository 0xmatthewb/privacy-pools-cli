use crate::config::apply_chain_overrides;
use crate::contract::{ChainDefinition, Manifest};

pub(crate) fn default_read_only_chains(manifest: &Manifest) -> Vec<ChainDefinition> {
    manifest
        .runtime_config
        .mainnet_chain_names
        .iter()
        .filter_map(|name| manifest.runtime_config.chains.get(name))
        .cloned()
        .map(apply_chain_overrides)
        .collect()
}

pub(super) fn all_chains_with_overrides(manifest: &Manifest) -> Vec<ChainDefinition> {
    manifest
        .runtime_config
        .chain_names
        .iter()
        .filter_map(|name| manifest.runtime_config.chains.get(name))
        .cloned()
        .map(apply_chain_overrides)
        .collect()
}
