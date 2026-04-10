use crate::contract::Manifest;
use crate::root_argv::{all_non_option_tokens, ParsedRootArgv};

#[derive(Debug, Clone)]
pub(crate) struct NativeMode {
    pub(crate) format: OutputFormat,
    pub(crate) is_quiet: bool,
}

impl NativeMode {
    pub(crate) fn is_json(&self) -> bool {
        matches!(self.format, OutputFormat::Json)
    }

    pub(crate) fn is_csv(&self) -> bool {
        matches!(self.format, OutputFormat::Csv)
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum OutputFormat {
    Table,
    Csv,
    Json,
}

pub(crate) fn resolve_mode(parsed: &ParsedRootArgv) -> NativeMode {
    let format = if parsed.is_csv_mode {
        OutputFormat::Csv
    } else if parsed.is_structured_output_mode {
        OutputFormat::Json
    } else {
        OutputFormat::Table
    };

    NativeMode {
        format,
        is_quiet: parsed.is_quiet || parsed.is_agent,
    }
}

pub(crate) fn is_static_quiet_mode(parsed: &ParsedRootArgv) -> bool {
    let mode = resolve_mode(parsed);
    mode.is_quiet || mode.is_json() || mode.is_csv()
}

fn should_handle_native_pools(argv: &[String]) -> bool {
    let non_option_tokens = all_non_option_tokens(argv);
    matches!(non_option_tokens.first().map(String::as_str), Some("pools"))
}

pub(crate) fn activity_native_mode(
    _argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Option<&'static str> {
    if parsed.is_help_like {
        return None;
    }
    let native_mode = match resolve_mode(parsed).format {
        OutputFormat::Json => "structured",
        OutputFormat::Csv => "csv",
        OutputFormat::Table => "default",
    };
    manifest_allows_native_mode("activity", native_mode, manifest).then_some(native_mode)
}

pub(crate) fn pools_native_mode(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Option<&'static str> {
    if parsed.is_help_like || !should_handle_native_pools(argv) {
        return None;
    }

    let non_option_tokens = all_non_option_tokens(argv);
    let mode = resolve_mode(parsed);
    let native_mode = match (mode.format, non_option_tokens.len()) {
        (OutputFormat::Table, 2) => "default-detail",
        (OutputFormat::Json, 1) => "structured-list",
        (OutputFormat::Csv, 1) => "csv-list",
        (OutputFormat::Table, 1) => "default-list",
        _ => return None,
    };
    manifest_allows_native_mode("pools", native_mode, manifest).then_some(native_mode)
}

pub(crate) fn stats_native_mode(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Option<&'static str> {
    if parsed.is_help_like {
        return None;
    }

    let command_path = resolve_command_path_prefix(&all_non_option_tokens(argv), manifest)?;
    let mode = resolve_mode(parsed);
    match command_path.as_str() {
        "stats" => {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured-default",
                OutputFormat::Csv => "csv",
                OutputFormat::Table => "default",
            };
            manifest_allows_native_mode("stats", native_mode, manifest).then_some(native_mode)
        }
        "stats global" => {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured",
                OutputFormat::Csv => "csv",
                OutputFormat::Table => "default",
            };
            manifest_allows_native_mode("stats global", native_mode, manifest)
                .then_some(native_mode)
        }
        "stats pool" => {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured",
                OutputFormat::Csv => "csv",
                OutputFormat::Table => "default",
            };
            manifest_allows_native_mode("stats pool", native_mode, manifest).then_some(native_mode)
        }
        _ => None,
    }
}

pub(crate) fn resolve_help_path(parsed: &ParsedRootArgv, manifest: &Manifest) -> Option<String> {
    let tokens = if parsed.first_command_token.as_deref() == Some("help") {
        parsed
            .non_option_tokens
            .iter()
            .skip(1)
            .cloned()
            .collect::<Vec<_>>()
    } else {
        parsed.non_option_tokens.clone()
    };

    if tokens.is_empty() {
        return None;
    }

    for length in (1..=tokens.len()).rev() {
        let candidate = tokens
            .iter()
            .take(length)
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");
        let canonical = canonicalize_command_path(&candidate, manifest);
        if manifest
            .routes
            .help_command_paths
            .iter()
            .any(|path| path == &canonical)
            && manifest.help_text_by_path.contains_key(&canonical)
        {
            return Some(canonical);
        }
    }

    None
}

fn canonicalize_command_path(candidate: &str, manifest: &Manifest) -> String {
    manifest
        .alias_map
        .get(candidate)
        .cloned()
        .unwrap_or_else(|| candidate.to_string())
}

pub(crate) fn resolve_command_path(tokens: &[String], manifest: &Manifest) -> Option<String> {
    if tokens.is_empty() {
        return None;
    }

    let joined = tokens.join(" ");
    let canonical = canonicalize_command_path(&joined, manifest);
    if manifest.command_paths.iter().any(|path| path == &canonical) {
        return Some(canonical);
    }

    None
}

pub(crate) fn resolve_command_path_prefix(
    tokens: &[String],
    manifest: &Manifest,
) -> Option<String> {
    if tokens.is_empty() {
        return None;
    }

    for length in (1..=tokens.len()).rev() {
        let candidate = tokens
            .iter()
            .take(length)
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");
        let canonical = canonicalize_command_path(&candidate, manifest);
        if manifest.command_paths.iter().any(|path| path == &canonical) {
            return Some(canonical);
        }
    }

    None
}

pub(crate) fn is_known_root_command(command: &str, manifest: &Manifest) -> bool {
    manifest
        .command_paths
        .iter()
        .filter(|path| !path.contains(' '))
        .any(|path| path == command)
        || manifest.alias_map.contains_key(command)
}

pub(crate) fn manifest_allows_native_mode(
    command_path: &str,
    native_mode: &str,
    manifest: &Manifest,
) -> bool {
    let Some(route) = manifest.routes.command_routes.get(command_path) else {
        return false;
    };

    if route.owner == "js-runtime" {
        return false;
    }

    route.native_modes.iter().any(|mode| mode == native_mode)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::root_argv::parse_root_argv;
    use serde_json::json;

    fn argv(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn test_manifest() -> Manifest {
        serde_json::from_value(json!({
            "manifestVersion": "1",
            "runtimeVersion": "v1",
            "cliVersion": "2.0.0",
            "jsonSchemaVersion": "2.0.0",
            "commandPaths": [
                "activity",
                "flow",
                "pools",
                "ragequit",
                "stats",
                "stats global",
                "stats pool",
                "guide",
                "capabilities",
                "describe",
                "completion"
            ],
            "aliasMap": {
                "exit": "ragequit"
            },
            "rootHelp": "help",
            "structuredRootHelp": "structured help",
            "helpTextByPath": {
                "activity": "Usage: privacy-pools activity",
                "flow": "Usage: privacy-pools flow",
                "guide": "Guide help",
                "ragequit": "Usage: privacy-pools ragequit"
            },
            "guideStructuredText": "guide",
            "guideHumanText": "guide",
            "capabilitiesHumanText": "capabilities",
            "describeHumanTextByPath": {
                "flow": "flow describe"
            },
            "completionSpec": {
                "name": "privacy-pools",
                "aliases": [],
                "options": [],
                "subcommands": []
            },
            "completionScripts": {},
            "runtimeConfig": {
                "chainEnvSuffixes": {},
                "defaultRpcUrls": {},
                "chainNames": [],
                "mainnetChainNames": [],
                "nativeAssetAddress": "0x0000000000000000000000000000000000000000",
                "knownPools": {},
                "explorerUrls": {},
                "chains": {}
            },
            "routes": {
                "staticLocalCommands": ["guide", "capabilities", "describe", "completion"],
                "directNativeCommands": ["guide", "capabilities", "describe", "completion"],
                "helpCommandPaths": ["activity", "flow", "guide", "capabilities", "describe", "completion", "pools", "ragequit", "stats", "stats global", "stats pool"],
                "commandRoutes": {
                    "activity": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] },
                    "flow": { "owner": "js-runtime", "nativeModes": ["help"] },
                    "pools": { "owner": "hybrid", "nativeModes": ["default-list", "default-detail", "csv-list", "structured-list", "help"] },
                    "ragequit": { "owner": "js-runtime", "nativeModes": ["help"] },
                    "stats": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured-default", "structured-global", "help"] },
                    "stats global": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] },
                    "stats pool": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] },
                    "guide": { "owner": "native-shell", "nativeModes": ["default", "help"] },
                    "capabilities": { "owner": "native-shell", "nativeModes": ["default", "help"] },
                    "describe": { "owner": "native-shell", "nativeModes": ["default", "help"] },
                    "completion": { "owner": "native-shell", "nativeModes": ["default", "help"] }
                }
            },
            "capabilitiesPayload": {}
        }))
        .expect("test manifest should deserialize")
    }

    #[test]
    fn resolve_mode_prefers_structured_machine_output() {
        let parsed = parse_root_argv(&argv(&["--agent", "--format", "csv", "guide"]));
        let mode = resolve_mode(&parsed);
        assert!(mode.is_json());
        assert!(!mode.is_csv());
        assert!(mode.is_quiet);
    }

    #[test]
    fn resolve_help_path_supports_help_alias_form() {
        let manifest = test_manifest();
        let parsed = parse_root_argv(&argv(&["help", "flow"]));
        assert_eq!(
            resolve_help_path(&parsed, &manifest),
            Some("flow".to_string())
        );
    }

    #[test]
    fn stats_native_mode_prefers_structured_mode_for_agent_csv_mix() {
        let manifest = test_manifest();
        let args = argv(&["--agent", "--format", "csv", "stats"]);
        let parsed = parse_root_argv(&args);
        assert_eq!(
            stats_native_mode(&args, &parsed, &manifest),
            Some("structured-default")
        );
    }

    #[test]
    fn pools_native_mode_handles_detail_view_in_human_mode_only() {
        let manifest = test_manifest();
        let args = argv(&["pools", "ETH"]);
        let parsed = parse_root_argv(&args);
        assert_eq!(
            pools_native_mode(&args, &parsed, &manifest),
            Some("default-detail")
        );

        let json_args = argv(&["--json", "pools", "ETH"]);
        let json_parsed = parse_root_argv(&json_args);
        assert_eq!(pools_native_mode(&json_args, &json_parsed, &manifest), None);
    }

    #[test]
    fn resolve_command_path_prefix_prefers_longest_match() {
        let manifest = test_manifest();
        let tokens = argv(&["stats", "pool", "ETH"]);
        assert_eq!(
            resolve_command_path_prefix(&tokens, &manifest),
            Some("stats pool".to_string())
        );
    }

    #[test]
    fn resolve_mode_defaults_to_table_for_humans() {
        let parsed = parse_root_argv(&argv(&["guide"]));
        let mode = resolve_mode(&parsed);
        assert!(!mode.is_json());
        assert!(!mode.is_csv());
        assert!(!mode.is_quiet);
    }

    #[test]
    fn static_quiet_mode_treats_quiet_and_machine_modes_as_quiet() {
        assert!(is_static_quiet_mode(&parse_root_argv(&argv(&[
            "--quiet", "guide"
        ]))));
        assert!(is_static_quiet_mode(&parse_root_argv(&argv(&[
            "--format", "csv", "guide",
        ]))));
        assert!(is_static_quiet_mode(&parse_root_argv(&argv(&[
            "--json", "guide"
        ]))));
        assert!(!is_static_quiet_mode(&parse_root_argv(&argv(&["guide"]))));
    }

    #[test]
    fn activity_native_mode_handles_table_csv_and_help_cases() {
        let manifest = test_manifest();

        let human = parse_root_argv(&argv(&["activity"]));
        assert_eq!(
            activity_native_mode(&argv(&["activity"]), &human, &manifest),
            Some("default")
        );

        let csv = parse_root_argv(&argv(&["--format", "csv", "activity"]));
        assert_eq!(
            activity_native_mode(&argv(&["--format", "csv", "activity"]), &csv, &manifest),
            Some("csv")
        );

        let help = parse_root_argv(&argv(&["activity", "--help"]));
        assert_eq!(
            activity_native_mode(&argv(&["activity", "--help"]), &help, &manifest),
            None
        );
    }

    #[test]
    fn pools_native_mode_selects_list_formats_only() {
        let manifest = test_manifest();

        let human = argv(&["pools"]);
        let human_parsed = parse_root_argv(&human);
        assert_eq!(
            pools_native_mode(&human, &human_parsed, &manifest),
            Some("default-list")
        );

        let csv = argv(&["--format", "csv", "pools"]);
        let csv_parsed = parse_root_argv(&csv);
        assert_eq!(
            pools_native_mode(&csv, &csv_parsed, &manifest),
            Some("csv-list")
        );

        let help = argv(&["pools", "--help"]);
        let help_parsed = parse_root_argv(&help);
        assert_eq!(pools_native_mode(&help, &help_parsed, &manifest), None);
    }

    #[test]
    fn stats_native_mode_covers_global_pool_and_unknown_commands() {
        let manifest = test_manifest();

        let global_args = argv(&["stats", "global"]);
        let global_parsed = parse_root_argv(&global_args);
        assert_eq!(
            stats_native_mode(&global_args, &global_parsed, &manifest),
            Some("default")
        );

        let pool_args = argv(&["--format", "csv", "stats", "pool", "--asset", "ETH"]);
        let pool_parsed = parse_root_argv(&pool_args);
        assert_eq!(
            stats_native_mode(&pool_args, &pool_parsed, &manifest),
            Some("csv")
        );

        let unknown_args = argv(&["status"]);
        let unknown_parsed = parse_root_argv(&unknown_args);
        assert_eq!(
            stats_native_mode(&unknown_args, &unknown_parsed, &manifest),
            None
        );
    }

    #[test]
    fn resolve_help_and_command_paths_cover_aliases_and_missing_cases() {
        let manifest = test_manifest();

        let unknown_help = parse_root_argv(&argv(&["help", "status"]));
        assert_eq!(resolve_help_path(&unknown_help, &manifest), None);

        let ragequit_help = parse_root_argv(&argv(&["help", "exit"]));
        assert_eq!(
            resolve_help_path(&ragequit_help, &manifest),
            Some("ragequit".to_string())
        );

        assert_eq!(
            resolve_command_path(&argv(&["stats", "global"]), &manifest),
            Some("stats global".to_string())
        );
        assert_eq!(
            resolve_command_path(&argv(&["exit"]), &manifest),
            Some("ragequit".to_string())
        );
        assert_eq!(resolve_command_path(&argv(&["status"]), &manifest), None);
    }

    #[test]
    fn manifest_route_helpers_reject_missing_or_js_owned_routes() {
        let manifest = test_manifest();

        assert!(is_known_root_command("pools", &manifest));
        assert!(is_known_root_command("exit", &manifest));
        assert!(!is_known_root_command("status", &manifest));

        assert!(manifest_allows_native_mode(
            "activity",
            "structured",
            &manifest
        ));
        assert!(!manifest_allows_native_mode("flow", "default", &manifest));
        assert!(!manifest_allows_native_mode(
            "stats",
            "structured",
            &manifest
        ));
        assert!(!manifest_allows_native_mode("status", "default", &manifest));
    }
}
