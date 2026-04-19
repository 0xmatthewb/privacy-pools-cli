use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    #[serde(rename = "manifestVersion")]
    pub manifest_version: String,
    #[serde(rename = "runtimeVersion")]
    pub runtime_version: String,
    #[serde(rename = "cliVersion")]
    pub cli_version: String,
    #[serde(rename = "jsonSchemaVersion")]
    pub json_schema_version: String,
    #[serde(rename = "commandPaths")]
    pub command_paths: Vec<String>,
    #[serde(rename = "aliasMap")]
    pub alias_map: HashMap<String, String>,
    #[serde(rename = "rootHelp")]
    pub root_help: String,
    #[serde(rename = "structuredRootHelp")]
    pub structured_root_help: String,
    #[serde(rename = "helpTextByPath")]
    pub help_text_by_path: HashMap<String, String>,
    #[serde(rename = "guideStructuredPayload")]
    pub guide_structured_payload: Value,
    #[serde(rename = "guideHumanText")]
    pub guide_human_text: String,
    #[serde(rename = "capabilitiesHumanText")]
    pub capabilities_human_text: String,
    #[serde(rename = "describeHumanTextByPath")]
    pub describe_human_text_by_path: HashMap<String, String>,
    #[serde(rename = "completionSpec")]
    pub completion_spec: CompletionCommandSpec,
    #[serde(rename = "completionScripts")]
    pub completion_scripts: HashMap<String, String>,
    #[serde(rename = "runtimeConfig")]
    pub runtime_config: RuntimeConfig,
    pub routes: ManifestRoutes,
    #[serde(rename = "capabilitiesPayload")]
    pub capabilities_payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NativeRuntimeContract {
    #[serde(rename = "runtimeVersion")]
    pub runtime_version: String,
    #[serde(rename = "workerProtocolVersion")]
    pub worker_protocol_version: String,
    #[serde(rename = "manifestVersion")]
    pub manifest_version: String,
    #[serde(rename = "nativeBridgeVersion")]
    pub native_bridge_version: String,
    #[serde(rename = "workerRequestEnv")]
    pub worker_request_env: String,
    #[serde(rename = "nativeBridgeEnv")]
    pub native_bridge_env: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestRoutes {
    #[serde(rename = "helpCommandPaths")]
    pub help_command_paths: Vec<String>,
    #[serde(rename = "commandRoutes")]
    pub command_routes: HashMap<String, ManifestCommandRoute>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManifestCommandRoute {
    pub owner: String,
    #[serde(rename = "nativeModes")]
    pub native_modes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeConfig {
    #[serde(rename = "chainEnvSuffixes")]
    pub chain_env_suffixes: HashMap<u64, String>,
    #[serde(rename = "defaultRpcUrls")]
    pub default_rpc_urls: HashMap<u64, Vec<String>>,
    #[serde(rename = "chainNames")]
    pub chain_names: Vec<String>,
    #[serde(rename = "mainnetChainNames")]
    pub mainnet_chain_names: Vec<String>,
    #[serde(rename = "nativeAssetAddress")]
    pub native_asset_address: String,
    #[serde(rename = "knownPools")]
    pub known_pools: HashMap<u64, HashMap<String, String>>,
    #[serde(rename = "explorerUrls")]
    pub explorer_urls: HashMap<u64, String>,
    pub chains: HashMap<String, ChainDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChainDefinition {
    pub id: u64,
    pub name: String,
    pub entrypoint: String,
    #[serde(rename = "aspHost")]
    pub asp_host: String,
    #[serde(rename = "relayerHost")]
    pub relayer_host: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompletionCommandSpec {
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub options: Vec<CompletionOptionSpec>,
    #[serde(default)]
    pub subcommands: Vec<CompletionCommandSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CompletionOptionSpec {
    pub names: Vec<String>,
    #[serde(rename = "takesValue")]
    pub takes_value: bool,
    #[serde(default)]
    pub values: Vec<String>,
}

pub fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(include_str!("../generated/manifest.json"))
            .expect("native shell manifest must deserialize")
    })
}

pub fn runtime_contract() -> &'static NativeRuntimeContract {
    static RUNTIME_CONTRACT: OnceLock<NativeRuntimeContract> = OnceLock::new();
    RUNTIME_CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../generated/runtime-contract.json"))
            .expect("native shell runtime contract must deserialize")
    })
}
