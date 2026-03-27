use serde::Deserialize;
use std::collections::BTreeSet;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub(crate) struct ParsedRootArgv {
    pub(crate) argv: Vec<String>,
    pub(crate) first_command_token: Option<String>,
    pub(crate) non_option_tokens: Vec<String>,
    pub(crate) format_flag_value: Option<String>,
    pub(crate) is_json: bool,
    pub(crate) is_csv_mode: bool,
    pub(crate) is_agent: bool,
    pub(crate) is_unsigned: bool,
    pub(crate) is_machine_mode: bool,
    pub(crate) is_structured_output_mode: bool,
    pub(crate) is_help_like: bool,
    pub(crate) is_version_like: bool,
    pub(crate) is_root_help_invocation: bool,
    pub(crate) is_quiet: bool,
    pub(crate) suppress_banner: bool,
    pub(crate) is_welcome: bool,
}

impl ParsedRootArgv {
    pub(crate) fn global_chain(&self) -> Option<String> {
        read_long_option_value(&self.argv, "--chain")
            .or_else(|| read_short_option_value(&self.argv, "-c"))
    }

    pub(crate) fn global_rpc_url(&self) -> Option<String> {
        read_long_option_value(&self.argv, "--rpc-url")
            .or_else(|| read_short_option_value(&self.argv, "-r"))
    }
}

#[derive(Debug, Deserialize)]
struct GeneratedRootFlag {
    flag: String,
    #[serde(rename = "takesValue")]
    takes_value: bool,
    #[serde(rename = "welcomeBoolean")]
    welcome_boolean: bool,
}

#[derive(Debug)]
struct RootFlagContract {
    value_options: BTreeSet<String>,
    inline_value_options: BTreeSet<String>,
    boolean_options: BTreeSet<String>,
    welcome_boolean_options: BTreeSet<String>,
    boolean_short_bundle_flags: BTreeSet<char>,
    welcome_short_bundle_flags: BTreeSet<char>,
}

static ROOT_FLAG_CONTRACT: OnceLock<RootFlagContract> = OnceLock::new();

fn split_flag_names(flag: &str) -> Vec<String> {
    flag.split(',')
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.split_whitespace().next().map(str::to_string))
        .collect()
}

fn short_bundle_flags(names: &BTreeSet<String>) -> BTreeSet<char> {
    names
        .iter()
        .filter_map(|name| {
            if name.starts_with('-') && !name.starts_with("--") && name.len() == 2 {
                name.chars().nth(1)
            } else {
                None
            }
        })
        .collect()
}

fn root_flag_contract() -> &'static RootFlagContract {
    ROOT_FLAG_CONTRACT.get_or_init(|| {
        let flags: Vec<GeneratedRootFlag> =
            serde_json::from_str(include_str!("../generated/root-flags.json",))
                .expect("native shell root flag contract must deserialize");

        let value_options = flags
            .iter()
            .filter(|flag| flag.takes_value)
            .flat_map(|flag| split_flag_names(&flag.flag))
            .collect::<BTreeSet<_>>();
        let inline_value_options = value_options
            .iter()
            .filter(|name| name.starts_with("--"))
            .cloned()
            .collect::<BTreeSet<_>>();
        let boolean_options = flags
            .iter()
            .filter(|flag| !flag.takes_value)
            .flat_map(|flag| split_flag_names(&flag.flag))
            .collect::<BTreeSet<_>>();
        let welcome_boolean_options = flags
            .iter()
            .filter(|flag| flag.welcome_boolean)
            .flat_map(|flag| split_flag_names(&flag.flag))
            .collect::<BTreeSet<_>>();

        RootFlagContract {
            boolean_short_bundle_flags: short_bundle_flags(&boolean_options),
            welcome_short_bundle_flags: short_bundle_flags(&welcome_boolean_options),
            value_options,
            inline_value_options,
            boolean_options,
            welcome_boolean_options,
        }
    })
}

pub(crate) fn parse_root_argv(argv: &[String]) -> ParsedRootArgv {
    let root_args = root_argv_slice(argv);
    let first_command_token = first_non_option_token(argv);
    let non_option_tokens = all_non_option_tokens(argv);
    let format_flag_value =
        read_long_option_value(argv, "--format").map(|value| value.to_lowercase());
    let is_agent = has_long_flag(argv, "--agent");
    let is_json = has_long_flag(argv, "--json")
        || has_short_flag(argv, 'j')
        || format_flag_value.as_deref() == Some("json")
        || is_agent;
    let is_csv_mode = format_flag_value.as_deref() == Some("csv") && !is_json;
    let is_unsigned = has_long_flag(argv, "--unsigned");
    let is_machine_mode = is_json || is_csv_mode || is_unsigned || is_agent;
    let is_structured_output_mode = is_json || is_unsigned || is_agent;
    let is_help_like = root_args.iter().any(|token| token == "--help")
        || has_short_flag(argv, 'h')
        || first_command_token.as_deref() == Some("help");
    let is_version_like =
        root_args.iter().any(|token| token == "--version") || has_short_flag(argv, 'V');
    let is_root_help_invocation = is_help_like
        && (non_option_tokens.is_empty()
            || (non_option_tokens.len() == 1 && non_option_tokens[0] == "help"));
    let suppress_banner = root_args.iter().any(|token| token == "--no-banner");
    let is_quiet = root_args.iter().any(|token| token == "--quiet") || has_short_flag(argv, 'q');
    let is_welcome = is_welcome_flag_only_invocation(argv) && !is_machine_mode;

    ParsedRootArgv {
        argv: argv.to_vec(),
        first_command_token,
        non_option_tokens,
        format_flag_value,
        is_json,
        is_csv_mode,
        is_agent,
        is_unsigned,
        is_machine_mode,
        is_structured_output_mode,
        is_help_like,
        is_version_like,
        is_root_help_invocation,
        is_quiet,
        suppress_banner,
        is_welcome,
    }
}

pub(crate) fn root_argv_slice(argv: &[String]) -> &[String] {
    let boundary = argv
        .iter()
        .position(|token| token == "--")
        .unwrap_or(argv.len());
    &argv[..boundary]
}

pub(crate) fn has_short_flag(argv: &[String], flag: char) -> bool {
    for token in root_argv_slice(argv) {
        if !token.starts_with('-') || token.starts_with("--") {
            continue;
        }

        if token == &format!("-{flag}") {
            return true;
        }

        if token.starts_with('-')
            && token.len() > 2
            && token
                .chars()
                .skip(1)
                .all(|value| value.is_ascii_alphabetic())
            && token.contains(flag)
        {
            return true;
        }
    }

    false
}

pub(crate) fn has_long_flag(argv: &[String], flag: &str) -> bool {
    root_argv_slice(argv)
        .iter()
        .any(|token| token == flag || token.starts_with(&format!("{flag}=")))
}

pub(crate) fn read_long_option_value(argv: &[String], flag: &str) -> Option<String> {
    let argv = root_argv_slice(argv);
    for index in 0..argv.len() {
        let token = &argv[index];
        if token == flag {
            return argv.get(index + 1).cloned();
        }
        let prefix = format!("{flag}=");
        if token.starts_with(&prefix) {
            return Some(token[prefix.len()..].to_string());
        }
    }
    None
}

pub(crate) fn read_short_option_value(argv: &[String], flag: &str) -> Option<String> {
    let argv = root_argv_slice(argv);
    for index in 0..argv.len() {
        if argv[index] == flag {
            return argv.get(index + 1).cloned();
        }
    }
    None
}

pub(crate) fn all_non_option_tokens(argv: &[String]) -> Vec<String> {
    let argv = root_argv_slice(argv);
    let mut tokens = vec![];
    let mut index = 0;

    while index < argv.len() {
        let token = &argv[index];
        if !token.starts_with('-') {
            tokens.push(token.clone());
            index += 1;
            continue;
        }

        if root_option_takes_value(token) {
            index += 2;
            continue;
        }

        if is_root_long_inline_value_option(token) {
            index += 1;
            continue;
        }

        index += 1;
    }

    tokens
}

fn first_non_option_token(argv: &[String]) -> Option<String> {
    let argv = root_argv_slice(argv);
    let mut index = 0;

    while index < argv.len() {
        let token = &argv[index];
        if !token.starts_with('-') {
            return Some(token.clone());
        }

        if root_option_takes_value(token) {
            index += 2;
            continue;
        }

        index += 1;
    }

    None
}

pub(crate) fn root_option_takes_value(token: &str) -> bool {
    root_flag_contract().value_options.contains(token)
}

fn is_root_long_inline_value_option(token: &str) -> bool {
    root_flag_contract()
        .inline_value_options
        .iter()
        .any(|flag| token.starts_with(&format!("{flag}=")))
}

fn is_welcome_flag_only_invocation(argv: &[String]) -> bool {
    let argv = root_argv_slice(argv);
    if argv.is_empty() {
        return true;
    }

    let mut index = 0;
    while index < argv.len() {
        let token = &argv[index];

        if root_option_takes_value(token) {
            if index + 1 >= argv.len() {
                return false;
            }
            index += 2;
            continue;
        }

        if is_root_long_inline_value_option(token) {
            index += 1;
            continue;
        }

        if root_flag_contract().welcome_boolean_options.contains(token)
            || is_welcome_short_flag_bundle(token)
        {
            index += 1;
            continue;
        }

        return false;
    }

    true
}

fn is_welcome_short_flag_bundle(token: &str) -> bool {
    if !token.starts_with('-') || token.starts_with("--") || token.len() < 3 {
        return false;
    }

    token.chars().skip(1).all(|flag| {
        root_flag_contract()
            .welcome_short_bundle_flags
            .contains(&flag)
    })
}

pub(crate) fn is_command_global_boolean_option(token: &str) -> bool {
    root_flag_contract().boolean_options.contains(token)
        || matches!(token, "--help" | "--version")
        || is_command_global_boolean_short_bundle(token)
}

fn is_command_global_boolean_short_bundle(token: &str) -> bool {
    if !token.starts_with('-') || token.starts_with("--") || token.len() < 2 {
        return false;
    }

    token.chars().skip(1).all(|flag| {
        root_flag_contract()
            .boolean_short_bundle_flags
            .contains(&flag)
            || matches!(flag, 'h' | 'V')
    })
}

pub(crate) fn is_command_global_value_option(token: &str) -> bool {
    root_option_takes_value(token)
}

pub(crate) fn is_command_global_inline_value_option(token: &str) -> bool {
    is_root_long_inline_value_option(token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn structured_machine_flags_outrank_csv_mode() {
        let parsed = parse_root_argv(&argv(&["--agent", "--format", "csv", "guide"]));
        assert!(parsed.is_agent);
        assert!(parsed.is_json);
        assert!(!parsed.is_csv_mode);
        assert!(parsed.is_structured_output_mode);
        assert!(!parsed.is_welcome);
    }

    #[test]
    fn json_flag_outranks_csv_mode() {
        let parsed = parse_root_argv(&argv(&["--json", "--format", "csv", "capabilities"]));
        assert!(parsed.is_json);
        assert!(!parsed.is_csv_mode);
        assert!(parsed.is_structured_output_mode);
    }

    #[test]
    fn help_style_invocations_still_resolve_root_help() {
        let parsed = parse_root_argv(&argv(&["help"]));
        assert!(parsed.is_help_like);
        assert!(parsed.is_root_help_invocation);
        assert_eq!(parsed.non_option_tokens, vec!["help".to_string()]);
    }

    #[test]
    fn detail_pools_invocation_is_not_welcome() {
        let parsed = parse_root_argv(&argv(&["pools", "ETH"]));
        assert_eq!(parsed.first_command_token.as_deref(), Some("pools"));
        assert!(!parsed.is_welcome);
    }

    #[test]
    fn global_option_helpers_read_split_and_inline_values() {
        let parsed = parse_root_argv(&argv(&[
            "--chain",
            "mainnet",
            "--rpc-url=https://rpc.example",
            "status",
        ]));

        assert_eq!(parsed.global_chain().as_deref(), Some("mainnet"));
        assert_eq!(
            parsed.global_rpc_url().as_deref(),
            Some("https://rpc.example")
        );
    }

    #[test]
    fn root_option_helpers_ignore_tokens_after_double_dash() {
        let args = argv(&["--json", "--", "--chain", "mainnet"]);
        let parsed = parse_root_argv(&args);

        assert!(parsed.is_json);
        assert_eq!(parsed.global_chain(), None);
        assert!(has_long_flag(&args, "--json"));
        assert!(!has_long_flag(&args, "--chain"));
        assert_eq!(root_argv_slice(&args), argv(&["--json"]));
    }

    #[test]
    fn short_flag_detection_supports_bundles_and_rejects_non_alpha_tokens() {
        let args = argv(&["-qV"]);
        assert!(has_short_flag(&args, 'q'));
        assert!(has_short_flag(&args, 'V'));

        let non_alpha_bundle = argv(&["-q1"]);
        assert!(!has_short_flag(&non_alpha_bundle, 'q'));
    }

    #[test]
    fn token_helpers_skip_global_value_options() {
        let args = argv(&[
            "--chain",
            "mainnet",
            "--rpc-url=https://rpc.example",
            "stats",
            "pool",
        ]);

        assert_eq!(
            all_non_option_tokens(&args),
            vec!["stats".to_string(), "pool".to_string()]
        );
        assert_eq!(
            read_short_option_value(&argv(&["-c", "mainnet"]), "-c"),
            Some("mainnet".to_string())
        );
        assert_eq!(
            read_long_option_value(&argv(&["--format=json"]), "--format"),
            Some("json".to_string())
        );
    }

    #[test]
    fn welcome_detection_accepts_safe_flags_and_rejects_missing_values() {
        let quiet_welcome = parse_root_argv(&argv(&["-q", "--no-banner"]));
        assert!(quiet_welcome.is_welcome);
        assert!(quiet_welcome.is_quiet);
        assert!(quiet_welcome.suppress_banner);

        let missing_value = parse_root_argv(&argv(&["--chain"]));
        assert!(!missing_value.is_welcome);

        let command_invocation = parse_root_argv(&argv(&["status", "--quiet"]));
        assert!(!command_invocation.is_welcome);
    }

    #[test]
    fn command_global_helpers_classify_boolean_and_value_options() {
        assert!(is_command_global_boolean_option("--quiet"));
        assert!(is_command_global_boolean_option("-qV"));
        assert!(is_command_global_boolean_option("--help"));
        assert!(!is_command_global_boolean_option("--chain"));

        assert!(is_command_global_value_option("--chain"));
        assert!(is_command_global_inline_value_option(
            "--rpc-url=https://rpc.example"
        ));
        assert!(!is_command_global_inline_value_option("--quiet"));
    }
}
