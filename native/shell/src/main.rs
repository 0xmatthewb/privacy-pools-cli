mod bridge;
mod commands;
mod completion;
mod config;
mod contract;
mod dispatch;
mod error;
mod http_client;
mod json;
mod known_addresses;
mod output;
mod read_only_api;
mod root_argv;
mod routing;
#[cfg(test)]
mod test_env;

use bridge::forward_to_js_worker;
use commands::activity::handle_activity_native;
use commands::pools::handle_pools_native;
use commands::stats::handle_stats_native;
use contract::{manifest, runtime_contract};
use dispatch::{handle_capabilities, handle_completion, handle_describe, handle_guide};
use error::CliError;
use output::{emit_help, emit_version, print_error_and_exit, set_suppress_headers};
use root_argv::{
    output_format_choices_text, parse_root_argv, read_long_option_value, root_argv_slice,
    ParsedRootArgv,
};
use routing::{
    activity_native_mode, is_known_root_command, manifest_allows_native_mode, pools_native_mode,
    resolve_help_path, stats_native_mode,
};
use std::env;

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const CLI_VERSION: &str = env!("CLI_VERSION");
const CSV_SUPPORTED_COMMANDS: [&str; 7] = [
    "pools",
    "accounts",
    "activity",
    "protocol-stats",
    "pool-stats",
    "stats",
    "history",
];

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

fn run(argv: &[String], parsed: &ParsedRootArgv) -> Result<i32, CliError> {
    set_suppress_headers(parsed.is_no_header);
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

    if manifest.cli_version != CLI_VERSION {
        return Err(CliError::unknown(
            format!(
                "Native shell CLI version mismatch: expected {}, got {}.",
                CLI_VERSION, manifest.cli_version
            ),
            Some("Regenerate the native manifest and rebuild the native shell.".to_string()),
        ));
    }

    if let Some(format_value) = parsed.format_flag_value.as_deref() {
        if parsed.has_invalid_output_format() {
            return Err(CliError::input(
                format!(
                    "option '--output <format>' argument '{}' is invalid. Allowed choices are {}.",
                    format_value,
                    output_format_choices_text()
                ),
                Some("Use --help to see usage and examples.".to_string()),
            ));
        }
        if format_value == "csv" && parsed.is_structured_output_mode {
            return Err(CliError::input_with_code(
                "Choose either JSON or CSV output, not both.",
                Some(
                    "Use --json/--agent for JSON, or remove JSON flags and use --output csv."
                        .to_string(),
                ),
                "INPUT_FLAG_CONFLICT",
            ));
        }
    }

    if parsed.is_version_like && parsed.first_command_token.is_none() {
        emit_version(CLI_VERSION, parsed.is_structured_output_mode);
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
        "stats" | "protocol-stats" | "pool-stats"
            if stats_native_mode(argv, parsed, manifest).is_some() =>
        {
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

pub(crate) fn parse_timeout_ms(argv: &[String]) -> u64 {
    read_long_option_value(argv, "--timeout")
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| (value * 1000.0).round() as u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(tokens: &[&str]) -> Vec<String> {
        tokens.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parse_timeout_ms_defaults_and_parses_positive_values() {
        assert_eq!(parse_timeout_ms(&argv(&[])), DEFAULT_TIMEOUT_MS);
        assert_eq!(parse_timeout_ms(&argv(&["--timeout", "2.5"])), 2_500);
        assert_eq!(
            parse_timeout_ms(&argv(&["--timeout", "-1"])),
            DEFAULT_TIMEOUT_MS
        );
        assert_eq!(parse_timeout_ms(&argv(&["--timeout=1"])), 1_000);
    }

    #[test]
    fn run_rejects_invalid_output_formats() {
        let argv = argv(&["--json", "--output", "markdown", "guide"]);
        let parsed = parse_root_argv(&argv);
        let error = run(&argv, &parsed).expect_err("invalid format should fail");
        assert_eq!(error.code, "INPUT_ERROR");
        assert!(error.message.contains("argument 'markdown' is invalid"));
    }

    #[test]
    fn run_accepts_wide_output_format_for_native_help_paths() {
        let argv = argv(&["--output", "wide", "guide"]);
        let parsed = parse_root_argv(&argv);
        assert_eq!(run(&argv, &parsed).unwrap(), 0);
    }

    #[test]
    fn run_handles_root_version_and_root_help() {
        let version_argv = argv(&["--version"]);
        let version_parsed = parse_root_argv(&version_argv);
        assert_eq!(run(&version_argv, &version_parsed).unwrap(), 0);

        let help_argv = argv(&["--help"]);
        let help_parsed = parse_root_argv(&help_argv);
        assert_eq!(run(&help_argv, &help_parsed).unwrap(), 0);
    }

    #[test]
    fn run_handles_machine_mode_without_command() {
        let argv = argv(&["--agent"]);
        let parsed = parse_root_argv(&argv);
        assert_eq!(run(&argv, &parsed).unwrap(), 0);
    }

    #[test]
    fn run_reports_unknown_commands_and_help_paths() {
        let unknown_argv = argv(&["wat"]);
        let unknown_parsed = parse_root_argv(&unknown_argv);
        let unknown = run(&unknown_argv, &unknown_parsed).expect_err("unknown command should fail");
        assert_eq!(unknown.code, "INPUT_ERROR");
        assert!(unknown.message.contains("unknown command"));

        let help_argv = argv(&["help", "missing-command"]);
        let help_parsed = parse_root_argv(&help_argv);
        let help_error = run(&help_argv, &help_parsed).expect_err("unknown help path should fail");
        assert_eq!(help_error.code, "INPUT_ERROR");
        assert!(help_error.message.contains("Unknown command path"));
    }

    #[test]
    fn run_returns_js_worker_error_for_js_owned_commands_without_launcher() {
        let _guard = crate::test_env::env_lock().lock().unwrap();
        let argv = argv(&["status", "--no-check"]);
        let parsed = parse_root_argv(&argv);
        let error = run(&argv, &parsed).expect_err("status should forward to js worker");
        assert_eq!(error.code, "UNKNOWN_ERROR");
        assert!(error.message.contains("JS worker bootstrap is unavailable"));
    }
}
