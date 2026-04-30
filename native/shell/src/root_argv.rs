use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub(crate) struct ParsedRootArgv {
    pub(crate) argv: Vec<String>,
    pub(crate) first_command_token: Option<String>,
    pub(crate) non_option_tokens: Vec<String>,
    pub(crate) format_flag_value: Option<String>,
    pub(crate) is_csv_mode: bool,
    pub(crate) is_agent: bool,
    pub(crate) is_structured_output_mode: bool,
    pub(crate) is_help_like: bool,
    pub(crate) is_version_like: bool,
    pub(crate) is_root_help_invocation: bool,
    pub(crate) is_quiet: bool,
    pub(crate) is_no_header: bool,
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

    pub(crate) fn has_invalid_output_format(&self) -> bool {
        self.format_flag_value
            .as_deref()
            .map(|value| {
                root_flag_allowed_values_set("--output")
                    .map(|choices| !choices.contains(value))
                    .unwrap_or(true)
            })
            .unwrap_or(false)
    }
}

#[derive(Debug, Deserialize)]
struct GeneratedRootFlag {
    flag: String,
    #[serde(rename = "takesValue")]
    takes_value: bool,
    #[serde(rename = "welcomeBoolean")]
    welcome_boolean: bool,
    #[serde(default)]
    values: Vec<String>,
}

#[derive(Debug)]
struct RootFlagContract {
    value_options: BTreeSet<String>,
    inline_value_options: BTreeSet<String>,
    boolean_options: BTreeSet<String>,
    welcome_boolean_options: BTreeSet<String>,
    boolean_short_bundle_flags: BTreeSet<char>,
    welcome_short_bundle_flags: BTreeSet<char>,
    option_value_sets: BTreeMap<String, BTreeSet<String>>,
    option_value_lists: BTreeMap<String, Vec<String>>,
}

static ROOT_FLAG_CONTRACT: OnceLock<RootFlagContract> = OnceLock::new();

fn read_boolean_env(name: &str) -> bool {
    matches!(
        env::var(name)
            .ok()
            .map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "1" | "true" | "yes" | "on")
    )
}

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
        let mut option_value_sets = BTreeMap::new();
        let mut option_value_lists = BTreeMap::new();

        for flag in &flags {
            if flag.values.is_empty() {
                continue;
            }

            let value_set = flag.values.iter().cloned().collect::<BTreeSet<_>>();
            let value_list = flag.values.clone();
            for name in split_flag_names(&flag.flag) {
                option_value_sets.insert(name.clone(), value_set.clone());
                option_value_lists.insert(name, value_list.clone());
            }
        }

        RootFlagContract {
            boolean_short_bundle_flags: short_bundle_flags(&boolean_options),
            welcome_short_bundle_flags: short_bundle_flags(&welcome_boolean_options),
            value_options,
            inline_value_options,
            boolean_options,
            welcome_boolean_options,
            option_value_sets,
            option_value_lists,
        }
    })
}

fn root_flag_allowed_values_set(flag: &str) -> Option<&BTreeSet<String>> {
    root_flag_contract().option_value_sets.get(flag)
}

pub(crate) fn output_format_choices_text() -> String {
    root_flag_contract()
        .option_value_lists
        .get("--output")
        .map(|values| values.join(", "))
        .unwrap_or_else(|| "unknown".to_string())
}

pub(crate) fn parse_root_argv(argv: &[String]) -> ParsedRootArgv {
    let root_args = root_argv_slice(argv);
    let first_command_token = first_non_option_token(argv);
    let non_option_tokens = all_non_option_tokens(argv);
    let format_flag_value = read_long_option_value(argv, "--output")
        .or_else(|| read_short_option_value(argv, "-o"))
        .map(|value| value.to_lowercase());
    let env_agent = read_boolean_env("PRIVACY_POOLS_AGENT");
    let env_quiet = read_boolean_env("PRIVACY_POOLS_QUIET");
    let is_agent = has_long_flag(argv, "--agent") || env_agent;
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
    let is_quiet = is_agent
        || env_quiet
        || root_args.iter().any(|token| token == "--quiet")
        || has_short_flag(argv, 'q');
    let is_no_header = root_args.iter().any(|token| token == "--no-header");
    let _is_welcome = is_welcome_flag_only_invocation(argv) && !is_machine_mode;

    ParsedRootArgv {
        argv: argv.to_vec(),
        first_command_token,
        non_option_tokens,
        format_flag_value,
        is_csv_mode,
        is_agent,
        is_structured_output_mode,
        is_help_like,
        is_version_like,
        is_root_help_invocation,
        is_quiet,
        is_no_header,
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

pub(crate) fn available_global_long_options() -> Vec<String> {
    let mut options = root_flag_contract()
        .value_options
        .iter()
        .chain(root_flag_contract().boolean_options.iter())
        .filter(|option| option.starts_with("--"))
        .cloned()
        .collect::<BTreeSet<_>>();
    options.insert("--version".to_string());
    options.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::sync::MutexGuard;

    #[derive(Debug, Deserialize)]
    struct SharedRootArgvCase {
        name: String,
        argv: Vec<String>,
        expected: SharedRootArgvExpectation,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SharedRootArgvExpectation {
        root_argv_slice: Vec<String>,
        first_command_token: Option<String>,
        non_option_tokens: Vec<String>,
        format_flag_value: Option<String>,
        is_agent: bool,
        is_csv_mode: bool,
        is_structured_output_mode: bool,
        is_help_like: bool,
        is_version_like: bool,
        is_root_help_invocation: bool,
        is_quiet: bool,
        is_welcome: bool,
        global_chain: Option<String>,
        global_rpc_url: Option<String>,
    }

    fn argv(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn shared_root_argv_cases() -> Vec<SharedRootArgvCase> {
        serde_json::from_str(include_str!("../../../test/fixtures/root-argv-cases.json"))
            .expect("shared root argv fixture must deserialize")
    }

    struct ModeEnvGuard {
        _guard: MutexGuard<'static, ()>,
        original_agent: Option<String>,
        original_quiet: Option<String>,
    }

    impl Drop for ModeEnvGuard {
        fn drop(&mut self) {
            match &self.original_agent {
                Some(value) => env::set_var("PRIVACY_POOLS_AGENT", value),
                None => env::remove_var("PRIVACY_POOLS_AGENT"),
            }
            match &self.original_quiet {
                Some(value) => env::set_var("PRIVACY_POOLS_QUIET", value),
                None => env::remove_var("PRIVACY_POOLS_QUIET"),
            }
        }
    }

    fn mode_env(agent: Option<&str>, quiet: Option<&str>) -> ModeEnvGuard {
        let guard = crate::test_env::env_lock().lock().unwrap();
        let original_agent = env::var("PRIVACY_POOLS_AGENT").ok();
        let original_quiet = env::var("PRIVACY_POOLS_QUIET").ok();

        match agent {
            Some(value) => env::set_var("PRIVACY_POOLS_AGENT", value),
            None => env::remove_var("PRIVACY_POOLS_AGENT"),
        }
        match quiet {
            Some(value) => env::set_var("PRIVACY_POOLS_QUIET", value),
            None => env::remove_var("PRIVACY_POOLS_QUIET"),
        }

        ModeEnvGuard {
            _guard: guard,
            original_agent,
            original_quiet,
        }
    }

    #[test]
    fn matches_shared_root_argv_parity_fixture() {
        let _env = mode_env(None, None);
        for case in shared_root_argv_cases() {
            let parsed = parse_root_argv(&case.argv);
            let is_welcome = is_welcome_flag_only_invocation(&case.argv)
                && !(parsed.is_structured_output_mode || parsed.is_csv_mode);

            assert_eq!(
                root_argv_slice(&case.argv),
                case.expected.root_argv_slice.as_slice(),
                "root argv slice mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.first_command_token, case.expected.first_command_token,
                "first command mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.non_option_tokens, case.expected.non_option_tokens,
                "non-option tokens mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.format_flag_value, case.expected.format_flag_value,
                "format flag mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_agent, case.expected.is_agent,
                "agent-mode mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_csv_mode, case.expected.is_csv_mode,
                "csv-mode mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_structured_output_mode, case.expected.is_structured_output_mode,
                "structured-output mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_help_like, case.expected.is_help_like,
                "help-like mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_version_like, case.expected.is_version_like,
                "version-like mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_root_help_invocation, case.expected.is_root_help_invocation,
                "root-help mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.is_quiet, case.expected.is_quiet,
                "quiet mismatch for {}",
                case.name
            );
            assert_eq!(
                is_welcome, case.expected.is_welcome,
                "welcome mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.global_chain(),
                case.expected.global_chain,
                "global chain mismatch for {}",
                case.name
            );
            assert_eq!(
                parsed.global_rpc_url(),
                case.expected.global_rpc_url,
                "global rpc mismatch for {}",
                case.name
            );
        }
    }

    #[test]
    fn json_flag_outranks_csv_mode() {
        let _env = mode_env(None, None);
        let parsed = parse_root_argv(&argv(&["--json", "--output", "csv", "capabilities"]));
        assert!(!parsed.is_csv_mode);
        assert!(parsed.is_structured_output_mode);
    }

    #[test]
    fn env_fallbacks_enable_agent_and_quiet_modes() {
        let _env = mode_env(Some("yes"), Some("on"));
        let parsed = parse_root_argv(&argv(&["capabilities"]));

        assert!(parsed.is_agent);
        assert!(parsed.is_structured_output_mode);
        assert!(parsed.is_quiet);
    }

    #[test]
    fn wide_output_format_is_treated_as_valid_table_mode() {
        let _env = mode_env(None, None);
        let parsed = parse_root_argv(&argv(&["--output", "wide", "guide"]));
        assert_eq!(parsed.format_flag_value.as_deref(), Some("wide"));
        assert!(!parsed.has_invalid_output_format());
        assert!(!parsed.is_csv_mode);
        assert!(!parsed.is_structured_output_mode);
    }

    #[test]
    fn output_format_choices_are_loaded_from_generated_root_flags() {
        assert_eq!(
            output_format_choices_text(),
            "table, csv, json, yaml, wide, name"
        );
    }

    #[test]
    fn invalid_output_formats_are_flagged_without_breaking_machine_mode() {
        let _env = mode_env(None, None);
        let parsed = parse_root_argv(&argv(&["--json", "--output", "markdown", "guide"]));
        assert_eq!(parsed.format_flag_value.as_deref(), Some("markdown"));
        assert!(parsed.is_structured_output_mode);
        assert!(parsed.has_invalid_output_format());
    }

    #[test]
    fn help_style_invocations_still_resolve_root_help() {
        let _env = mode_env(None, None);
        let parsed = parse_root_argv(&argv(&["help"]));
        assert!(parsed.is_help_like);
        assert!(parsed.is_root_help_invocation);
        assert_eq!(parsed.non_option_tokens, vec!["help".to_string()]);
    }

    #[test]
    fn detail_pools_invocation_is_not_welcome() {
        let _env = mode_env(None, None);
        let parsed = parse_root_argv(&argv(&["pools", "ETH"]));
        assert_eq!(parsed.first_command_token.as_deref(), Some("pools"));
        assert!(!is_welcome_flag_only_invocation(&argv(&["pools", "ETH"])));
    }

    #[test]
    fn global_option_helpers_read_split_and_inline_values() {
        let _env = mode_env(None, None);
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
        let _env = mode_env(None, None);
        let args = argv(&["--json", "--", "--chain", "mainnet"]);
        let parsed = parse_root_argv(&args);

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
            "pools",
            "stats",
        ]);

        assert_eq!(
            all_non_option_tokens(&args),
            vec!["pools".to_string(), "stats".to_string()]
        );
        assert_eq!(
            read_short_option_value(&argv(&["-c", "mainnet"]), "-c"),
            Some("mainnet".to_string())
        );
        assert_eq!(
            read_long_option_value(&argv(&["--output=json"]), "--output"),
            Some("json".to_string())
        );
    }

    #[test]
    fn welcome_detection_accepts_safe_flags_and_rejects_missing_values() {
        let _env = mode_env(None, None);
        let quiet_welcome = parse_root_argv(&argv(&["-q", "--no-banner"]));
        assert!(quiet_welcome.is_quiet);
        assert!(is_welcome_flag_only_invocation(&argv(&[
            "-q",
            "--no-banner"
        ])));

        assert!(!is_welcome_flag_only_invocation(&argv(&["--chain"])));

        assert!(!is_welcome_flag_only_invocation(&argv(&[
            "status", "--quiet"
        ])));
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
