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

#[cfg(test)]
mod extended_tests {
    use super::{all_chains_with_overrides, default_read_only_chains};
    use crate::contract::manifest;
    use crate::test_env::env_lock;
    use std::env;

    fn with_env<R>(vars: &[(&str, Option<&str>)], run: impl FnOnce() -> R) -> R {
        let _guard = env_lock()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = vars
            .iter()
            .map(|(key, _)| ((*key).to_string(), env::var(key).ok()))
            .collect::<Vec<_>>();

        for (key, value) in vars {
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
        }

        let result = run();

        for (key, value) in previous {
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
        }

        result
    }

    #[test]
    fn default_read_only_chains_match_mainnet_contract_order() {
        let manifest = manifest();
        let chains = default_read_only_chains(manifest);
        let names = chains
            .iter()
            .map(|chain| chain.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, manifest.runtime_config.mainnet_chain_names);
    }

    #[test]
    fn all_chains_with_overrides_include_testnets_and_apply_env_overrides() {
        let manifest = manifest();
        let chains = with_env(
            &[
                ("PP_ASP_HOST_MAINNET", Some("https://asp.override")),
                ("PP_RELAYER_HOST", Some("https://relayer.override")),
            ],
            || all_chains_with_overrides(manifest),
        );

        let names = chains
            .iter()
            .map(|chain| chain.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, manifest.runtime_config.chain_names);

        let mainnet = chains
            .iter()
            .find(|chain| chain.name == "mainnet")
            .expect("mainnet should be present");
        assert_eq!(mainnet.asp_host, "https://asp.override");
        assert_eq!(mainnet.relayer_host, "https://relayer.override");

        assert!(chains.iter().any(|chain| chain.name == "sepolia"));
    }
}
