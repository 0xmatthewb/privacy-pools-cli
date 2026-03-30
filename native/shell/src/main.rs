mod completion;
mod root_argv;
mod routing;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use completion::{detect_completion_shell, parse_completion_query, parse_completion_script_spec};
use num_bigint::BigUint;
use num_traits::{ToPrimitive, Zero};
use root_argv::{
    has_short_flag, is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option, parse_root_argv, read_long_option_value, root_argv_slice,
    ParsedRootArgv,
};
use routing::{
    activity_native_mode, is_known_root_command, is_static_quiet_mode, manifest_allows_native_mode,
    pools_native_mode, resolve_command_path, resolve_help_path, resolve_mode, stats_native_mode,
    NativeMode,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_keccak::{Hasher, Keccak};

const ENV_JS_WORKER_PATH: &str = "PRIVACY_POOLS_CLI_JS_WORKER";
const OUTPUT_FORMAT_CHOICES: &str = "table, csv, json";

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const CSV_SUPPORTED_COMMANDS: [&str; 5] = ["pools", "accounts", "activity", "stats", "history"];

#[derive(Clone, Copy)]
enum ErrorCategory {
    Input,
    Rpc,
    Asp,
    Unknown,
}

impl ErrorCategory {
    fn as_str(self) -> &'static str {
        match self {
            ErrorCategory::Input => "INPUT",
            ErrorCategory::Rpc => "RPC",
            ErrorCategory::Asp => "ASP",
            ErrorCategory::Unknown => "UNKNOWN",
        }
    }

    fn exit_code(self) -> i32 {
        match self {
            ErrorCategory::Unknown => 1,
            ErrorCategory::Input => 2,
            ErrorCategory::Rpc => 3,
            ErrorCategory::Asp => 4,
        }
    }

    fn default_code(self) -> &'static str {
        match self {
            ErrorCategory::Input => "INPUT_ERROR",
            ErrorCategory::Rpc => "RPC_ERROR",
            ErrorCategory::Asp => "ASP_ERROR",
            ErrorCategory::Unknown => "UNKNOWN_ERROR",
        }
    }
}

#[derive(Clone)]
struct CliError {
    category: ErrorCategory,
    code: String,
    message: String,
    hint: Option<String>,
    retryable: bool,
}

impl CliError {
    fn new(
        category: ErrorCategory,
        message: impl Into<String>,
        hint: Option<String>,
        code: Option<&str>,
        retryable: bool,
    ) -> Self {
        let category_code = category.default_code().to_string();
        Self {
            category,
            code: code.unwrap_or(&category_code).to_string(),
            message: message.into(),
            hint,
            retryable,
        }
    }

    fn input(message: impl Into<String>, hint: impl Into<Option<String>>) -> Self {
        Self::new(ErrorCategory::Input, message, hint.into(), None, false)
    }

    fn rpc(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: Option<&str>,
    ) -> Self {
        Self::new(ErrorCategory::Rpc, message, hint.into(), code, false)
    }

    fn rpc_retryable(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: Option<&str>,
    ) -> Self {
        Self::new(ErrorCategory::Rpc, message, hint.into(), code, true)
    }

    fn asp(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: Option<&str>,
        retryable: bool,
    ) -> Self {
        Self::new(ErrorCategory::Asp, message, hint.into(), code, retryable)
    }

    fn unknown(message: impl Into<String>, hint: impl Into<Option<String>>) -> Self {
        Self::new(ErrorCategory::Unknown, message, hint.into(), None, false)
    }
}

#[derive(Debug, Clone)]
struct CliConfig {
    default_chain: String,
    rpc_overrides: HashMap<u64, String>,
}

#[derive(Debug, Clone)]
struct PoolsCommandOptions {
    all_chains: bool,
    search: Option<String>,
    sort: String,
}

#[derive(Debug, Clone)]
struct ActivityCommandOptions {
    asset: Option<String>,
    page: u64,
    per_page: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct Manifest {
    #[serde(rename = "manifestVersion")]
    manifest_version: String,
    #[serde(rename = "runtimeVersion")]
    runtime_version: String,
    #[serde(rename = "cliVersion")]
    cli_version: String,
    #[serde(rename = "jsonSchemaVersion")]
    json_schema_version: String,
    #[serde(rename = "commandPaths")]
    command_paths: Vec<String>,
    #[serde(rename = "aliasMap")]
    alias_map: HashMap<String, String>,
    #[serde(rename = "rootHelp")]
    root_help: String,
    #[serde(rename = "structuredRootHelp")]
    structured_root_help: String,
    #[serde(rename = "helpTextByPath")]
    help_text_by_path: HashMap<String, String>,
    #[serde(rename = "guideHumanText")]
    guide_human_text: String,
    #[serde(rename = "capabilitiesHumanText")]
    capabilities_human_text: String,
    #[serde(rename = "describeHumanTextByPath")]
    describe_human_text_by_path: HashMap<String, String>,
    #[serde(rename = "completionSpec")]
    completion_spec: CompletionCommandSpec,
    #[serde(rename = "completionScripts")]
    completion_scripts: HashMap<String, String>,
    #[serde(rename = "runtimeConfig")]
    runtime_config: RuntimeConfig,
    routes: ManifestRoutes,
    #[serde(rename = "capabilitiesPayload")]
    capabilities_payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
struct NativeRuntimeContract {
    #[serde(rename = "runtimeVersion")]
    runtime_version: String,
    #[serde(rename = "workerProtocolVersion")]
    worker_protocol_version: String,
    #[serde(rename = "manifestVersion")]
    manifest_version: String,
    #[serde(rename = "nativeBridgeVersion")]
    native_bridge_version: String,
    #[serde(rename = "workerRequestEnv")]
    worker_request_env: String,
    #[serde(rename = "nativeBridgeEnv")]
    native_bridge_env: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestRoutes {
    #[serde(rename = "helpCommandPaths")]
    help_command_paths: Vec<String>,
    #[serde(rename = "commandRoutes")]
    command_routes: HashMap<String, ManifestCommandRoute>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestCommandRoute {
    owner: String,
    #[serde(rename = "nativeModes")]
    native_modes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsBridgeDescriptor {
    #[serde(rename = "runtimeVersion")]
    runtime_version: String,
    #[serde(rename = "workerProtocolVersion")]
    worker_protocol_version: String,
    #[serde(rename = "nativeBridgeVersion")]
    native_bridge_version: String,
    #[serde(rename = "workerRequestEnv")]
    worker_request_env: String,
    #[serde(rename = "workerCommand")]
    worker_command: String,
    #[serde(rename = "workerArgs")]
    worker_args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RuntimeConfig {
    #[serde(rename = "chainEnvSuffixes")]
    chain_env_suffixes: HashMap<u64, String>,
    #[serde(rename = "defaultRpcUrls")]
    default_rpc_urls: HashMap<u64, Vec<String>>,
    #[serde(rename = "chainNames")]
    chain_names: Vec<String>,
    #[serde(rename = "mainnetChainNames")]
    mainnet_chain_names: Vec<String>,
    #[serde(rename = "nativeAssetAddress")]
    native_asset_address: String,
    #[serde(rename = "knownPools")]
    known_pools: HashMap<u64, HashMap<String, String>>,
    #[serde(rename = "explorerUrls")]
    explorer_urls: HashMap<u64, String>,
    chains: HashMap<String, ChainDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChainDefinition {
    id: u64,
    name: String,
    entrypoint: String,
    #[serde(rename = "aspHost")]
    asp_host: String,
    #[serde(rename = "relayerHost")]
    relayer_host: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CompletionCommandSpec {
    name: String,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(default)]
    options: Vec<CompletionOptionSpec>,
    #[serde(default)]
    subcommands: Vec<CompletionCommandSpec>,
}

#[derive(Debug, Clone, Deserialize)]
struct CompletionOptionSpec {
    names: Vec<String>,
    #[serde(rename = "takesValue")]
    takes_value: bool,
    #[serde(default)]
    values: Vec<String>,
}

#[derive(Debug, Clone)]
struct CompletionNode {
    options: Vec<CompletionOptionSpec>,
    subcommands: HashMap<String, CompletionNode>,
}

#[derive(Debug, Clone)]
struct PoolListingEntry {
    chain: String,
    chain_id: u64,
    asset: String,
    token_address: String,
    pool: String,
    scope: String,
    decimals: u32,
    minimum_deposit: String,
    vetting_fee_bps: String,
    max_relay_fee_bps: String,
    total_in_pool_value: Option<String>,
    total_in_pool_value_usd: Option<String>,
    total_deposits_value: Option<String>,
    total_deposits_value_usd: Option<String>,
    accepted_deposits_value: Option<String>,
    accepted_deposits_value_usd: Option<String>,
    pending_deposits_value: Option<String>,
    pending_deposits_value_usd: Option<String>,
    total_deposits_count: Option<u64>,
    accepted_deposits_count: Option<u64>,
    pending_deposits_count: Option<u64>,
    growth24h: Option<f64>,
    pending_growth24h: Option<f64>,
}

#[derive(Debug, Clone)]
struct PoolWarning {
    chain: String,
    category: String,
    message: String,
}

#[derive(Debug, Clone)]
struct ChainSummary {
    chain: String,
    pools: usize,
    error: Option<String>,
}

struct PoolsChainQueryResult {
    entries: Vec<PoolListingEntry>,
    warning: Option<PoolWarning>,
    summary: ChainSummary,
    error: Option<CliError>,
}

#[derive(Debug, Clone)]
struct ActivityRenderData {
    mode: &'static str,
    chain: String,
    chains: Option<Vec<String>>,
    page: u64,
    per_page: u64,
    total: Option<u64>,
    total_pages: Option<u64>,
    events: Vec<NormalizedActivityEvent>,
    asset: Option<String>,
    pool: Option<String>,
    scope: Option<String>,
    chain_filtered: bool,
}

#[derive(Debug, Clone)]
struct NormalizedActivityEvent {
    event_type: String,
    tx_hash: Option<String>,
    explorer_url: Option<String>,
    review_status: String,
    amount_raw: Option<String>,
    amount_formatted: String,
    pool_symbol: Option<String>,
    pool_address: Option<String>,
    chain_id: Option<u64>,
    timestamp_ms: Option<u64>,
    timestamp_iso: Option<String>,
}

#[derive(Debug, Clone)]
struct GlobalStatsRenderData {
    chain: String,
    chains: Vec<String>,
    cache_timestamp: Value,
    all_time: Value,
    last_24h: Value,
}

#[derive(Debug, Clone)]
struct PoolStatsRenderData {
    chain: String,
    asset: String,
    pool: String,
    scope: String,
    cache_timestamp: Value,
    all_time: Value,
    last_24h: Value,
}

#[derive(Debug, Clone)]
struct PoolsRenderData {
    all_chains: bool,
    chain_name: String,
    search: Option<String>,
    sort: String,
    filtered_pools: Vec<PoolListingEntry>,
    chain_summaries: Option<Vec<ChainSummary>>,
    warnings: Vec<PoolWarning>,
}

#[derive(Debug, Clone)]
struct NativePoolResolution {
    symbol: String,
    pool_address: String,
    scope: String,
}

fn main() {
    let argv: Vec<String> = env::args().skip(1).collect();
    let parsed = parse_root_argv(&argv);

    match run(&argv, &parsed) {
        Ok(code) => std::process::exit(code),
        Err(error) => print_error_and_exit(
            &error,
            parsed.is_structured_output_mode,
            parsed.is_quiet || parsed.is_agent,
        ),
    }
}

fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(include_str!("../generated/manifest.json"))
            .expect("native shell manifest must deserialize")
    })
}

fn runtime_contract() -> &'static NativeRuntimeContract {
    static RUNTIME_CONTRACT: OnceLock<NativeRuntimeContract> = OnceLock::new();
    RUNTIME_CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../generated/runtime-contract.json"))
            .expect("native shell runtime contract must deserialize")
    })
}

fn run(argv: &[String], parsed: &ParsedRootArgv) -> Result<i32, CliError> {
    let manifest = manifest();
    let runtime_contract = runtime_contract();
    if manifest.manifest_version.trim().is_empty() || manifest.runtime_version.trim().is_empty() {
        return Err(CliError::unknown(
            "Native shell manifest compatibility metadata is missing.",
            Some("Regenerate the native manifest and rebuild the CLI.".to_string()),
        ));
    }

    if manifest.manifest_version != runtime_contract.manifest_version {
        return Err(CliError::unknown(
            format!(
                "Native shell manifest version mismatch: expected {}, got {}.",
                runtime_contract.manifest_version, manifest.manifest_version
            ),
            Some("Regenerate the native manifest and rebuild the native shell.".to_string()),
        ));
    }

    if manifest.runtime_version != runtime_contract.runtime_version {
        return Err(CliError::unknown(
            format!(
                "Native shell runtime version mismatch: expected {}, got {}.",
                runtime_contract.runtime_version,
                manifest.runtime_version
            ),
            Some("Rebuild the CLI so the launcher, manifest, and native shell use the same runtime generation.".to_string()),
        ));
    }

    if let Some(format_value) = parsed.format_flag_value.as_deref() {
        if parsed.has_invalid_output_format() {
            return Err(CliError::input(
                format!(
                    "option '--format <format>' argument '{}' is invalid. Allowed choices are {}.",
                    format_value, OUTPUT_FORMAT_CHOICES
                ),
                Some("Use --help to see usage and examples.".to_string()),
            ));
        }
    }

    if parsed.is_version_like && parsed.first_command_token.is_none() {
        emit_version(&manifest.cli_version, parsed.is_structured_output_mode);
        return Ok(0);
    }

    if parsed.is_root_help_invocation {
        emit_help(
            if parsed.is_structured_output_mode {
                &manifest.structured_root_help
            } else {
                &manifest.root_help
            },
            parsed.is_structured_output_mode,
        );
        return Ok(0);
    }

    if parsed.is_structured_output_mode
        && !parsed.is_help_like
        && !parsed.is_version_like
        && parsed.first_command_token.is_none()
    {
        if root_argv_slice(argv).len() != argv.len() {
            return forward_to_js_worker(argv);
        }
        emit_help(&manifest.structured_root_help, true);
        return Ok(0);
    }

    if parsed.is_help_like {
        if let Some(help_path) = resolve_help_path(parsed, manifest) {
            if let Some(help_text) = manifest.help_text_by_path.get(&help_path) {
                emit_help(help_text, parsed.is_structured_output_mode);
                return Ok(0);
            }
        }

        if parsed.first_command_token.as_deref() == Some("help") {
            let requested = parsed
                .non_option_tokens
                .iter()
                .skip(1)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");
            return Err(CliError::input(
                format!("Unknown command path: {requested}"),
                Some(format!(
                    "Valid command paths: {}",
                    manifest.command_paths.join(", ")
                )),
            ));
        }
    }

    let Some(first_command) = parsed.first_command_token.as_deref() else {
        return forward_to_js_worker(argv);
    };

    match first_command {
        "guide" if manifest_allows_native_mode("guide", "default", manifest) => {
            handle_guide(parsed, manifest)
        }
        "capabilities" if manifest_allows_native_mode("capabilities", "default", manifest) => {
            handle_capabilities(parsed, manifest)
        }
        "describe" if manifest_allows_native_mode("describe", "default", manifest) => {
            handle_describe(parsed, manifest)
        }
        "completion" if manifest_allows_native_mode("completion", "default", manifest) => {
            handle_completion(argv, parsed, manifest)
        }
        "activity" if activity_native_mode(argv, parsed, manifest).is_some() => {
            handle_activity_native(argv, parsed, manifest)
        }
        "stats" if stats_native_mode(argv, parsed, manifest).is_some() => {
            handle_stats_native(argv, parsed, manifest)
        }
        "pools" if pools_native_mode(argv, parsed, manifest).is_some() => {
            handle_pools_native(argv, parsed, manifest)
        }
        _ if is_known_root_command(first_command, manifest) => forward_to_js_worker(argv),
        _ => Err(CliError::input(
            format!("unknown command '{first_command}'"),
            Some("Use --help to see usage and examples.".to_string()),
        )),
    }
}

fn handle_guide(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
    guard_csv_unsupported(parsed, "guide")?;

    if parsed.non_option_tokens.len() > 1 {
        return forward_to_js_worker(&parsed.argv);
    }

    if parsed.is_structured_output_mode {
        print_json_success(json!({
            "mode": "help",
            "help": manifest.guide_human_text.trim()
        }));
        return Ok(0);
    }

    if is_static_quiet_mode(parsed) {
        return Ok(0);
    }

    write_stderr_block_text(&manifest.guide_human_text);
    Ok(0)
}

fn handle_capabilities(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
    guard_csv_unsupported(parsed, "capabilities")?;

    if parsed.non_option_tokens.len() > 1 {
        return forward_to_js_worker(&parsed.argv);
    }

    if parsed.is_structured_output_mode {
        print_json_success(manifest.capabilities_payload.clone());
        return Ok(0);
    }

    if is_static_quiet_mode(parsed) {
        return Ok(0);
    }

    write_stderr_block_text(&manifest.capabilities_human_text);
    Ok(0)
}

fn handle_describe(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
    guard_csv_unsupported(parsed, "describe")?;

    let command_tokens = parsed
        .non_option_tokens
        .iter()
        .skip(1)
        .cloned()
        .collect::<Vec<_>>();

    if command_tokens.is_empty() {
        return forward_to_js_worker(&parsed.argv);
    }

    let Some(command_path) = resolve_command_path(&command_tokens, manifest) else {
        return Err(CliError::input(
            format!("Unknown command path: {}", command_tokens.join(" ")),
            Some(format!(
                "Valid command paths: {}",
                manifest.command_paths.join(", ")
            )),
        ));
    };

    if parsed.is_structured_output_mode {
        let descriptor = manifest
            .capabilities_payload
            .get("commandDetails")
            .and_then(|value| value.get(&command_path))
            .cloned()
            .ok_or_else(|| {
                CliError::unknown(
                    format!("Missing command descriptor for '{command_path}'."),
                    Some("Regenerate the command manifest.".to_string()),
                )
            })?;
        print_json_success(descriptor);
        return Ok(0);
    }

    if is_static_quiet_mode(parsed) {
        return Ok(0);
    }

    let text = manifest
        .describe_human_text_by_path
        .get(&command_path)
        .ok_or_else(|| {
            CliError::unknown(
                format!("Missing describe text for '{command_path}'."),
                Some("Regenerate the command manifest.".to_string()),
            )
        })?;
    write_stderr_block_text(text);
    Ok(0)
}

fn handle_completion(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    guard_csv_unsupported(parsed, "completion")?;

    if let Some(query) = parse_completion_query(argv)? {
        let candidates =
            query_completion_candidates(&query.words, query.cword, &manifest.completion_spec);

        if parsed.is_structured_output_mode {
            print_json_success(json!({
                "mode": "completion-query",
                "shell": query.shell,
                "cword": query.cword,
                "candidates": candidates,
            }));
        } else if !candidates.is_empty() {
            std::io::Write::write_all(
                &mut std::io::stdout(),
                format!("{}\n", candidates.join("\n")).as_bytes(),
            )
            .ok();
        }

        return Ok(0);
    }

    let spec = parse_completion_script_spec(argv)?;
    let shell = spec.shell.unwrap_or_else(detect_completion_shell);
    let script = manifest
        .completion_scripts
        .get(&shell)
        .cloned()
        .ok_or_else(|| {
            CliError::unknown(
                format!("Missing completion script for shell '{shell}'."),
                Some("Regenerate the command manifest.".to_string()),
            )
        })?;

    if parsed.is_structured_output_mode {
        print_json_success(json!({
            "mode": "completion-script",
            "shell": shell,
            "completionScript": script,
        }));
    } else {
        write_stdout_text(&script);
    }

    Ok(0)
}

fn handle_activity_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    let mode = resolve_mode(parsed);
    let opts = parse_activity_options(argv)?;
    let timeout_ms = parse_timeout_ms(argv);
    if !mode.is_json() && !mode.is_quiet {
        write_stderr_text("- Fetching public activity...");
    }

    if let Some(asset) = opts.asset.as_deref() {
        let config = load_config()?;
        let explicit_chain = parsed
            .global_chain()
            .unwrap_or_else(|| config.default_chain.clone());
        let chain = resolve_chain(&explicit_chain, manifest)?;
        let pool = resolve_pool_native(
            &chain,
            asset,
            parsed.global_rpc_url(),
            &config,
            manifest,
            timeout_ms,
        )?;
        let response =
            fetch_pool_events(&chain, &pool.scope, opts.page, opts.per_page, timeout_ms)?;
        let events = normalize_activity_events(
            response.get("events").cloned().unwrap_or_else(|| json!([])),
            Some(pool.symbol.as_str()),
            manifest,
        )?;
        let page = parse_json_u64(response.get("page")).unwrap_or(opts.page);
        let per_page = parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page);
        let total = parse_json_u64(response.get("total"));
        let total_pages = parse_json_u64(response.get("totalPages"));
        render_activity_output(
            &mode,
            ActivityRenderData {
                mode: "pool-activity",
                chain: chain.name.clone(),
                chains: None,
                page,
                per_page,
                total,
                total_pages,
                events,
                asset: Some(pool.symbol),
                pool: Some(pool.pool_address),
                scope: Some(pool.scope),
                chain_filtered: false,
            },
        );
        return Ok(0);
    }

    if let Some(explicit_chain) = parsed.global_chain() {
        let chain = resolve_chain(&explicit_chain, manifest)?;
        let response = fetch_global_events(&chain, opts.page, opts.per_page, timeout_ms)?;
        let events = normalize_activity_events(
            response.get("events").cloned().unwrap_or_else(|| json!([])),
            None,
            manifest,
        )?
        .into_iter()
        .filter(|event| event.chain_id.is_none() || event.chain_id == Some(chain.id))
        .collect::<Vec<_>>();
        render_activity_output(
            &mode,
            ActivityRenderData {
                mode: "global-activity",
                chain: chain.name,
                chains: None,
                page: parse_json_u64(response.get("page")).unwrap_or(opts.page),
                per_page: parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
                total: None,
                total_pages: None,
                events,
                asset: None,
                pool: None,
                scope: None,
                chain_filtered: true,
            },
        );
        return Ok(0);
    }

    let chains = default_read_only_chains(manifest);
    let representative_chain = chains.first().ok_or_else(|| {
        CliError::unknown(
            "No default read-only chains configured.",
            Some("Regenerate the native command manifest.".to_string()),
        )
    })?;
    let response = fetch_global_events(representative_chain, opts.page, opts.per_page, timeout_ms)?;
    let events = normalize_activity_events(
        response.get("events").cloned().unwrap_or_else(|| json!([])),
        None,
        manifest,
    )?;

    render_activity_output(
        &mode,
        ActivityRenderData {
            mode: "global-activity",
            chain: "all-mainnets".to_string(),
            chains: Some(
                chains
                    .iter()
                    .map(|chain| chain.name.clone())
                    .collect::<Vec<_>>(),
            ),
            page: parse_json_u64(response.get("page")).unwrap_or(opts.page),
            per_page: parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
            total: parse_json_u64(response.get("total")),
            total_pages: parse_json_u64(response.get("totalPages")),
            events,
            asset: None,
            pool: None,
            scope: None,
            chain_filtered: false,
        },
    );

    Ok(0)
}

fn handle_stats_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    if has_short_flag(argv, 't') {
        return Err(commander_unknown_option_error("-t"));
    }

    let mode = resolve_mode(parsed);
    if !mode.is_json() && !mode.is_quiet {
        let message = if resolve_stats_subcommand(parsed) == StatsSubcommand::Pool {
            "- Fetching pool statistics..."
        } else {
            "- Fetching global statistics..."
        };
        write_stderr_text(message);
    }

    let stats_subcommand = resolve_stats_subcommand(parsed);
    if stats_subcommand == StatsSubcommand::Pool {
        let asset = read_long_option_value(argv, "--asset").ok_or_else(|| {
            CliError::input(
                "Missing required --asset <symbol|address>.",
                Some("Example: privacy-pools stats pool --asset ETH".to_string()),
            )
        })?;
        let config = load_config()?;
        let explicit_chain = parsed
            .global_chain()
            .unwrap_or_else(|| config.default_chain.clone());
        let chain = resolve_chain(&explicit_chain, manifest)?;
        let timeout_ms = parse_timeout_ms(argv);
        let pool = resolve_pool_native(
            &chain,
            &asset,
            parsed.global_rpc_url(),
            &config,
            manifest,
            timeout_ms,
        )?;
        let response = fetch_pool_statistics(&chain, &pool.scope, timeout_ms)?;
        let pool_stats = response.get("pool").and_then(Value::as_object);

        render_pool_stats_output(
            &mode,
            PoolStatsRenderData {
                chain: chain.name,
                asset: pool.symbol,
                pool: pool.pool_address,
                scope: pool.scope,
                cache_timestamp: response
                    .get("cacheTimestamp")
                    .cloned()
                    .unwrap_or(Value::Null),
                all_time: pool_stats
                    .and_then(|stats| stats.get("allTime"))
                    .cloned()
                    .unwrap_or(Value::Null),
                last_24h: pool_stats
                    .and_then(|stats| stats.get("last24h"))
                    .cloned()
                    .unwrap_or(Value::Null),
            },
        );

        return Ok(0);
    }

    if parsed.global_chain().is_some() {
        return Err(CliError::input(
            "Global statistics are aggregated across all chains. The --chain flag is not supported for this subcommand.",
            Some(
                "For chain-specific data use: privacy-pools stats pool --asset <symbol> --chain <chain>"
                    .to_string(),
            ),
        ));
    }

    let chains = default_read_only_chains(manifest);
    let representative_chain = chains.first().ok_or_else(|| {
        CliError::unknown(
            "No default read-only chains configured.",
            Some("Regenerate the native command manifest.".to_string()),
        )
    })?;
    let response = fetch_global_statistics(representative_chain, parse_timeout_ms(argv))?;

    render_global_stats_output(
        &mode,
        GlobalStatsRenderData {
            chain: "all-mainnets".to_string(),
            chains: chains
                .iter()
                .map(|chain| chain.name.clone())
                .collect::<Vec<_>>(),
            cache_timestamp: response
                .get("cacheTimestamp")
                .cloned()
                .unwrap_or(Value::Null),
            all_time: response.get("allTime").cloned().unwrap_or(Value::Null),
            last_24h: response.get("last24h").cloned().unwrap_or(Value::Null),
        },
    );

    Ok(0)
}

fn handle_pools_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    let mode = resolve_mode(parsed);
    let opts = parse_pools_options(argv)?;
    let config = load_config()?;
    let timeout_ms = parse_timeout_ms(argv);
    let explicit_chain = parsed.global_chain();
    let rpc_override = parsed.global_rpc_url();
    let is_multi_chain = opts.all_chains || explicit_chain.is_none();

    if is_multi_chain && rpc_override.is_some() {
        return Err(CliError::input(
            "--rpc-url cannot be combined with multi-chain queries.",
            Some("Use --chain <name> to target a single chain with --rpc-url.".to_string()),
        ));
    }

    let chains_to_query = if opts.all_chains {
        all_chains_with_overrides(manifest)
    } else if let Some(chain_name) = explicit_chain {
        vec![resolve_chain(&chain_name, manifest)?]
    } else {
        default_read_only_chains(manifest)
    };
    if !mode.is_json() && !mode.is_quiet && !mode.is_csv() {
        let message = if is_multi_chain {
            "- Fetching pools across chains...".to_string()
        } else {
            format!("- Fetching pools for {}...", chains_to_query[0].name)
        };
        write_stderr_text(&message);
    }

    let mut entries = Vec::<PoolListingEntry>::new();
    let mut warnings = Vec::<PoolWarning>::new();
    let mut chain_summaries = Vec::<ChainSummary>::new();
    let mut first_error: Option<CliError> = None;

    if is_multi_chain && chains_to_query.len() > 1 {
        let runtime_config = manifest.runtime_config.clone();
        let handles = chains_to_query
            .iter()
            .map(|chain| {
                let chain = chain.clone();
                let rpc_override = rpc_override.clone();
                let config = config.clone();
                let runtime_config = runtime_config.clone();
                std::thread::spawn(move || {
                    query_pools_for_chain(chain, rpc_override, config, runtime_config, timeout_ms)
                })
            })
            .collect::<Vec<_>>();

        for (index, handle) in handles.into_iter().enumerate() {
            let result = match handle.join() {
                Ok(result) => result,
                Err(_) => pools_worker_join_failure(&chains_to_query[index].name),
            };
            apply_pools_chain_query_result(
                result,
                &mut entries,
                &mut warnings,
                &mut chain_summaries,
                &mut first_error,
            );
        }
    } else {
        for chain in &chains_to_query {
            apply_pools_chain_query_result(
                query_pools_for_chain(
                    chain.clone(),
                    rpc_override.clone(),
                    config.clone(),
                    manifest.runtime_config.clone(),
                    timeout_ms,
                ),
                &mut entries,
                &mut warnings,
                &mut chain_summaries,
                &mut first_error,
            );
        }
    }

    if entries.is_empty() {
        if let Some(error) = first_error {
            return Err(error);
        }

        if is_multi_chain {
            render_pools_empty_output(
                &mode,
                PoolsRenderData {
                    all_chains: true,
                    chain_name: String::new(),
                    search: opts.search.clone(),
                    sort: opts.sort.clone(),
                    filtered_pools: vec![],
                    chain_summaries: Some(chain_summaries),
                    warnings,
                },
            );
        } else {
            render_pools_empty_output(
                &mode,
                PoolsRenderData {
                    all_chains: false,
                    chain_name: chains_to_query[0].name.clone(),
                    search: opts.search.clone(),
                    sort: opts.sort.clone(),
                    filtered_pools: vec![],
                    chain_summaries: None,
                    warnings,
                },
            );
        }
        return Ok(0);
    }

    let mut filtered = apply_pool_search(entries, opts.search.as_deref());
    sort_pools(&mut filtered, &opts.sort);

    render_pools_output(
        &mode,
        PoolsRenderData {
            all_chains: is_multi_chain,
            chain_name: if is_multi_chain {
                String::new()
            } else {
                chains_to_query[0].name.clone()
            },
            search: opts.search,
            sort: opts.sort,
            filtered_pools: filtered,
            chain_summaries: if is_multi_chain {
                Some(chain_summaries)
            } else {
                None
            },
            warnings,
        },
    );

    Ok(0)
}

fn query_pools_for_chain(
    chain: ChainDefinition,
    rpc_override: Option<String>,
    config: CliConfig,
    runtime_config: RuntimeConfig,
    timeout_ms: u64,
) -> PoolsChainQueryResult {
    match list_pools_native(&chain, rpc_override, &config, &runtime_config, timeout_ms) {
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

fn apply_pools_chain_query_result(
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

fn pools_worker_join_failure(chain_name: &str) -> PoolsChainQueryResult {
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

fn forward_to_js_worker(argv: &[String]) -> Result<i32, CliError> {
    let runtime_contract = runtime_contract();
    let bridge = env::var(&runtime_contract.native_bridge_env)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|encoded| decode_js_bridge_descriptor(&encoded))
        .transpose()?;

    let (worker_command, worker_args, worker_request_env, worker_protocol_version) = match bridge {
        Some(bridge) => (
            bridge.worker_command,
            bridge.worker_args,
            bridge.worker_request_env,
            bridge.worker_protocol_version,
        ),
        None => {
            let worker_command = env::var(ENV_JS_WORKER_PATH)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    CliError::unknown(
                        "JS worker bootstrap is unavailable.",
                        Some(
                            "Run the native shell through the npm launcher so it can forward JS-owned commands."
                                .to_string(),
                        ),
                    )
                })?;

            (
                worker_command,
                Vec::new(),
                runtime_contract.worker_request_env.clone(),
                runtime_contract.worker_protocol_version.clone(),
            )
        }
    };

    let request = json!({
        "protocolVersion": worker_protocol_version,
        "argv": argv,
    });
    let encoded_request = BASE64.encode(serde_json::to_vec(&request).map_err(|error| {
        CliError::unknown(
            format!("Failed to encode worker request: {error}"),
            Some("Please report this issue.".to_string()),
        )
    })?);

    let mut child = Command::new(worker_command);
    child
        .args(worker_args)
        .env(worker_request_env, encoded_request)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let status = child.status().map_err(|error| {
        CliError::unknown(
            format!("Failed to launch JS worker: {error}"),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        )
    })?;

    Ok(exit_code_from_status(status))
}

fn emit_help(text: &str, structured: bool) {
    if structured {
        print_json_success(json!({
            "mode": "help",
            "help": text.trim_end()
        }));
    } else {
        write_stdout_text(text);
    }
}

fn emit_version(version: &str, structured: bool) {
    if structured {
        print_json_success(json!({
            "mode": "version",
            "version": version
        }));
    } else {
        std::io::Write::write_all(&mut std::io::stdout(), format!("{version}\n").as_bytes()).ok();
    }
}

fn write_stdout_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with('\n') {
        value.push('\n');
    }
    std::io::Write::write_all(&mut std::io::stdout(), value.as_bytes()).ok();
}

fn write_stderr_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with('\n') {
        value.push('\n');
    }
    std::io::Write::write_all(&mut std::io::stderr(), value.as_bytes()).ok();
}

fn write_stderr_block_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with("\n\n") {
        value.push('\n');
        value.push('\n');
    }
    std::io::Write::write_all(&mut std::io::stderr(), value.as_bytes()).ok();
}

fn json_schema_version() -> &'static str {
    manifest().json_schema_version.as_str()
}

fn print_json_success(payload: Value) {
    let mut object = payload.as_object().cloned().unwrap_or_default();
    object.insert(
        "schemaVersion".to_string(),
        Value::String(json_schema_version().to_string()),
    );
    object.insert("success".to_string(), Value::Bool(true));
    let output = Value::Object(object);
    write_stdout_text(&serde_json::to_string(&output).expect("json success must serialize"));
}

fn print_error_and_exit(error: &CliError, structured: bool, quiet: bool) -> ! {
    if structured {
        let payload = json!({
            "schemaVersion": json_schema_version(),
            "success": false,
            "errorCode": error.code,
            "errorMessage": error.message,
            "error": {
                "category": error.category.as_str(),
                "message": error.message,
                "hint": error.hint,
                "retryable": error.retryable,
                "code": error.code,
            }
        });
        write_stdout_text(&serde_json::to_string(&payload).expect("json error must serialize"));
    } else if !quiet {
        write_stderr_text(&format!(
            "Error [{}]: {}",
            error.category.as_str(),
            error.message
        ));
        if let Some(hint) = &error.hint {
            write_stderr_text(&format!("Hint: {hint}"));
        }
    }

    std::process::exit(error.category.exit_code());
}

fn decode_js_bridge_descriptor(encoded: &str) -> Result<JsBridgeDescriptor, CliError> {
    let runtime_contract = runtime_contract();
    let bytes = BASE64.decode(encoded).map_err(|error| {
        CliError::unknown(
            format!("Failed to decode JS bridge descriptor: {error}"),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        )
    })?;

    let descriptor: JsBridgeDescriptor = serde_json::from_slice(&bytes).map_err(|error| {
        CliError::unknown(
            format!("Malformed JS bridge descriptor: {error}"),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        )
    })?;

    if descriptor.runtime_version.trim().is_empty()
        || descriptor.worker_protocol_version.trim().is_empty()
        || descriptor.native_bridge_version.trim().is_empty()
        || descriptor.worker_request_env.trim().is_empty()
        || descriptor.worker_command.trim().is_empty()
    {
        return Err(CliError::unknown(
            "JS bridge descriptor is incomplete.",
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.runtime_version != runtime_contract.runtime_version {
        return Err(CliError::unknown(
            format!(
                "JS bridge runtime version mismatch: expected {}, got {}.",
                runtime_contract.runtime_version, descriptor.runtime_version
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.worker_protocol_version != runtime_contract.worker_protocol_version {
        return Err(CliError::unknown(
            format!(
                "JS bridge worker protocol mismatch: expected {}, got {}.",
                runtime_contract.worker_protocol_version, descriptor.worker_protocol_version
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.native_bridge_version != runtime_contract.native_bridge_version {
        return Err(CliError::unknown(
            format!(
                "JS bridge version mismatch: expected {}, got {}.",
                runtime_contract.native_bridge_version, descriptor.native_bridge_version
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.worker_request_env != runtime_contract.worker_request_env {
        return Err(CliError::unknown(
            format!(
                "JS bridge worker request env mismatch: expected {}, got {}.",
                runtime_contract.worker_request_env, descriptor.worker_request_env
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    Ok(descriptor)
}

fn resolve_chain(name: &str, manifest: &Manifest) -> Result<ChainDefinition, CliError> {
    let base = manifest
        .runtime_config
        .chains
        .get(name)
        .cloned()
        .ok_or_else(|| {
            CliError::input(
                format!("Unsupported chain: {name}."),
                Some(format!(
                    "Supported chains: {}",
                    manifest.runtime_config.chain_names.join(", ")
                )),
            )
        })?;

    Ok(apply_chain_overrides(base))
}

fn apply_chain_overrides(mut chain: ChainDefinition) -> ChainDefinition {
    if let Some(asp_host) = resolve_host_override("ASP_HOST", &chain.name) {
        chain.asp_host = asp_host;
    }
    if let Some(relayer_host) = resolve_host_override("RELAYER_HOST", &chain.name) {
        chain.relayer_host = relayer_host;
    }
    chain
}

fn resolve_host_override(kind: &str, chain_name: &str) -> Option<String> {
    let chain_suffix = normalized_chain_env_suffix(chain_name);
    env::var(format!("PRIVACY_POOLS_{kind}_{chain_suffix}"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            env::var(format!("PP_{kind}_{chain_suffix}"))
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            env::var(format!("PRIVACY_POOLS_{kind}"))
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(|| {
            env::var(format!("PP_{kind}"))
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
}

fn normalized_chain_env_suffix(chain_name: &str) -> String {
    chain_name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect()
}

fn config_home() -> PathBuf {
    if let Ok(value) = env::var("PRIVACY_POOLS_HOME") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    if let Ok(value) = env::var("PRIVACY_POOLS_CONFIG_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| env::var("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".privacy-pools")
}

fn config_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join("config.json")
}

fn load_config() -> Result<CliConfig, CliError> {
    let config_dir = config_home();
    let config_path = config_file_path(&config_dir);

    if !config_path.exists() {
        return Ok(CliConfig {
            default_chain: "mainnet".to_string(),
            rpc_overrides: HashMap::new(),
        });
    }

    let raw = fs::read_to_string(&config_path).map_err(|_| {
        CliError::input(
            "Config file is not valid JSON.",
            Some(format!(
                "Fix or remove {}, then run 'privacy-pools init'.",
                config_path.display()
            )),
        )
    })?;

    let parsed: Value = serde_json::from_str(&raw).map_err(|_| {
        CliError::input(
            "Config file is not valid JSON.",
            Some(format!(
                "Fix or remove {}, then run 'privacy-pools init'.",
                config_path.display()
            )),
        )
    })?;

    let object = parsed.as_object().ok_or_else(|| {
        CliError::input(
            "Config file has invalid structure.",
            Some(format!(
                "Fix or remove {}, then run 'privacy-pools init'.",
                config_path.display()
            )),
        )
    })?;

    let default_chain = object
        .get("defaultChain")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            CliError::input(
                "Config file is missing a valid defaultChain.",
                Some(format!(
                    "Fix or remove {}, then run 'privacy-pools init'.",
                    config_path.display()
                )),
            )
        })?
        .to_string();

    let mut rpc_overrides = HashMap::new();
    if let Some(overrides) = object.get("rpcOverrides") {
        let overrides_object = overrides.as_object().ok_or_else(|| {
            CliError::input(
                "Config rpcOverrides must be an object.",
                Some(format!(
                    "Fix or remove {}, then run 'privacy-pools init'.",
                    config_path.display()
                )),
            )
        })?;

        for (key, value) in overrides_object {
            let override_value = value
                .as_str()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    CliError::input(
                        format!(
                            "Config rpcOverrides contains invalid value for chain key \"{key}\"."
                        ),
                        Some(format!(
                            "Fix or remove {}, then run 'privacy-pools init'.",
                            config_path.display()
                        )),
                    )
                })?;

            let chain_id = key.parse::<u64>().map_err(|_| {
                CliError::input(
                    format!("Config rpcOverrides contains invalid chain key \"{key}\"."),
                    Some(format!(
                        "Fix or remove {}, then run 'privacy-pools init'.",
                        config_path.display()
                    )),
                )
            })?;

            rpc_overrides.insert(chain_id, override_value.to_string());
        }
    }

    Ok(CliConfig {
        default_chain,
        rpc_overrides,
    })
}

fn resolve_rpc_env_var(chain_id: u64, runtime_config: &RuntimeConfig) -> Option<String> {
    if let Some(suffix) = runtime_config.chain_env_suffixes.get(&chain_id) {
        env::var(format!("PRIVACY_POOLS_RPC_URL_{suffix}"))
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                env::var(format!("PP_RPC_URL_{suffix}"))
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                env::var("PRIVACY_POOLS_RPC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
            .or_else(|| {
                env::var("PP_RPC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
    } else {
        env::var("PRIVACY_POOLS_RPC_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                env::var("PP_RPC_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
    }
}

fn get_rpc_urls(
    chain_id: u64,
    override_from_flag: Option<String>,
    config: &CliConfig,
    runtime_config: &RuntimeConfig,
) -> Result<Vec<String>, CliError> {
    if let Some(value) = override_from_flag.filter(|value| !value.trim().is_empty()) {
        return Ok(vec![value]);
    }

    if let Some(value) = resolve_rpc_env_var(chain_id, runtime_config) {
        return Ok(vec![value]);
    }

    if let Some(value) = config.rpc_overrides.get(&chain_id) {
        return Ok(vec![value.clone()]);
    }

    runtime_config
        .default_rpc_urls
        .get(&chain_id)
        .cloned()
        .filter(|values| !values.is_empty())
        .ok_or_else(|| {
            CliError::rpc(
                format!("No RPC URL configured for chain {chain_id}."),
                Some(
                    "Pass --rpc-url <url> on the command, or set PP_RPC_URL in your environment."
                        .to_string(),
                ),
                None,
            )
        })
}

fn guard_csv_unsupported(parsed: &ParsedRootArgv, command_name: &str) -> Result<(), CliError> {
    if parsed.is_csv_mode {
        return Err(CliError::input(
            format!("--format csv is not supported for '{command_name}'."),
            Some(format!(
                "CSV output is available for: {}.",
                CSV_SUPPORTED_COMMANDS.join(", ")
            )),
        ));
    }
    Ok(())
}

fn build_completion_tree(spec: &CompletionCommandSpec) -> CompletionNode {
    let mut subcommands = HashMap::new();
    for subcommand in &spec.subcommands {
        let node = build_completion_tree(subcommand);
        let mut names = vec![subcommand.name.clone()];
        names.extend(subcommand.aliases.clone());
        for name in names {
            subcommands.insert(name, node.clone());
        }
    }

    CompletionNode {
        options: spec.options.clone(),
        subcommands,
    }
}

fn query_completion_candidates(
    words_input: &[String],
    cword_input: Option<usize>,
    root_spec: &CompletionCommandSpec,
) -> Vec<String> {
    let tree = build_completion_tree(root_spec);
    let command_name = if root_spec.name.is_empty() {
        "privacy-pools".to_string()
    } else {
        root_spec.name.clone()
    };
    let accepted_command_names = vec![command_name.clone(), "privacy-pools".to_string()];
    let words = normalize_completion_words(words_input, &command_name, &accepted_command_names);
    let cword = normalize_completion_cword(cword_input, words.len());
    let current_token = words.get(cword).cloned().unwrap_or_default();

    let (current, expecting_value_for) = resolve_completion_context(&tree, &words, cword);

    if current_token.starts_with('-') && current_token.contains('=') {
        let mut parts = current_token.splitn(2, '=');
        let flag = parts.next().unwrap_or_default();
        let value_prefix = parts.next().unwrap_or_default();
        if let Some(option) = find_completion_option(flag, &current, &tree) {
            if !option.values.is_empty() {
                return filter_completion_candidates(
                    option
                        .values
                        .iter()
                        .map(|value| format!("{flag}={value}"))
                        .collect(),
                    value_prefix,
                );
            }
        }
    }

    if let Some(option) = expecting_value_for {
        if option.values.is_empty() {
            return vec![];
        }
        return filter_completion_candidates(option.values.clone(), &current_token);
    }

    let mut candidates = vec![];
    candidates.extend(current.subcommands.keys().cloned());
    candidates.extend(
        merged_completion_options(&current, &tree)
            .into_iter()
            .flat_map(|option| option.names),
    );
    filter_completion_candidates(candidates, &current_token)
}

fn normalize_completion_words(
    words: &[String],
    command_name: &str,
    accepted_command_names: &[String],
) -> Vec<String> {
    if words.is_empty() {
        return vec![command_name.to_string()];
    }

    if accepted_command_names
        .iter()
        .any(|value| value == &words[0])
    {
        let mut normalized = vec![command_name.to_string()];
        normalized.extend(words.iter().skip(1).cloned());
        return normalized;
    }

    let mut normalized = vec![command_name.to_string()];
    normalized.extend(words.iter().cloned());
    normalized
}

fn normalize_completion_cword(cword: Option<usize>, words_length: usize) -> usize {
    let fallback = words_length.saturating_sub(1);
    match cword {
        Some(value) => value.min(words_length),
        None => fallback,
    }
}

fn resolve_completion_context(
    root: &CompletionNode,
    words: &[String],
    cword: usize,
) -> (CompletionNode, Option<CompletionOptionSpec>) {
    let mut current = root.clone();
    let mut expecting_value_for: Option<CompletionOptionSpec> = None;
    let boundary = cword.min(words.len()).max(1);

    for token in words.iter().take(boundary).skip(1) {
        if expecting_value_for.is_some() {
            expecting_value_for = None;
            continue;
        }

        if token.starts_with('-') {
            let flag = token.split('=').next().unwrap_or_default();
            if let Some(option) = find_completion_option(flag, &current, root) {
                if option.takes_value && !token.contains('=') {
                    expecting_value_for = Some(option);
                }
            }
            continue;
        }

        if let Some(subcommand) = current.subcommands.get(token) {
            current = subcommand.clone();
        }
    }

    (current, expecting_value_for)
}

fn find_completion_option(
    token: &str,
    current: &CompletionNode,
    root: &CompletionNode,
) -> Option<CompletionOptionSpec> {
    merged_completion_options(current, root)
        .into_iter()
        .find(|option| option.names.iter().any(|name| name == token))
}

fn merged_completion_options(
    current: &CompletionNode,
    root: &CompletionNode,
) -> Vec<CompletionOptionSpec> {
    let option_lists = if std::ptr::eq(current, root) {
        vec![current.options.clone()]
    } else {
        vec![root.options.clone(), current.options.clone()]
    };

    let mut merged = HashMap::<String, CompletionOptionSpec>::new();
    for options in option_lists {
        for option in options {
            let key = option.names.join("|");
            merged.entry(key).or_insert(option);
        }
    }
    merged.into_values().collect()
}

fn filter_completion_candidates(candidates: Vec<String>, prefix: &str) -> Vec<String> {
    let mut values = candidates
        .into_iter()
        .filter(|candidate| prefix.is_empty() || candidate.starts_with(prefix))
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        left.to_ascii_lowercase()
            .cmp(&right.to_ascii_lowercase())
            .then_with(|| {
                left.chars()
                    .any(|value| value.is_ascii_uppercase())
                    .cmp(&right.chars().any(|value| value.is_ascii_uppercase()))
            })
            .then_with(|| left.cmp(right))
    });
    values.dedup();
    values
}

fn commander_unknown_option_error(token: &str) -> CliError {
    CliError::input(
        format!("unknown option '{token}'"),
        Some("Use --help to see usage and examples.".to_string()),
    )
}

fn commander_too_many_arguments_error(
    command_name: &str,
    expected_args: usize,
    received_args: usize,
) -> CliError {
    let noun = if expected_args == 1 {
        "argument"
    } else {
        "arguments"
    };
    CliError::input(
        format!(
            "too many arguments for '{command_name}'. Expected {expected_args} {noun} but got {received_args}."
        ),
        Some("Use --help to see usage and examples.".to_string()),
    )
}

fn parse_activity_options(argv: &[String]) -> Result<ActivityCommandOptions, CliError> {
    let mut asset = None;
    let mut page = None;
    let mut per_page = None;
    let mut unexpected_args = 0;
    let mut index = argv
        .iter()
        .position(|token| token == "activity")
        .map(|value| value + 1)
        .unwrap_or(argv.len());

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            unexpected_args += argv.len().saturating_sub(index + 1);
            break;
        }
        if token == "--asset" || token == "-a" {
            asset = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--asset=") {
            asset = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--page" {
            page = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--page=") {
            page = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--limit" {
            per_page = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--limit=") {
            per_page = Some(value.to_string());
            index += 1;
            continue;
        }
        if is_command_global_value_option(token) {
            index += 2;
            continue;
        }
        if is_command_global_inline_value_option(token) || is_command_global_boolean_option(token) {
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            return Err(commander_unknown_option_error(token));
        }
        unexpected_args += 1;
        index += 1;
    }

    if unexpected_args > 0 {
        return Err(commander_too_many_arguments_error(
            "activity",
            0,
            unexpected_args,
        ));
    }

    Ok(ActivityCommandOptions {
        asset,
        page: parse_positive_int(page.as_deref(), "page", 1)?,
        per_page: parse_positive_int(per_page.as_deref(), "limit", 12)?,
    })
}

fn parse_pools_options(argv: &[String]) -> Result<PoolsCommandOptions, CliError> {
    let mut all_chains = false;
    let mut search = None;
    let mut sort = None;
    let mut unexpected_args = 0;
    let mut index = argv
        .iter()
        .position(|token| token == "pools")
        .map(|value| value + 1)
        .unwrap_or(argv.len());

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            unexpected_args += argv.len().saturating_sub(index + 1);
            break;
        }
        if token == "--all-chains" {
            all_chains = true;
            index += 1;
            continue;
        }
        if token == "--search" {
            search = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--search=") {
            search = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--sort" {
            sort = argv.get(index + 1).cloned();
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--sort=") {
            sort = Some(value.to_string());
            index += 1;
            continue;
        }
        if is_command_global_value_option(token) {
            index += 2;
            continue;
        }
        if is_command_global_inline_value_option(token) || is_command_global_boolean_option(token) {
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            return Err(commander_unknown_option_error(token));
        }
        unexpected_args += 1;
        index += 1;
    }

    if unexpected_args > 0 {
        return Err(commander_too_many_arguments_error(
            "pools",
            1,
            unexpected_args,
        ));
    }

    let sort_value = sort
        .unwrap_or_else(|| "tvl-desc".to_string())
        .to_lowercase();
    let supported = [
        "asset-asc",
        "asset-desc",
        "tvl-desc",
        "tvl-asc",
        "deposits-desc",
        "deposits-asc",
        "chain-asset",
        "default",
    ];
    if !supported.contains(&sort_value.as_str()) {
        return Err(CliError::input(
            format!("Invalid --sort value: {sort_value}."),
            Some(format!("Use one of: {}.", supported.join(", "))),
        ));
    }

    Ok(PoolsCommandOptions {
        all_chains,
        search: search
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        sort: sort_value,
    })
}

fn parse_positive_int(raw: Option<&str>, field_name: &str, fallback: u64) -> Result<u64, CliError> {
    let value = raw.unwrap_or_else(|| if field_name == "page" { "1" } else { "12" });
    let parsed = value
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(0);
    if parsed == 0 {
        return Err(CliError::input(
            format!("Invalid --{field_name} value: {value}."),
            Some(format!("--{field_name} must be a positive integer.")),
        ));
    }
    Ok(if raw.is_some() { parsed } else { fallback })
}

fn resolve_stats_subcommand(parsed: &ParsedRootArgv) -> StatsSubcommand {
    match parsed.non_option_tokens.get(1).map(String::as_str) {
        Some("pool") => StatsSubcommand::Pool,
        Some("global") => StatsSubcommand::Global,
        _ => StatsSubcommand::Default,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatsSubcommand {
    Default,
    Global,
    Pool,
}

fn default_read_only_chains(manifest: &Manifest) -> Vec<ChainDefinition> {
    manifest
        .runtime_config
        .mainnet_chain_names
        .iter()
        .filter_map(|name| manifest.runtime_config.chains.get(name))
        .cloned()
        .map(apply_chain_overrides)
        .collect()
}

fn all_chains_with_overrides(manifest: &Manifest) -> Vec<ChainDefinition> {
    manifest
        .runtime_config
        .chain_names
        .iter()
        .filter_map(|name| manifest.runtime_config.chains.get(name))
        .cloned()
        .map(apply_chain_overrides)
        .collect()
}

fn parse_timeout_ms(argv: &[String]) -> u64 {
    read_long_option_value(argv, "--timeout")
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| (value * 1000.0).round() as u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

fn http_get_json(
    url: &str,
    headers: &[(&str, String)],
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let mut request = ureq::get(url).timeout(Duration::from_millis(timeout_ms));
    for (key, value) in headers {
        request = request.set(key, value);
    }

    let response = request
        .call()
        .map_err(|error| classify_network_error(error, url, ErrorCategory::Asp))?;
    serde_json::from_reader(response.into_reader()).map_err(|error| {
        CliError::unknown(
            format!("Invalid JSON response from {url}: {error}"),
            Some("Retry the command once; if it persists, report the issue.".to_string()),
        )
    })
}

fn js_like_rpc_network_error() -> CliError {
    CliError::rpc_retryable(
        "Network error: fetch failed",
        Some(
            "Check your RPC URL and network connectivity. If using a custom --rpc-url, verify it is reachable."
                .to_string(),
        ),
        Some("RPC_NETWORK_ERROR"),
    )
}

fn http_get_json_with_js_transport_error(
    url: &str,
    headers: &[(&str, String)],
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let mut request = ureq::get(url).timeout(Duration::from_millis(timeout_ms));
    for (key, value) in headers {
        request = request.set(key, value);
    }

    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Transport(_)) => return Err(js_like_rpc_network_error()),
        Err(error) => return Err(classify_network_error(error, url, ErrorCategory::Asp)),
    };

    serde_json::from_reader(response.into_reader()).map_err(|error| {
        CliError::unknown(
            format!("Invalid JSON response from {url}: {error}"),
            Some("Retry the command once; if it persists, report the issue.".to_string()),
        )
    })
}

fn http_post_json(url: &str, body: &Value, timeout_ms: u64) -> Result<Value, CliError> {
    let response = ureq::post(url)
        .timeout(Duration::from_millis(timeout_ms))
        .set("Content-Type", "application/json")
        .send_string(&serde_json::to_string(body).map_err(|error| {
            CliError::unknown(
                format!("Failed to serialize JSON request: {error}"),
                Some("Please report this issue.".to_string()),
            )
        })?)
        .map_err(|error| classify_network_error(error, url, ErrorCategory::Rpc))?;

    serde_json::from_reader(response.into_reader()).map_err(|error| {
        CliError::unknown(
            format!("Invalid JSON response from {url}: {error}"),
            Some("Retry the command once; if it persists, report the issue.".to_string()),
        )
    })
}

fn classify_network_error(error: ureq::Error, url: &str, category: ErrorCategory) -> CliError {
    match error {
        ureq::Error::Status(404, _) if matches!(category, ErrorCategory::Asp) => CliError::asp(
            "ASP service: resource not found.",
            Some("The pool may not be registered yet. Run 'privacy-pools pools' to verify.".to_string()),
            None,
            false,
        ),
        ureq::Error::Status(400, _) if matches!(category, ErrorCategory::Asp) => CliError::asp(
            "ASP service returned an error.",
            Some("Try 'privacy-pools sync' and retry. If it persists, the CLI may be out of date.".to_string()),
            None,
            false,
        ),
        ureq::Error::Status(429, _) | ureq::Error::Status(403, _) if matches!(category, ErrorCategory::Asp) => {
            CliError::asp(
                "ASP service is temporarily rate-limiting requests.",
                Some("Wait a moment and try again.".to_string()),
                None,
                false,
            )
        }
        other => match category {
            ErrorCategory::Asp => CliError::asp(
                "Could not reach the ASP service.".to_string(),
                Some(
                    "Check your network connection. If it persists, the service may be temporarily down."
                        .to_string(),
                ),
                None,
                matches!(other, ureq::Error::Status(code, _) if code >= 500),
            ),
            ErrorCategory::Rpc => CliError::rpc(
                format!("Network error: {url}"),
                Some(
                    "Check your RPC URL and network connectivity. If using a custom --rpc-url, verify it is reachable."
                        .to_string(),
                ),
                Some("RPC_NETWORK_ERROR"),
            ),
            _ => CliError::unknown(
                "Unexpected network failure.",
                Some("Retry the command once; if it persists, report the issue.".to_string()),
            ),
        },
    }
}

fn fetch_pool_events(
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

fn fetch_global_events(
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

fn fetch_global_statistics(chain: &ChainDefinition, timeout_ms: u64) -> Result<Value, CliError> {
    let url = format!("{}/global/public/statistics", chain.asp_host);
    http_get_json_with_js_transport_error(&url, &[], timeout_ms)
}

fn fetch_pool_statistics(
    chain: &ChainDefinition,
    scope: &str,
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let url = format!("{}/{}/public/pool-statistics", chain.asp_host, chain.id);
    http_get_json_with_js_transport_error(&url, &[("X-Pool-Scope", scope.to_string())], timeout_ms)
}

fn fetch_pools_stats(chain: &ChainDefinition, timeout_ms: u64) -> Result<Value, CliError> {
    let url = format!("{}/{}/public/pools-stats", chain.asp_host, chain.id);
    http_get_json(&url, &[], timeout_ms)
}

fn normalize_activity_events(
    events_value: Value,
    fallback_symbol: Option<&str>,
    manifest: &Manifest,
) -> Result<Vec<NormalizedActivityEvent>, CliError> {
    let events = events_value.as_array().cloned().unwrap_or_default();
    events
        .into_iter()
        .map(|event| normalize_activity_event(event, fallback_symbol, manifest))
        .collect()
}

fn normalize_activity_event(
    event: Value,
    fallback_symbol: Option<&str>,
    manifest: &Manifest,
) -> Result<NormalizedActivityEvent, CliError> {
    let pool = event
        .get("pool")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let chain_id = parse_json_u64(pool.get("chainId"));
    let amount_raw = event
        .get("amount")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .or_else(|| {
            event
                .get("publicAmount")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        });
    let symbol = pool
        .get("tokenSymbol")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| fallback_symbol.map(|value| value.to_string()));
    let decimals = parse_json_u64(pool.get("denomination")).unwrap_or(18) as u32;
    let amount_formatted = amount_raw
        .as_deref()
        .and_then(|value| value.parse::<BigUint>().ok())
        .map(|value| format_amount(&value, decimals, symbol.as_deref(), Some(2)))
        .unwrap_or_else(|| amount_raw.clone().unwrap_or_else(|| "-".to_string()));
    let timestamp_ms = event
        .get("timestamp")
        .and_then(json_numberish)
        .map(|value| {
            if value < 1_000_000_000_000f64 {
                (value * 1000.0).floor() as u64
            } else {
                value.floor() as u64
            }
        });
    let tx_hash = event
        .get("txHash")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let pool_address = pool
        .get("poolAddress")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let raw_review_status = extract_public_event_review_status(event.get("reviewStatus"));
    let review_status =
        normalize_public_event_review_status(&event_type, raw_review_status.as_deref());
    let explorer_url = tx_hash
        .as_ref()
        .and_then(|tx_hash| chain_id.and_then(|id| explorer_tx_url(id, tx_hash, manifest)));

    Ok(NormalizedActivityEvent {
        event_type,
        tx_hash,
        explorer_url,
        review_status,
        amount_raw,
        amount_formatted,
        pool_symbol: symbol,
        pool_address,
        chain_id,
        timestamp_ms,
        timestamp_iso: timestamp_ms.map(ms_to_iso_timestamp),
    })
}

fn activity_event_to_json(event: NormalizedActivityEvent) -> Value {
    json!({
        "type": event.event_type,
        "txHash": event.tx_hash,
        "explorerUrl": event.explorer_url,
        "reviewStatus": event.review_status,
        "amountRaw": event.amount_raw,
        "amountFormatted": event.amount_formatted,
        "poolSymbol": event.pool_symbol,
        "poolAddress": event.pool_address,
        "chainId": event.chain_id,
        "timestamp": event.timestamp_iso,
    })
}

fn explorer_tx_url(chain_id: u64, tx_hash: &str, manifest: &Manifest) -> Option<String> {
    manifest
        .runtime_config
        .explorer_urls
        .get(&chain_id)
        .map(|base| format!("{base}/tx/{tx_hash}"))
}

fn extract_public_event_review_status(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(status)) if !status.trim().is_empty() => Some(status.clone()),
        Some(Value::Object(object)) => object
            .get("decisionStatus")
            .and_then(Value::as_str)
            .or_else(|| object.get("reviewStatus").and_then(Value::as_str))
            .or_else(|| object.get("status").and_then(Value::as_str))
            .map(|value| value.to_string())
            .filter(|value| !value.trim().is_empty()),
        _ => None,
    }
}

fn normalize_public_event_review_status(event_type: &str, raw_status: Option<&str>) -> String {
    let normalized_type = event_type.trim().to_lowercase();
    if matches!(normalized_type.as_str(), "withdrawal" | "ragequit" | "exit") {
        return "approved".to_string();
    }

    let normalized = normalize_asp_approval_status(raw_status);
    if normalized != "unknown" {
        return normalized.to_string();
    }

    if raw_status
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        "unknown".to_string()
    } else {
        "pending".to_string()
    }
}

fn normalize_asp_approval_status(raw_status: Option<&str>) -> &'static str {
    match raw_status
        .unwrap_or_default()
        .trim()
        .to_lowercase()
        .as_str()
    {
        "approved" | "accepted" => "approved",
        "pending" => "pending",
        "poi_required" => "poi_required",
        "declined" | "rejected" | "denied" => "declined",
        _ => "unknown",
    }
}

fn json_numberish(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn parse_json_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(json_numberish).and_then(|value| {
        if value.is_finite() && value >= 0.0 {
            Some(value as u64)
        } else {
            None
        }
    })
}

fn ms_to_iso_timestamp(timestamp_ms: u64) -> String {
    let seconds = timestamp_ms / 1000;
    let milliseconds = timestamp_ms % 1000;
    chrono_like_iso(seconds as i64, milliseconds as u32)
}

fn chrono_like_iso(seconds: i64, milliseconds: u32) -> String {
    // Minimal RFC3339 formatter without bringing in chrono.
    let datetime = UNIX_EPOCH + Duration::from_secs(seconds.max(0) as u64);
    let elapsed = datetime
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0));
    let secs = elapsed.as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let seconds_of_day = secs.rem_euclid(86_400);

    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milliseconds:03}Z")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}

fn list_pools_native(
    chain: &ChainDefinition,
    rpc_override: Option<String>,
    config: &CliConfig,
    runtime_config: &RuntimeConfig,
    timeout_ms: u64,
) -> Result<Vec<PoolListingEntry>, CliError> {
    let stats_data = fetch_pools_stats(chain, timeout_ms).map_err(|_| {
        CliError::asp(
            format!("Cannot reach ASP ({}) to discover pools.", chain.asp_host),
            Some("Check your network connection, or try again later.".to_string()),
            None,
            false,
        )
    })?;
    let stats_entries = normalize_pool_stats_entries(&stats_data);
    if stats_entries.is_empty() {
        return Err(CliError::asp(
            format!("Cannot reach ASP ({}) to discover pools.", chain.asp_host),
            Some("Check your network connection, or try again later.".to_string()),
            None,
            false,
        ));
    }

    let rpc_urls = get_rpc_urls(chain.id, rpc_override, config, runtime_config)?;
    let mut entries = vec![];
    let mut rpc_read_failures = 0usize;
    for stats_entry in stats_entries {
        let Some(asset_address) = resolve_pool_asset_address(&stats_entry) else {
            continue;
        };
        let resolved_entry = (|| -> Result<PoolListingEntry, CliError> {
            let asset_config = read_asset_config(chain, &asset_address, &rpc_urls, timeout_ms)?;
            let scope = read_pool_scope(&asset_config.pool_address, &rpc_urls, timeout_ms)?;
            let token_metadata = resolve_token_metadata(
                &asset_address,
                &rpc_urls,
                &runtime_config.native_asset_address,
                timeout_ms,
            );

            Ok(PoolListingEntry {
                chain: chain.name.clone(),
                chain_id: chain.id,
                asset: token_metadata.symbol,
                token_address: asset_address,
                pool: asset_config.pool_address,
                scope,
                decimals: token_metadata.decimals,
                minimum_deposit: asset_config.minimum_deposit_amount,
                vetting_fee_bps: asset_config.vetting_fee_bps,
                max_relay_fee_bps: asset_config.max_relay_fee_bps,
                total_in_pool_value: parse_json_decimal_string(stats_entry.get("totalInPoolValue")),
                total_in_pool_value_usd: parse_json_string(stats_entry.get("totalInPoolValueUsd")),
                total_deposits_value: parse_json_decimal_string(
                    stats_entry.get("totalDepositsValue"),
                ),
                total_deposits_value_usd: parse_json_string(
                    stats_entry.get("totalDepositsValueUsd"),
                ),
                accepted_deposits_value: parse_json_decimal_string(
                    stats_entry.get("acceptedDepositsValue"),
                ),
                accepted_deposits_value_usd: parse_json_string(
                    stats_entry.get("acceptedDepositsValueUsd"),
                ),
                pending_deposits_value: parse_json_decimal_string(
                    stats_entry.get("pendingDepositsValue"),
                ),
                pending_deposits_value_usd: parse_json_string(
                    stats_entry.get("pendingDepositsValueUsd"),
                ),
                total_deposits_count: parse_json_u64(stats_entry.get("totalDepositsCount")),
                accepted_deposits_count: parse_json_u64(stats_entry.get("acceptedDepositsCount")),
                pending_deposits_count: parse_json_u64(stats_entry.get("pendingDepositsCount")),
                growth24h: parse_json_number(stats_entry.get("growth24h")),
                pending_growth24h: parse_json_number(stats_entry.get("pendingGrowth24h")),
            })
        })();

        match resolved_entry {
            Ok(entry) => entries.push(entry),
            Err(error) if matches!(error.category, ErrorCategory::Rpc) => {
                rpc_read_failures += 1;
            }
            Err(error) => return Err(error),
        }
    }

    if entries.is_empty() && rpc_read_failures > 0 {
        return Err(CliError::rpc_retryable(
            format!(
                "Failed to resolve pools on {} due to RPC errors.",
                chain.name
            ),
            Some("Check your RPC URL and network connectivity, then retry.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    Ok(deduplicate_pool_entries(entries))
}

fn normalize_pool_stats_entries(stats_data: &Value) -> Vec<Map<String, Value>> {
    if let Some(array) = stats_data.as_array() {
        return array
            .iter()
            .filter_map(|entry| entry.as_object().cloned())
            .collect();
    }

    if let Some(object) = stats_data.as_object() {
        if let Some(pools) = object.get("pools").and_then(Value::as_array) {
            return pools
                .iter()
                .filter_map(|entry| entry.as_object().cloned())
                .collect();
        }

        return object
            .iter()
            .filter_map(|(key, value)| {
                if key == "pools" {
                    None
                } else {
                    value.as_object().cloned()
                }
            })
            .collect();
    }

    vec![]
}

fn resolve_pool_asset_address(entry: &Map<String, Value>) -> Option<String> {
    entry
        .get("assetAddress")
        .and_then(Value::as_str)
        .or_else(|| entry.get("tokenAddress").and_then(Value::as_str))
        .filter(|value| is_hex_address(value))
        .map(|value| value.to_string())
}

fn parse_json_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(|value| value.to_string())
}

fn parse_json_decimal_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(string)) if is_decimal_string(string) => Some(string.to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        _ => None,
    }
}

fn parse_json_number(value: Option<&Value>) -> Option<f64> {
    value.and_then(json_numberish)
}

fn deduplicate_pool_entries(entries: Vec<PoolListingEntry>) -> Vec<PoolListingEntry> {
    let mut seen = BTreeSet::new();
    let mut deduped = vec![];
    for entry in entries {
        let key = entry.pool.to_lowercase();
        if seen.insert(key) {
            deduped.push(entry);
        }
    }
    deduped
}

fn apply_pool_search(entries: Vec<PoolListingEntry>, query: Option<&str>) -> Vec<PoolListingEntry> {
    let Some(query) = query else {
        return entries;
    };
    let terms = query
        .trim()
        .to_lowercase()
        .split_whitespace()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return entries;
    }

    entries
        .into_iter()
        .filter(|entry| {
            let haystack = format!(
                "{} {} {} {} {} {}",
                entry.chain,
                entry.chain_id,
                entry.asset,
                entry.token_address,
                entry.pool,
                entry.scope
            )
            .to_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        })
        .collect()
}

fn sort_pools(entries: &mut [PoolListingEntry], sort_mode: &str) {
    entries.sort_by(|left, right| {
        let ordering = match sort_mode {
            "asset-asc" => left.asset.cmp(&right.asset),
            "asset-desc" => right.asset.cmp(&left.asset),
            "tvl-desc" => compare_optional_biguint(
                left.total_in_pool_value
                    .as_deref()
                    .or(left.accepted_deposits_value.as_deref()),
                right
                    .total_in_pool_value
                    .as_deref()
                    .or(right.accepted_deposits_value.as_deref()),
                true,
            ),
            "tvl-asc" => compare_optional_biguint(
                left.total_in_pool_value
                    .as_deref()
                    .or(left.accepted_deposits_value.as_deref()),
                right
                    .total_in_pool_value
                    .as_deref()
                    .or(right.accepted_deposits_value.as_deref()),
                false,
            ),
            "deposits-desc" => right.total_deposits_count.cmp(&left.total_deposits_count),
            "deposits-asc" => left.total_deposits_count.cmp(&right.total_deposits_count),
            "chain-asset" => left
                .chain
                .cmp(&right.chain)
                .then(left.asset.cmp(&right.asset)),
            _ => std::cmp::Ordering::Equal,
        };

        if ordering != std::cmp::Ordering::Equal {
            ordering
        } else {
            left.chain
                .cmp(&right.chain)
                .then(left.asset.cmp(&right.asset))
                .then(left.pool.cmp(&right.pool))
        }
    });
}

fn compare_optional_biguint(
    left: Option<&str>,
    right: Option<&str>,
    descending: bool,
) -> std::cmp::Ordering {
    let left_value = left.and_then(parse_biguint).unwrap_or_else(BigUint::zero);
    let right_value = right.and_then(parse_biguint).unwrap_or_else(BigUint::zero);
    if descending {
        right_value.cmp(&left_value)
    } else {
        left_value.cmp(&right_value)
    }
}

fn pool_entry_to_json(entry: &PoolListingEntry, include_chain: bool) -> Value {
    let mut object = Map::new();
    if include_chain {
        object.insert("chain".to_string(), Value::String(entry.chain.clone()));
    }
    object.insert("asset".to_string(), Value::String(entry.asset.clone()));
    object.insert(
        "tokenAddress".to_string(),
        Value::String(entry.token_address.clone()),
    );
    object.insert("pool".to_string(), Value::String(entry.pool.clone()));
    object.insert("scope".to_string(), Value::String(entry.scope.clone()));
    object.insert("decimals".to_string(), Value::Number(entry.decimals.into()));
    object.insert(
        "minimumDeposit".to_string(),
        Value::String(entry.minimum_deposit.clone()),
    );
    object.insert(
        "vettingFeeBPS".to_string(),
        Value::String(entry.vetting_fee_bps.clone()),
    );
    object.insert(
        "maxRelayFeeBPS".to_string(),
        Value::String(entry.max_relay_fee_bps.clone()),
    );
    insert_optional_string(
        &mut object,
        "totalInPoolValue",
        entry.total_in_pool_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalInPoolValueUsd",
        entry.total_in_pool_value_usd.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalDepositsValue",
        entry.total_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "totalDepositsValueUsd",
        entry.total_deposits_value_usd.clone(),
    );
    insert_optional_string(
        &mut object,
        "acceptedDepositsValue",
        entry.accepted_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "acceptedDepositsValueUsd",
        entry.accepted_deposits_value_usd.clone(),
    );
    insert_optional_string(
        &mut object,
        "pendingDepositsValue",
        entry.pending_deposits_value.clone(),
    );
    insert_optional_string(
        &mut object,
        "pendingDepositsValueUsd",
        entry.pending_deposits_value_usd.clone(),
    );
    insert_optional_u64(
        &mut object,
        "totalDepositsCount",
        entry.total_deposits_count,
    );
    insert_optional_u64(
        &mut object,
        "acceptedDepositsCount",
        entry.accepted_deposits_count,
    );
    insert_optional_u64(
        &mut object,
        "pendingDepositsCount",
        entry.pending_deposits_count,
    );
    insert_optional_f64(&mut object, "growth24h", entry.growth24h);
    insert_optional_f64(&mut object, "pendingGrowth24h", entry.pending_growth24h);
    Value::Object(object)
}

fn pool_warning_to_json(warning: PoolWarning) -> Value {
    json!({
        "chain": warning.chain,
        "category": warning.category,
        "message": warning.message,
    })
}

fn chain_summary_to_json(summary: ChainSummary) -> Value {
    json!({
        "chain": summary.chain,
        "pools": summary.pools,
        "error": summary.error,
    })
}

fn render_activity_output(mode: &NativeMode, data: ActivityRenderData) {
    if mode.is_json() {
        let mut payload = Map::new();
        payload.insert("mode".to_string(), Value::String(data.mode.to_string()));
        payload.insert("chain".to_string(), Value::String(data.chain.clone()));
        if let Some(chains) = data.chains {
            payload.insert(
                "chains".to_string(),
                Value::Array(chains.into_iter().map(Value::String).collect::<Vec<_>>()),
            );
        }
        payload.insert("page".to_string(), Value::Number(data.page.into()));
        payload.insert("perPage".to_string(), Value::Number(data.per_page.into()));
        insert_optional_u64(&mut payload, "total", data.total);
        insert_optional_u64(&mut payload, "totalPages", data.total_pages);
        payload.insert(
            "events".to_string(),
            Value::Array(
                data.events
                    .into_iter()
                    .map(activity_event_to_json)
                    .collect::<Vec<_>>(),
            ),
        );
        if data.mode == "pool-activity" {
            insert_optional_string(&mut payload, "asset", data.asset);
            insert_optional_string(&mut payload, "pool", data.pool);
            insert_optional_string(&mut payload, "scope", data.scope);
        }
        if data.chain_filtered {
            payload.insert("chainFiltered".to_string(), Value::Bool(true));
            payload.insert(
                "note".to_string(),
                Value::String(
                    "Pagination totals are unavailable when filtering by chain. Results may be sparse."
                        .to_string(),
                ),
            );
        }
        print_json_success(Value::Object(payload));
        return;
    }

    if mode.is_csv() {
        let mut rows = Vec::<Vec<String>>::new();
        for event in &data.events {
            rows.push(vec![
                event.event_type.clone(),
                activity_pool_label(event),
                event.amount_formatted.clone(),
                event.review_status.clone(),
                format_time_ago(event.timestamp_ms),
                event
                    .tx_hash
                    .as_deref()
                    .map(|tx| format_address(tx, 8))
                    .unwrap_or_else(|| "-".to_string()),
            ]);
        }
        print_csv(vec!["Type", "Pool", "Amount", "Status", "Time", "Tx"], rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    if data.mode == "pool-activity" {
        write_stderr_text(&format!(
            "\nActivity for {} on {}:\n\n",
            data.asset.as_deref().unwrap_or("unknown"),
            data.chain
        ));
    } else {
        let chain_label = data
            .chains
            .as_ref()
            .map(|chains| chains.join(", "))
            .unwrap_or_else(|| data.chain.clone());
        write_stderr_text(&format!("\nGlobal activity ({chain_label}):\n\n"));
    }

    if data.events.is_empty() {
        write_stderr_text("No activity found.");
        return;
    }

    let rows = data
        .events
        .iter()
        .map(|event| {
            vec![
                event.event_type.clone(),
                activity_pool_label(event),
                event.amount_formatted.clone(),
                format_asp_approval_status_label(&event.review_status),
                format_time_ago(event.timestamp_ms),
                event
                    .tx_hash
                    .as_deref()
                    .map(|tx| format_address(tx, 8))
                    .unwrap_or_else(|| "-".to_string()),
            ]
        })
        .collect::<Vec<_>>();
    print_table(vec!["Type", "Pool", "Amount", "Status", "Time", "Tx"], rows);

    if let Some(total_pages) = data.total_pages {
        if total_pages > 1 {
            let total_suffix = data
                .total
                .map(|total| format!(" ({total} events)"))
                .unwrap_or_default();
            let next_suffix = if data.page < total_pages {
                format!(". Next: --page {}", data.page + 1)
            } else {
                String::new()
            };
            write_stderr_text(&format!(
                "\n  Page {} of {}{}{}\n",
                data.page, total_pages, total_suffix, next_suffix
            ));
        }
    }

    if data.chain_filtered {
        write_stderr_text(&format!(
            "\n  Note: Results filtered to {}. Some pages may be sparse.\n",
            data.chain
        ));
    }
}

fn render_global_stats_output(mode: &NativeMode, data: GlobalStatsRenderData) {
    if mode.is_json() {
        print_json_success(json!({
            "mode": "global-stats",
            "chain": data.chain,
            "chains": data.chains,
            "cacheTimestamp": data.cache_timestamp,
            "allTime": data.all_time,
            "last24h": data.last_24h,
        }));
        return;
    }

    let rows = stats_rows(&data.all_time, &data.last_24h);
    if mode.is_csv() {
        print_csv(vec!["Metric", "All Time", "Last 24h"], rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    write_stderr_text(&format!("\nGlobal statistics ({}):\n\n", data.chain));
    print_table(vec!["Metric", "All Time", "Last 24h"], rows);
}

fn render_pool_stats_output(mode: &NativeMode, data: PoolStatsRenderData) {
    if mode.is_json() {
        print_json_success(json!({
            "mode": "pool-stats",
            "chain": data.chain,
            "asset": data.asset,
            "pool": data.pool,
            "scope": data.scope,
            "cacheTimestamp": data.cache_timestamp,
            "allTime": data.all_time,
            "last24h": data.last_24h,
        }));
        return;
    }

    let rows = stats_rows(&data.all_time, &data.last_24h);
    if mode.is_csv() {
        print_csv(vec!["Metric", "All Time", "Last 24h"], rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    write_stderr_text(&format!(
        "\nPool statistics for {} on {}:\n\n",
        data.asset, data.chain
    ));
    print_table(vec!["Metric", "All Time", "Last 24h"], rows);
}

fn render_pools_empty_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        if data.all_chains {
            print_json_success(json!({
                "allChains": true,
                "search": data.search,
                "sort": data.sort,
                "pools": [],
            }));
        } else {
            print_json_success(json!({
                "chain": data.chain_name,
                "search": data.search,
                "sort": data.sort,
                "pools": [],
            }));
        }
        return;
    }

    if mode.is_csv() {
        print_csv(
            vec![
                "Chain",
                "Asset",
                "Total Deposits",
                "Pool Balance",
                "USD Value",
                "Pending",
                "Min Deposit",
                "Vetting Fee",
            ],
            vec![],
        );
        return;
    }

    if mode.is_quiet {
        return;
    }

    if data.all_chains {
        write_info("No pools found across supported chains.");
    } else {
        write_info(&format!("No pools found on {}.", data.chain_name));
    }
}

fn render_pools_output(mode: &NativeMode, data: PoolsRenderData) {
    if mode.is_json() {
        if data.all_chains {
            print_json_success(json!({
                "allChains": true,
                "search": data.search,
                "sort": data.sort,
                "chains": data
                    .chain_summaries
                    .unwrap_or_default()
                    .into_iter()
                    .map(chain_summary_to_json)
                    .collect::<Vec<_>>(),
                "pools": data
                    .filtered_pools
                    .iter()
                    .map(|entry| pool_entry_to_json(entry, true))
                    .collect::<Vec<_>>(),
                "warnings": if data.warnings.is_empty() {
                    Value::Null
                } else {
                    Value::Array(
                        data.warnings
                            .into_iter()
                            .map(pool_warning_to_json)
                            .collect::<Vec<_>>(),
                    )
                },
            }));
        } else {
            print_json_success(json!({
                "chain": data.chain_name,
                "search": data.search,
                "sort": data.sort,
                "pools": data
                    .filtered_pools
                    .iter()
                    .map(|entry| pool_entry_to_json(entry, false))
                    .collect::<Vec<_>>(),
            }));
        }
        return;
    }

    if mode.is_csv() {
        let headers = if data.all_chains {
            vec![
                "Chain",
                "Asset",
                "Total Deposits",
                "Pool Balance",
                "USD Value",
                "Pending",
                "Min Deposit",
                "Vetting Fee",
            ]
        } else {
            vec![
                "Asset",
                "Total Deposits",
                "Pool Balance",
                "USD Value",
                "Pending",
                "Min Deposit",
                "Vetting Fee",
            ]
        };
        let rows = data
            .filtered_pools
            .iter()
            .map(|entry| pool_listing_row(entry, data.all_chains))
            .collect::<Vec<_>>();
        print_csv(headers, rows);
        return;
    }

    if mode.is_quiet {
        return;
    }

    if data.all_chains {
        write_stderr_text("\nPools across supported chains:\n\n");
    } else {
        write_stderr_text(&format!("\nPools on {}:\n\n", data.chain_name));
    }

    for warning in &data.warnings {
        write_warn(&format!(
            "{} ({}): {}",
            warning.chain, warning.category, warning.message
        ));
    }
    if !data.warnings.is_empty() {
        write_stderr_text("");
    }

    if data.filtered_pools.is_empty() {
        if let Some(search) = data.search {
            if !search.is_empty() {
                write_info(&format!("No pools matched search query \"{search}\"."));
                return;
            }
        }
        write_info("No pools found.");
        return;
    }

    let headers = if data.all_chains {
        vec![
            "Chain",
            "Asset",
            "Total Deposits",
            "Pool Balance",
            "USD Value",
            "Pending",
            "Min Deposit",
            "Vetting Fee",
        ]
    } else {
        vec![
            "Asset",
            "Total Deposits",
            "Pool Balance",
            "USD Value",
            "Pending",
            "Min Deposit",
            "Vetting Fee",
        ]
    };
    let rows = data
        .filtered_pools
        .iter()
        .map(|entry| pool_listing_row(entry, data.all_chains))
        .collect::<Vec<_>>();
    print_table(headers, rows);
    write_stderr_text(
        "\nVetting fees are deducted on deposit.\nPool Balance: current total value in the pool (accepted + pending deposits).\nPending: deposits not yet accepted (pending ASP review or declined deposits).\n",
    );
}

fn stats_rows(all_time: &Value, last_24h: &Value) -> Vec<Vec<String>> {
    vec![
        vec![
            "Current TVL".to_string(),
            parse_usd_value(all_time.get("tvlUsd")),
            parse_usd_value(last_24h.get("tvlUsd")),
        ],
        vec![
            "Avg Deposit Size".to_string(),
            parse_usd_value(all_time.get("avgDepositSizeUsd")),
            parse_usd_value(last_24h.get("avgDepositSizeUsd")),
        ],
        vec![
            "Total Deposits".to_string(),
            parse_count_value(all_time.get("totalDepositsCount")),
            parse_count_value(last_24h.get("totalDepositsCount")),
        ],
        vec![
            "Total Withdrawals".to_string(),
            parse_count_value(all_time.get("totalWithdrawalsCount")),
            parse_count_value(last_24h.get("totalWithdrawalsCount")),
        ],
    ]
}

fn activity_pool_label(event: &NormalizedActivityEvent) -> String {
    match (&event.pool_symbol, event.chain_id) {
        (Some(symbol), Some(chain_id)) => format!("{symbol}@{chain_id}"),
        (Some(symbol), None) => symbol.clone(),
        (None, Some(chain_id)) => format!("chain-{chain_id}"),
        (None, None) => "-".to_string(),
    }
}

fn pool_listing_row(entry: &PoolListingEntry, include_chain: bool) -> Vec<String> {
    let mut row = Vec::new();
    if include_chain {
        row.push(entry.chain.clone());
    }
    row.push(entry.asset.clone());
    row.push(format_pool_deposits_count(entry));
    row.push(format_pool_stat_amount(
        entry
            .total_in_pool_value
            .as_deref()
            .or(entry.accepted_deposits_value.as_deref()),
        entry.decimals,
        &entry.asset,
    ));
    row.push(parse_usd_string(
        entry
            .total_in_pool_value_usd
            .as_deref()
            .or(entry.accepted_deposits_value_usd.as_deref()),
    ));
    row.push(format_pool_stat_amount(
        entry.pending_deposits_value.as_deref(),
        entry.decimals,
        &entry.asset,
    ));
    row.push(format_pool_minimum_deposit(entry));
    row.push(format_bps_value(&entry.vetting_fee_bps));
    row
}

fn format_pool_deposits_count(entry: &PoolListingEntry) -> String {
    entry
        .total_deposits_count
        .map(format_count_number)
        .unwrap_or_else(|| "-".to_string())
}

fn format_pool_stat_amount(value: Option<&str>, decimals: u32, symbol: &str) -> String {
    value
        .and_then(parse_biguint)
        .map(|value| format_amount(&value, decimals, Some(symbol), Some(2)))
        .unwrap_or_else(|| "-".to_string())
}

fn format_pool_minimum_deposit(entry: &PoolListingEntry) -> String {
    parse_biguint(&entry.minimum_deposit)
        .map(|value| format_amount(&value, entry.decimals, Some(&entry.asset), Some(2)))
        .unwrap_or_else(|| entry.minimum_deposit.clone())
}

fn format_bps_value(value: &str) -> String {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .map(|bps| format!("{:.2}%", bps / 100.0))
        .unwrap_or_else(|| value.to_string())
}

fn format_asp_approval_status_label(status: &str) -> String {
    match status.trim().to_lowercase().as_str() {
        "approved" => "Approved".to_string(),
        "pending" => "Pending".to_string(),
        "poi_required" => "PoA Needed".to_string(),
        "declined" => "Declined".to_string(),
        _ => "Unknown".to_string(),
    }
}

fn parse_usd_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(raw)) if !raw.trim().is_empty() => raw
            .replace(',', "")
            .parse::<f64>()
            .ok()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format!("${}", format_count_number(parsed.trunc() as u64)))
            .unwrap_or_else(|| "-".to_string()),
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format!("${}", format_count_number(parsed.trunc() as u64)))
            .unwrap_or_else(|| "-".to_string()),
        _ => "-".to_string(),
    }
}

fn parse_usd_string(value: Option<&str>) -> String {
    match value {
        Some(raw) if !raw.trim().is_empty() => raw
            .replace(',', "")
            .parse::<f64>()
            .ok()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format!("${}", format_count_number(parsed.trunc() as u64)))
            .unwrap_or_else(|| "-".to_string()),
        _ => "-".to_string(),
    }
}

fn parse_count_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::Number(number)) => number
            .as_u64()
            .map(format_count_number)
            .unwrap_or_else(|| "-".to_string()),
        Some(Value::String(raw)) if !raw.trim().is_empty() => raw
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|parsed| parsed.is_finite())
            .map(|parsed| format_count_number(parsed.trunc() as u64))
            .unwrap_or_else(|| "-".to_string()),
        _ => "-".to_string(),
    }
}

fn format_count_number(value: u64) -> String {
    let digits = value.to_string();
    let mut output = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, character) in digits.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            output.push(',');
        }
        output.push(character);
    }
    output.chars().rev().collect()
}

fn format_address(value: &str, chars: usize) -> String {
    if value.chars().count() <= chars * 2 + 2 {
        return value.to_string();
    }
    let prefix = value.chars().take(chars + 2).collect::<String>();
    let suffix = value
        .chars()
        .rev()
        .take(chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("{prefix}...{suffix}")
}

fn format_time_ago(timestamp_ms: Option<u64>) -> String {
    let Some(timestamp_ms) = timestamp_ms else {
        return "-".to_string();
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64;
    let delta_ms = now_ms.saturating_sub(timestamp_ms);
    let seconds = delta_ms / 1000;
    if seconds < 60 {
        return format!("{seconds}s ago");
    }
    let minutes = seconds / 60;
    if minutes < 60 {
        return format!("{minutes}m ago");
    }
    let hours = minutes / 60;
    if hours < 24 {
        return format!("{hours}h ago");
    }
    let days = hours / 24;
    format!("{days}d ago")
}

fn print_csv(headers: Vec<&str>, rows: Vec<Vec<String>>) {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        headers
            .into_iter()
            .map(escape_csv_field)
            .collect::<Vec<_>>()
            .join(","),
    );
    for row in rows {
        lines.push(
            row.iter()
                .map(|cell| escape_csv_field(cell))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    write_stdout_text(&lines.join("\n"));
}

fn escape_csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn print_table(headers: Vec<&str>, rows: Vec<Vec<String>>) {
    let headers = headers
        .into_iter()
        .map(|header| header.to_string())
        .collect::<Vec<_>>();
    let mut widths = headers
        .iter()
        .map(|header| header.chars().count())
        .collect::<Vec<_>>();
    for row in &rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(cell.chars().count());
        }
    }

    let top = table_border('┌', '┬', '┐', &widths);
    let middle = table_border('├', '┼', '┤', &widths);
    let bottom = table_border('└', '┴', '┘', &widths);
    let header_row = table_row(&headers, &widths);

    let mut output = String::new();
    output.push_str(&top);
    output.push('\n');
    output.push_str(&header_row);
    output.push('\n');
    output.push_str(&middle);
    if rows.is_empty() {
        output.push('\n');
        output.push_str(&bottom);
        write_stderr_text(&output);
        return;
    }

    output.push('\n');
    for (index, row) in rows.iter().enumerate() {
        output.push_str(&table_row(row, &widths));
        if index + 1 < rows.len() {
            output.push('\n');
            output.push_str(&middle);
            output.push('\n');
        } else {
            output.push('\n');
        }
    }
    output.push_str(&bottom);
    write_stderr_text(&output);
}

fn table_border(left: char, middle: char, right: char, widths: &[usize]) -> String {
    let segments = widths
        .iter()
        .map(|width| "─".repeat(width + 2))
        .collect::<Vec<_>>();
    format!("{left}{}{right}", segments.join(&middle.to_string()))
}

fn table_row(row: &[String], widths: &[usize]) -> String {
    let cells = row
        .iter()
        .enumerate()
        .map(|(index, cell)| {
            let padding = widths[index].saturating_sub(cell.chars().count());
            format!(" {}{} ", cell, " ".repeat(padding))
        })
        .collect::<Vec<_>>();
    format!("│{}│", cells.join("│"))
}

fn write_info(message: &str) {
    write_stderr_text(&format!("ℹ {message}"));
}

fn write_warn(message: &str) {
    write_stderr_text(&format!("⚠ {message}"));
}

fn insert_optional_string(object: &mut Map<String, Value>, key: &str, value: Option<String>) {
    object.insert(
        key.to_string(),
        value.map(Value::String).unwrap_or(Value::Null),
    );
}

fn insert_optional_u64(object: &mut Map<String, Value>, key: &str, value: Option<u64>) {
    object.insert(
        key.to_string(),
        value
            .map(|value| Value::Number(value.into()))
            .unwrap_or(Value::Null),
    );
}

fn insert_optional_f64(object: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    object.insert(
        key.to_string(),
        value
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
    );
}

#[derive(Debug, Clone)]
struct AssetConfigResult {
    pool_address: String,
    minimum_deposit_amount: String,
    vetting_fee_bps: String,
    max_relay_fee_bps: String,
}

#[derive(Debug, Clone)]
struct TokenMetadataResult {
    symbol: String,
    decimals: u32,
}

fn read_asset_config(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    timeout_ms: u64,
) -> Result<AssetConfigResult, CliError> {
    let selector = function_selector("assetConfig(address)");
    let data = format!(
        "0x{}{}",
        hex::encode(selector),
        encode_address_word(asset_address)?
    );
    let response = rpc_call(rpc_urls, &chain.entrypoint, &data, timeout_ms)?;
    let words = decode_abi_words(&response)?;
    if words.len() < 4 {
        return Err(CliError::rpc(
            "Malformed RPC response while resolving pool asset config.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    Ok(AssetConfigResult {
        pool_address: checksum_address(&decode_address_word(&words[0])?)?,
        minimum_deposit_amount: decode_uint256_word(&words[1]).to_string(),
        vetting_fee_bps: decode_uint256_word(&words[2]).to_string(),
        max_relay_fee_bps: decode_uint256_word(&words[3]).to_string(),
    })
}

fn read_pool_scope(
    pool_address: &str,
    rpc_urls: &[String],
    timeout_ms: u64,
) -> Result<String, CliError> {
    let selector = function_selector("SCOPE()");
    let data = format!("0x{}", hex::encode(selector));
    let response = rpc_call(rpc_urls, pool_address, &data, timeout_ms)?;
    let words = decode_abi_words(&response)?;
    let first = words.first().ok_or_else(|| {
        CliError::rpc(
            "Malformed RPC response while resolving pool scope.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    Ok(decode_uint256_word(first).to_string())
}

fn resolve_token_metadata(
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> TokenMetadataResult {
    if asset_address.eq_ignore_ascii_case(native_asset_address) {
        return TokenMetadataResult {
            symbol: "ETH".to_string(),
            decimals: 18,
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

    TokenMetadataResult {
        symbol: symbol_result.unwrap_or_else(|| "???".to_string()),
        decimals: decimals_result.unwrap_or(18),
    }
}

fn rpc_call(
    rpc_urls: &[String],
    to: &str,
    data: &str,
    timeout_ms: u64,
) -> Result<String, CliError> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [
            {
                "to": to,
                "data": data,
            },
            "latest"
        ]
    });

    let mut last_error = None;
    for rpc_url in rpc_urls {
        match http_post_json(rpc_url, &body, timeout_ms) {
            Ok(response) => {
                if let Some(result) = response.get("result").and_then(Value::as_str) {
                    return Ok(result.to_string());
                }

                if let Some(error_message) = response
                    .get("error")
                    .and_then(Value::as_object)
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                {
                    last_error = Some(CliError::rpc(
                        format!("RPC error: {error_message}"),
                        Some("Check your RPC connection and try again.".to_string()),
                        None,
                    ));
                    continue;
                }
            }
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        CliError::rpc(
            "RPC pool resolution failed.",
            Some("Check your RPC connection and try again.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    }))
}

fn function_selector(signature: &str) -> [u8; 4] {
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(signature.as_bytes());
    keccak.finalize(&mut hash);
    [hash[0], hash[1], hash[2], hash[3]]
}

fn encode_address_word(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::input(
            format!("Invalid asset address: {address}."),
            Some("Use a 0x-prefixed 20-byte address.".to_string()),
        ));
    }
    Ok(format!("{:0>64}", normalized.to_lowercase()))
}

fn decode_abi_words(hex_data: &str) -> Result<Vec<String>, CliError> {
    let normalized = hex_data.strip_prefix("0x").unwrap_or(hex_data);
    if normalized.is_empty() {
        return Ok(vec![]);
    }
    if !normalized.len().is_multiple_of(64) {
        return Err(CliError::rpc(
            "Malformed ABI response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(normalized
        .as_bytes()
        .chunks(64)
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect())
}

fn decode_uint256_word(word: &str) -> BigUint {
    BigUint::parse_bytes(word.as_bytes(), 16).unwrap_or_else(BigUint::zero)
}

fn decode_address_word(word: &str) -> Result<String, CliError> {
    if word.len() != 64 {
        return Err(CliError::rpc(
            "Malformed ABI address response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(format!("0x{}", &word[24..]))
}

fn checksum_address(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::rpc(
            "Malformed address returned from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let lowercase = normalized.to_lowercase();
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(lowercase.as_bytes());
    keccak.finalize(&mut hash);
    let hash_hex = hex::encode(hash);
    let mut checksummed = String::from("0x");
    for (index, character) in lowercase.chars().enumerate() {
        let nibble = u8::from_str_radix(&hash_hex[index..index + 1], 16).unwrap_or(0);
        if character.is_ascii_alphabetic() && nibble >= 8 {
            checksummed.push(character.to_ascii_uppercase());
        } else {
            checksummed.push(character);
        }
    }
    Ok(checksummed)
}

fn decode_abi_string(hex_data: &str) -> Result<String, CliError> {
    let words = decode_abi_words(hex_data)?;
    if words.len() < 2 {
        return Err(CliError::rpc(
            "Malformed ABI string response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let offset = decode_uint256_word(&words[0]).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string offset from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    if offset % 32 != 0 {
        return Err(CliError::rpc(
            "Invalid ABI string offset alignment from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    let index = offset / 32;
    let length_word = words.get(index).ok_or_else(|| {
        CliError::rpc(
            "Malformed ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    let length = decode_uint256_word(length_word).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;

    let mut bytes = vec![];
    let required_words = length.div_ceil(32);
    for word_index in 0..required_words {
        let word = words.get(index + 1 + word_index).ok_or_else(|| {
            CliError::rpc(
                "Malformed ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        let decoded = hex::decode(word).map_err(|_| {
            CliError::rpc(
                "Invalid ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        bytes.extend(decoded);
    }
    bytes.truncate(length);
    String::from_utf8(bytes).map_err(|_| {
        CliError::rpc(
            "ABI string payload was not valid UTF-8.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })
}

fn is_hex_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].chars().all(|char| char.is_ascii_hexdigit())
}

fn is_decimal_string(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|char| char.is_ascii_digit())
}

fn parse_biguint(value: &str) -> Option<BigUint> {
    if value.is_empty() {
        return None;
    }
    if value.starts_with("0x") {
        BigUint::parse_bytes(value.trim_start_matches("0x").as_bytes(), 16)
    } else {
        BigUint::parse_bytes(value.as_bytes(), 10)
    }
}

fn format_amount(
    value: &BigUint,
    decimals: u32,
    symbol: Option<&str>,
    max_decimals: Option<usize>,
) -> String {
    let mut digits = value.to_string();
    let decimals = decimals as usize;
    let formatted = if decimals == 0 {
        digits
    } else if digits.len() <= decimals {
        let padding = "0".repeat(decimals + 1 - digits.len());
        digits = format!("{padding}{digits}");
        format!(
            "{}.{}",
            &digits[..digits.len() - decimals],
            &digits[digits.len() - decimals..]
        )
    } else {
        format!(
            "{}.{}",
            &digits[..digits.len() - decimals],
            &digits[digits.len() - decimals..]
        )
    };

    let formatted = truncate_decimals(&formatted, max_decimals.unwrap_or(decimals));
    match symbol {
        Some(symbol) => format!("{formatted} {symbol}"),
        None => formatted,
    }
}

fn truncate_decimals(value: &str, max: usize) -> String {
    let Some(dot_index) = value.find('.') else {
        return value.to_string();
    };
    let int_part = &value[..dot_index];
    let dec_part = &value[dot_index + 1..];
    if dec_part.len() <= max {
        let trimmed = dec_part.trim_end_matches('0');
        return if trimmed.is_empty() {
            int_part.to_string()
        } else {
            format!("{int_part}.{trimmed}")
        };
    }

    let mut digits = max;
    if int_part == "0" && dec_part[..max].chars().all(|char| char == '0') {
        if let Some(first_sig) = dec_part.find(|char| char != '0') {
            if first_sig >= max {
                digits = first_sig + 1;
            }
        }
    }

    let truncated = &dec_part[..digits];
    let trimmed = truncated.trim_end_matches('0');
    if trimmed.is_empty() {
        int_part.to_string()
    } else {
        format!("{int_part}.{trimmed}")
    }
}

fn resolve_pool_native(
    chain: &ChainDefinition,
    asset: &str,
    rpc_override: Option<String>,
    config: &CliConfig,
    manifest: &Manifest,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    let rpc_urls = get_rpc_urls(
        chain.id,
        rpc_override.clone(),
        config,
        &manifest.runtime_config,
    )?;
    if is_hex_address(asset) {
        return resolve_pool_from_asset_address_native(
            chain,
            asset,
            &rpc_urls,
            &manifest.runtime_config.native_asset_address,
            timeout_ms,
        )
        .map_err(|error| {
            if matches!(error.category, ErrorCategory::Rpc) {
                return CliError::rpc_retryable(
                    format!(
                        "Failed to resolve pool for {asset} on {} due to RPC error.",
                        chain.name
                    ),
                    Some("Check your RPC URL and network connectivity, then retry.".to_string()),
                    Some("RPC_POOL_RESOLUTION_FAILED"),
                );
            }
            error
        });
    }

    let normalized = asset.to_uppercase();
    let mut available_assets_hint: Option<String> = None;
    let mut asp_lookup_failed = false;

    match list_pools_native(
        chain,
        rpc_override.clone(),
        config,
        &manifest.runtime_config,
        timeout_ms,
    ) {
        Ok(entries) => {
            if let Some(entry) = entries
                .iter()
                .find(|entry| entry.asset.eq_ignore_ascii_case(&normalized))
            {
                return Ok(pool_listing_entry_to_resolution(entry));
            }

            let available_assets = entries
                .iter()
                .map(|entry| entry.asset.clone())
                .collect::<Vec<_>>();
            if !available_assets.is_empty() {
                available_assets_hint = Some(available_assets.join(", "));
            }
        }
        Err(error) => {
            if !matches!(error.category, ErrorCategory::Asp) {
                return Err(error);
            }
            asp_lookup_failed = true;
        }
    }

    let Some(known_asset_address) = manifest
        .runtime_config
        .known_pools
        .get(&chain.id)
        .and_then(|pools| pools.get(&normalized))
        .cloned()
    else {
        return Err(CliError::input(
            format!("No pool found for asset \"{asset}\" on {}.", chain.name),
            Some(if asp_lookup_failed {
                "The ASP may be offline. Try using --asset with a token contract address (0x...)."
                    .to_string()
            } else if let Some(hint) = available_assets_hint {
                format!("Available assets: {hint}")
            } else {
                "No pools found. Try using --asset with a contract address.".to_string()
            }),
        ));
    };

    resolve_pool_from_asset_address_native(
        chain,
        &known_asset_address,
        &rpc_urls,
        &manifest.runtime_config.native_asset_address,
        timeout_ms,
    )
    .map_err(|error| {
        if matches!(error.category, ErrorCategory::Rpc) {
            return CliError::rpc_retryable(
                format!(
                    "Built-in pool fallback also failed for \"{asset}\" on {}.",
                    chain.name
                ),
                Some("Check your RPC URL and network connectivity, then retry.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            );
        }
        error
    })
}

fn resolve_pool_from_asset_address_native(
    chain: &ChainDefinition,
    asset_address: &str,
    rpc_urls: &[String],
    native_asset_address: &str,
    timeout_ms: u64,
) -> Result<NativePoolResolution, CliError> {
    let asset_config = read_asset_config(chain, asset_address, rpc_urls, timeout_ms)?;
    let scope = read_pool_scope(&asset_config.pool_address, rpc_urls, timeout_ms)?;
    let token_metadata =
        resolve_token_metadata(asset_address, rpc_urls, native_asset_address, timeout_ms);

    Ok(NativePoolResolution {
        symbol: token_metadata.symbol,
        pool_address: asset_config.pool_address,
        scope,
    })
}

fn pool_listing_entry_to_resolution(entry: &PoolListingEntry) -> NativePoolResolution {
    NativePoolResolution {
        symbol: entry.asset.clone(),
        pool_address: entry.pool.clone(),
        scope: entry.scope.clone(),
    }
}

fn exit_code_from_status(status: std::process::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return match signal {
                2 => 130,
                15 => 143,
                value => 128 + value,
            };
        }
    }

    1
}
