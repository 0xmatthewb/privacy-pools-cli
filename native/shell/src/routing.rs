use crate::contract::Manifest;
use crate::root_argv::{
    is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option, ParsedRootArgv,
};

#[derive(Debug, Clone)]
pub(crate) struct NativeMode {
    pub(crate) format: OutputFormat,
    pub(crate) is_wide: bool,
    pub(crate) is_quiet: bool,
}

impl NativeMode {
    pub(crate) fn is_json(&self) -> bool {
        matches!(self.format, OutputFormat::Json)
    }

    pub(crate) fn is_csv(&self) -> bool {
        matches!(self.format, OutputFormat::Csv)
    }

    pub(crate) fn is_wide(&self) -> bool {
        self.is_wide
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
        is_wide: parsed.format_flag_value.as_deref() == Some("wide"),
        is_quiet: parsed.is_quiet || parsed.is_agent,
    }
}

pub(crate) fn is_static_quiet_mode(parsed: &ParsedRootArgv) -> bool {
    let mode = resolve_mode(parsed);
    mode.is_quiet || mode.is_json() || mode.is_csv()
}

fn should_handle_native_pools(argv: &[String]) -> bool {
    let non_option_tokens = pools_non_option_tokens(argv);
    matches!(non_option_tokens.first().map(String::as_str), Some("pools"))
}

fn pools_non_option_tokens(argv: &[String]) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            tokens.extend(argv.iter().skip(index + 1).cloned());
            break;
        }
        if token == "--search"
            || token == "--sort"
            || token == "--limit"
            || token == "--page"
            || token == "-n"
        {
            index += 2;
            continue;
        }
        if token.starts_with("--search=")
            || token.starts_with("--sort=")
            || token.starts_with("--limit=")
            || token.starts_with("--page=")
            || token == "--include-testnets"
            || is_command_global_inline_value_option(token)
            || is_command_global_boolean_option(token)
        {
            index += 1;
            continue;
        }
        if is_command_global_value_option(token) {
            index += 2;
            continue;
        }
        if token.starts_with('-') {
            index += 1;
            continue;
        }
        tokens.push(token.clone());
        index += 1;
    }
    tokens
}

pub(crate) fn pools_native_mode(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Option<&'static str> {
    if parsed.is_help_like || !should_handle_native_pools(argv) {
        return None;
    }

    let non_option_tokens = pools_non_option_tokens(argv);
    let mode = resolve_mode(parsed);
    let (command_path, native_mode) = match non_option_tokens.as_slice() {
        [root] if root == "pools" => {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured-list",
                OutputFormat::Csv => "csv-list",
                OutputFormat::Table => "default-list",
            };
            ("pools", native_mode)
        }
        [root, subcommand, _asset] if root == "pools" && subcommand == "show" => {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured-detail",
                OutputFormat::Table => "default-detail",
                OutputFormat::Csv => return None,
            };
            ("pools show", native_mode)
        }
        [root, subcommand] | [root, subcommand, _]
            if root == "pools" && subcommand == "activity" =>
        {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured",
                OutputFormat::Csv => "csv",
                OutputFormat::Table => "default",
            };
            ("pools activity", native_mode)
        }
        [root, subcommand] | [root, subcommand, _] if root == "pools" && subcommand == "stats" => {
            let native_mode = match mode.format {
                OutputFormat::Json => "structured",
                OutputFormat::Csv => "csv",
                OutputFormat::Table => "default",
            };
            ("pools stats", native_mode)
        }
        _ => return None,
    };
    manifest_allows_native_mode(command_path, native_mode, manifest).then_some(native_mode)
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

#[cfg(test)]
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
    use crate::known_addresses::ZERO_ADDRESS_CHECKSUMMED;
    use crate::root_argv::parse_root_argv;
    use serde_json::json;
    use std::env;

    fn argv(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn with_agent_env_cleared<R>(run: impl FnOnce() -> R) -> R {
        let _guard = crate::test_env::env_lock().lock().unwrap();
        let previous = env::var("PRIVACY_POOLS_AGENT").ok();
        env::remove_var("PRIVACY_POOLS_AGENT");
        let result = run();
        match previous {
            Some(value) => env::set_var("PRIVACY_POOLS_AGENT", value),
            None => env::remove_var("PRIVACY_POOLS_AGENT"),
        }
        result
    }

    fn test_manifest() -> Manifest {
        serde_json::from_value(json!({
            "manifestVersion": "1",
            "runtimeVersion": "v1",
            "cliVersion": "2.0.0",
            "jsonSchemaVersion": "2.0.0",
            "commandPaths": [
                "flow",
                "pools",
                "pools show",
                "pools activity",
                "pools stats",
                "ragequit",
                "guide",
                "capabilities",
                "describe",
                "completion"
            ],
            "aliasMap": {},
            "rootHelp": "help",
            "structuredRootHelp": "structured help",
            "helpTextByPath": {
                "pools activity": "Usage: privacy-pools pools activity",
                "flow": "Usage: privacy-pools flow",
                "guide": "Guide help",
                "ragequit": "Usage: privacy-pools ragequit"
            },
            "guideStructuredText": "guide",
            "guideStructuredPayload": { "mode": "help", "help": "guide", "topics": [] },
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
                "nativeAssetAddress": ZERO_ADDRESS_CHECKSUMMED,
                "knownPools": {},
                "explorerUrls": {},
                "chains": {}
            },
            "routes": {
                "staticLocalCommands": ["guide", "capabilities", "describe", "completion"],
                "directNativeCommands": ["guide", "capabilities", "describe", "completion"],
                "helpCommandPaths": ["flow", "guide", "capabilities", "describe", "completion", "pools", "pools show", "pools activity", "pools stats", "ragequit"],
                "commandRoutes": {
                    "flow": { "owner": "js-runtime", "nativeModes": ["help"] },
                    "pools": { "owner": "hybrid", "nativeModes": ["default-list", "csv-list", "structured-list", "help"] },
                    "pools show": { "owner": "hybrid", "nativeModes": ["default-detail", "structured-detail", "help"] },
                    "pools activity": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] },
                    "pools stats": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] },
                    "ragequit": { "owner": "js-runtime", "nativeModes": ["help"] },
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
        let parsed = parse_root_argv(&argv(&["--agent", "--output", "csv", "guide"]));
        let mode = resolve_mode(&parsed);
        assert!(mode.is_json());
        assert!(!mode.is_csv());
        assert!(!mode.is_wide());
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
    fn pools_stats_native_mode_prefers_structured_mode_for_agent_csv_mix() {
        let manifest = test_manifest();
        let args = argv(&["--agent", "--output", "csv", "pools", "stats"]);
        let parsed = parse_root_argv(&args);
        assert_eq!(
            pools_native_mode(&args, &parsed, &manifest),
            Some("structured")
        );
    }

    #[test]
    fn pools_native_mode_handles_show_view() {
        let manifest = test_manifest();
        let args = argv(&["pools", "show", "ETH"]);
        let parsed = parse_root_argv(&args);
        assert_eq!(
            pools_native_mode(&args, &parsed, &manifest),
            Some("default-detail")
        );

        let json_args = argv(&["--json", "pools", "show", "ETH"]);
        let json_parsed = parse_root_argv(&json_args);
        assert_eq!(
            pools_native_mode(&json_args, &json_parsed, &manifest),
            Some("structured-detail")
        );

        let old_detail_args = argv(&["pools", "ETH"]);
        let old_detail_parsed = parse_root_argv(&old_detail_args);
        assert_eq!(
            pools_native_mode(&old_detail_args, &old_detail_parsed, &manifest),
            None
        );
    }

    #[test]
    fn resolve_command_path_prefix_prefers_longest_match() {
        let manifest = test_manifest();
        let tokens = argv(&["pools", "stats", "ETH"]);
        assert_eq!(
            resolve_command_path_prefix(&tokens, &manifest),
            Some("pools stats".to_string())
        );
    }

    #[test]
    fn resolve_mode_defaults_to_table_for_humans() {
        with_agent_env_cleared(|| {
            let parsed = parse_root_argv(&argv(&["guide"]));
            let mode = resolve_mode(&parsed);
            assert!(!mode.is_json());
            assert!(!mode.is_csv());
            assert!(!mode.is_wide());
            assert!(!mode.is_quiet);
        });
    }

    #[test]
    fn resolve_mode_preserves_wide_format_for_human_output() {
        with_agent_env_cleared(|| {
            let parsed = parse_root_argv(&argv(&["--output", "wide", "pools", "activity"]));
            let mode = resolve_mode(&parsed);
            assert!(!mode.is_json());
            assert!(!mode.is_csv());
            assert!(mode.is_wide());
            assert!(!mode.is_quiet);
        });
    }

    #[test]
    fn static_quiet_mode_treats_quiet_and_machine_modes_as_quiet() {
        with_agent_env_cleared(|| {
            assert!(is_static_quiet_mode(&parse_root_argv(&argv(&[
                "--quiet", "guide"
            ]))));
            assert!(is_static_quiet_mode(&parse_root_argv(&argv(&[
                "--output", "csv", "guide",
            ]))));
            assert!(is_static_quiet_mode(&parse_root_argv(&argv(&[
                "--json", "guide"
            ]))));
            assert!(!is_static_quiet_mode(&parse_root_argv(&argv(&["guide"]))));
        });
    }

    #[test]
    fn pools_activity_native_mode_handles_table_csv_and_help_cases() {
        with_agent_env_cleared(|| {
            let manifest = test_manifest();

            let human_args = argv(&["pools", "activity"]);
            let human = parse_root_argv(&human_args);
            assert_eq!(
                pools_native_mode(&human_args, &human, &manifest),
                Some("default")
            );

            let csv_args = argv(&["--output", "csv", "pools", "activity"]);
            let csv = parse_root_argv(&csv_args);
            assert_eq!(pools_native_mode(&csv_args, &csv, &manifest), Some("csv"));

            let help_args = argv(&["pools", "activity", "--help"]);
            let help = parse_root_argv(&help_args);
            assert_eq!(pools_native_mode(&help_args, &help, &manifest), None);
        });
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

        let csv = argv(&["--output", "csv", "pools"]);
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
    fn pools_native_mode_covers_stats_global_pool_and_unknown_commands() {
        let manifest = test_manifest();

        let global_args = argv(&["pools", "stats"]);
        let global_parsed = parse_root_argv(&global_args);
        assert_eq!(
            pools_native_mode(&global_args, &global_parsed, &manifest),
            Some("default")
        );

        let pool_args = argv(&["--output", "csv", "pools", "stats", "ETH"]);
        let pool_parsed = parse_root_argv(&pool_args);
        assert_eq!(
            pools_native_mode(&pool_args, &pool_parsed, &manifest),
            Some("csv")
        );

        let unknown_args = argv(&["status"]);
        let unknown_parsed = parse_root_argv(&unknown_args);
        assert_eq!(
            pools_native_mode(&unknown_args, &unknown_parsed, &manifest),
            None
        );
    }

    #[test]
    fn resolve_help_and_command_paths_cover_aliases_and_missing_cases() {
        let manifest = test_manifest();

        let unknown_help = parse_root_argv(&argv(&["help", "status"]));
        assert_eq!(resolve_help_path(&unknown_help, &manifest), None);

        let ragequit_help = parse_root_argv(&argv(&["help", "ragequit"]));
        assert_eq!(
            resolve_help_path(&ragequit_help, &manifest),
            Some("ragequit".to_string())
        );

        assert_eq!(
            resolve_command_path(&argv(&["pools", "stats"]), &manifest),
            Some("pools stats".to_string())
        );
        assert_eq!(
            resolve_command_path(&argv(&["ragequit"]), &manifest),
            Some("ragequit".to_string())
        );
        assert_eq!(resolve_command_path(&argv(&["exit"]), &manifest), None);
        assert_eq!(resolve_command_path(&argv(&["status"]), &manifest), None);
    }

    #[test]
    fn manifest_route_helpers_reject_missing_or_js_owned_routes() {
        let manifest = test_manifest();

        assert!(is_known_root_command("pools", &manifest));
        assert!(!is_known_root_command("exit", &manifest));
        assert!(!is_known_root_command("status", &manifest));

        assert!(manifest_allows_native_mode(
            "pools activity",
            "structured",
            &manifest
        ));
        assert!(!manifest_allows_native_mode("flow", "default", &manifest));
        assert!(!manifest_allows_native_mode(
            "activity",
            "structured",
            &manifest
        ));
        assert!(!manifest_allows_native_mode("status", "default", &manifest));
    }
}
