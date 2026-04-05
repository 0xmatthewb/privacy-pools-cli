mod bridge;
mod commands;
mod completion;
mod config;
mod contract;
mod dispatch;
mod error;
mod http_client;
mod json;
mod output;
mod read_only_api;
mod root_argv;
mod routing;

use bridge::forward_to_js_worker;
use commands::activity::handle_activity_native;
use commands::pools::handle_pools_native;
use commands::stats::handle_stats_native;
use contract::{manifest, runtime_contract};
use dispatch::{handle_capabilities, handle_completion, handle_describe, handle_guide};
use error::CliError;
use output::{emit_help, emit_version, print_error_and_exit};
use root_argv::{parse_root_argv, read_long_option_value, root_argv_slice, ParsedRootArgv};
use routing::{
    activity_native_mode, is_known_root_command, manifest_allows_native_mode, pools_native_mode,
    resolve_help_path, stats_native_mode,
};
use std::env;

const OUTPUT_FORMAT_CHOICES: &str = "table, csv, json";

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const CSV_SUPPORTED_COMMANDS: [&str; 5] = ["pools", "accounts", "activity", "stats", "history"];

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

pub(crate) fn parse_timeout_ms(argv: &[String]) -> u64 {
    read_long_option_value(argv, "--timeout")
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| (value * 1000.0).round() as u64)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}
