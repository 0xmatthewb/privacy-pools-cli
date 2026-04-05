use crate::dispatch::{commander_too_many_arguments_error, commander_unknown_option_error};
use crate::error::CliError;
use crate::root_argv::{
    is_command_global_boolean_option, is_command_global_inline_value_option,
    is_command_global_value_option,
};

#[derive(Debug, Clone)]
pub(super) struct ActivityCommandOptions {
    pub(super) asset: Option<String>,
    pub(super) page: u64,
    pub(super) per_page: u64,
}

pub(super) fn parse_activity_options(argv: &[String]) -> Result<ActivityCommandOptions, CliError> {
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

#[cfg(test)]
mod tests {
    use super::parse_activity_options;

    fn argv(tokens: &[&str]) -> Vec<String> {
        tokens
            .iter()
            .map(|token| token.to_string())
            .collect::<Vec<_>>()
    }

    #[test]
    fn parses_activity_specific_options() {
        let parsed = parse_activity_options(&argv(&[
            "privacy-pools",
            "--json",
            "activity",
            "--asset",
            "ETH",
            "--page=2",
            "--limit",
            "10",
        ]))
        .expect("options");

        assert_eq!(parsed.asset.as_deref(), Some("ETH"));
        assert_eq!(parsed.page, 2);
        assert_eq!(parsed.per_page, 10);
    }

    #[test]
    fn rejects_invalid_page_values() {
        let error = parse_activity_options(&argv(&["privacy-pools", "activity", "--page", "0"]))
            .expect_err("invalid page");
        assert!(error.message.contains("Invalid --page value"));
    }

    #[test]
    fn uses_defaults_and_skips_command_global_flags() {
        let parsed = parse_activity_options(&argv(&[
            "privacy-pools",
            "--chain",
            "sepolia",
            "--json",
            "activity",
        ]))
        .expect("defaults");

        assert_eq!(parsed.asset, None);
        assert_eq!(parsed.page, 1);
        assert_eq!(parsed.per_page, 12);
    }

    #[test]
    fn rejects_unknown_options() {
        let error = parse_activity_options(&argv(&["privacy-pools", "activity", "--bogus"]))
            .expect_err("unknown option");
        assert!(error.message.contains("unknown option"));
    }

    #[test]
    fn rejects_positionals_after_double_dash() {
        let error = parse_activity_options(&argv(&["privacy-pools", "activity", "--", "extra"]))
            .expect_err("unexpected positional");
        assert!(error.message.contains("too many arguments"));
    }
}
