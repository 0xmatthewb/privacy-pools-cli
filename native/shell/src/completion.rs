use crate::root_argv::root_option_takes_value;
use crate::CliError;
use std::env;

#[derive(Debug, Clone)]
pub(crate) struct CompletionQuerySpec {
    pub(crate) shell: String,
    pub(crate) cword: Option<usize>,
    pub(crate) words: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct CompletionScriptSpec {
    pub(crate) shell: Option<String>,
}

pub(crate) fn parse_completion_query(
    argv: &[String],
) -> Result<Option<CompletionQuerySpec>, CliError> {
    let mut index = 0usize;
    while index < argv.len() {
        let token = &argv[index];
        if token == "completion" {
            index += 1;
            break;
        }

        if token == "--" {
            return Ok(None);
        }

        if token.starts_with("--") {
            if root_option_takes_value(token) && !token.contains('=') {
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        if token.starts_with('-') {
            if matches!(token.as_str(), "-c" | "-r") {
                index += 2;
            } else {
                index += 1;
            }
            continue;
        }

        return Ok(None);
    }

    if index >= argv.len() {
        return Ok(None);
    }

    let mut shell_flag: Option<String> = None;
    let mut shell_arg: Option<String> = None;
    let mut query = false;
    let mut cword_raw: Option<String> = None;
    let mut words: Option<Vec<String>> = None;

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            words = Some(argv[index + 1..].to_vec());
            break;
        }
        if token == "--query" {
            query = true;
            index += 1;
            continue;
        }
        if token == "--shell" || token == "-s" {
            let value = argv.get(index + 1).cloned().ok_or_else(|| {
                CliError::input(
                    "Missing shell value for completion command.",
                    Some("Use: privacy-pools completion [shell]".to_string()),
                )
            })?;
            shell_flag = Some(value);
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--shell=") {
            shell_flag = Some(value.to_string());
            index += 1;
            continue;
        }
        if token == "--cword" {
            let value = argv.get(index + 1).cloned().ok_or_else(|| {
                CliError::input(
                    "Missing --cword value.",
                    Some("Expected a non-negative integer.".to_string()),
                )
            })?;
            cword_raw = Some(value);
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--cword=") {
            cword_raw = Some(value.to_string());
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            return Ok(None);
        }
        if shell_arg.is_none() {
            shell_arg = Some(token.clone());
            index += 1;
            continue;
        }
        return Ok(None);
    }

    if !query || words.is_none() {
        return Ok(None);
    }
    if shell_flag.is_some() && shell_arg.is_some() && shell_flag != shell_arg {
        return Ok(None);
    }

    let shell = match shell_flag.or(shell_arg) {
        Some(value) => parse_completion_shell(&value)?,
        None => detect_completion_shell(),
    };
    let cword = match cword_raw {
        Some(raw) => Some(parse_non_negative_int(&raw, "--cword")? as usize),
        None => None,
    };

    Ok(Some(CompletionQuerySpec {
        shell,
        cword,
        words: words.unwrap_or_default(),
    }))
}

pub(crate) fn parse_completion_script_spec(
    argv: &[String],
) -> Result<CompletionScriptSpec, CliError> {
    let mut tokens = vec![];
    let mut index = 0usize;
    while index < argv.len() {
        let token = &argv[index];
        if !token.starts_with('-') {
            tokens.push(token.clone());
            index += 1;
            continue;
        }
        if root_option_takes_value(token) && !token.contains('=') {
            index += 2;
        } else {
            index += 1;
        }
    }

    if tokens.first().map(|value| value.as_str()) != Some("completion") {
        return forward_completion_to_js_as_error();
    }

    let mut index = argv
        .iter()
        .position(|token| token == "completion")
        .map(|value| value + 1)
        .unwrap_or(argv.len());
    let mut positional_shell: Option<String> = None;
    let mut shell_flag: Option<String> = None;

    while index < argv.len() {
        let token = &argv[index];
        if token == "--" {
            break;
        }
        if token == "--query" {
            index += 1;
            continue;
        }
        if token == "--shell" || token == "-s" {
            let value = argv.get(index + 1).cloned().ok_or_else(|| {
                CliError::input(
                    "Missing shell value for completion command.",
                    Some("Use: privacy-pools completion [shell]".to_string()),
                )
            })?;
            shell_flag = Some(parse_completion_shell(&value)?);
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--shell=") {
            shell_flag = Some(parse_completion_shell(value)?);
            index += 1;
            continue;
        }
        if token == "--cword" {
            index += 2;
            continue;
        }
        if token.starts_with("--cword=") {
            index += 1;
            continue;
        }
        if token.starts_with('-') {
            index += 1;
            continue;
        }
        if positional_shell.is_none() {
            positional_shell = Some(token.clone());
            index += 1;
            continue;
        }
        return Err(CliError::input(
            "Too many arguments for completion command.",
            Some("Use: privacy-pools completion [shell]".to_string()),
        ));
    }

    if let (Some(flag_shell), Some(positional_shell)) = (&shell_flag, &positional_shell) {
        if flag_shell != positional_shell {
            return Err(CliError::input(
                "Conflicting shell values from --shell and positional argument.",
                Some(
                    "Specify shell either as positional argument or via --shell, but not both."
                        .to_string(),
                ),
            ));
        }
    }

    let shell = match (shell_flag, positional_shell) {
        (Some(shell), _) => Some(shell),
        (None, Some(shell)) => Some(parse_completion_shell(&shell)?),
        (None, None) => None,
    };
    Ok(CompletionScriptSpec { shell })
}

pub(crate) fn parse_completion_shell(value: &str) -> Result<String, CliError> {
    match value {
        "bash" | "zsh" | "fish" | "powershell" => Ok(value.to_string()),
        _ => Err(CliError::input(
            format!("Unsupported shell '{value}'."),
            Some("Supported shells: bash, zsh, fish, powershell".to_string()),
        )),
    }
}

pub(crate) fn detect_completion_shell() -> String {
    let shell = env::var("SHELL").unwrap_or_default();
    detect_completion_shell_from_value(&shell)
}

fn detect_completion_shell_from_value(shell: &str) -> String {
    let shell = shell.to_lowercase();
    if shell.contains("zsh") {
        "zsh".to_string()
    } else if shell.contains("fish") {
        "fish".to_string()
    } else {
        "bash".to_string()
    }
}

fn forward_completion_to_js_as_error<T>() -> Result<T, CliError> {
    Err(CliError::input(
        "Invalid completion invocation.",
        Some("Use: privacy-pools completion [shell]".to_string()),
    ))
}

fn parse_non_negative_int(raw: &str, flag: &str) -> Result<u64, CliError> {
    raw.parse::<u64>().map_err(|_| {
        CliError::input(
            format!("Invalid {flag} value '{raw}'."),
            Some("Expected a non-negative integer.".to_string()),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn completion_query_ignores_machine_flags_and_csv_mix() {
        let query = parse_completion_query(&argv(&[
            "--agent",
            "--format",
            "csv",
            "completion",
            "--query",
            "bash",
            "--",
            "privacy-pools",
        ]));
        let spec = match query {
            Ok(Some(spec)) => spec,
            Ok(None) => panic!("query should be handled natively"),
            Err(_) => panic!("query should parse"),
        };

        assert_eq!(spec.shell, "bash");
        assert_eq!(spec.words, vec!["privacy-pools".to_string()]);
        assert_eq!(spec.cword, None);
    }

    #[test]
    fn completion_script_rejects_conflicting_shell_sources() {
        let error = parse_completion_script_spec(&argv(&["completion", "--shell", "bash", "zsh"]))
            .expect_err("conflicting shell sources should fail");

        assert_eq!(error.code, "INPUT_ERROR");
        assert!(error.message.contains("Conflicting shell values"));
    }

    #[test]
    fn completion_script_supports_positional_shell() {
        let spec = match parse_completion_script_spec(&argv(&["completion", "fish"])) {
            Ok(spec) => spec,
            Err(_) => panic!("positional shell should parse"),
        };
        assert_eq!(spec.shell.as_deref(), Some("fish"));
    }

    #[test]
    fn completion_query_returns_none_for_non_completion_commands() {
        let result = parse_completion_query(&argv(&["status", "--json"]));
        assert!(matches!(result, Ok(None)));
    }

    #[test]
    fn completion_query_requires_query_and_words() {
        assert!(matches!(
            parse_completion_query(&argv(&["completion", "bash"])),
            Ok(None)
        ));
        assert!(matches!(
            parse_completion_query(&argv(&["completion", "--query"])),
            Ok(None)
        ));
    }

    #[test]
    fn completion_query_rejects_unknown_flags_and_extra_positionals() {
        assert!(matches!(
            parse_completion_query(&argv(&[
                "completion",
                "--query",
                "--unknown",
                "--",
                "privacy-pools",
            ])),
            Ok(None)
        ));
        assert!(matches!(
            parse_completion_query(&argv(&[
                "completion",
                "--query",
                "bash",
                "fish",
                "--",
                "privacy-pools",
            ])),
            Ok(None)
        ));
    }

    #[test]
    fn completion_query_validates_shell_and_cword_inputs() {
        let missing_shell = parse_completion_query(&argv(&["completion", "--query", "--shell"]))
            .expect_err("missing shell value should fail");
        assert_eq!(missing_shell.code, "INPUT_ERROR");

        let missing_cword =
            parse_completion_query(&argv(&["completion", "--query", "bash", "--cword"]))
                .expect_err("missing cword value should fail");
        assert_eq!(missing_cword.code, "INPUT_ERROR");

        let invalid_cword = parse_completion_query(&argv(&[
            "completion",
            "--query",
            "--shell",
            "bash",
            "--cword",
            "abc",
            "--",
            "privacy-pools",
        ]))
        .expect_err("invalid cword should fail");
        assert_eq!(invalid_cword.code, "INPUT_ERROR");

        assert!(matches!(
            parse_completion_query(&argv(&[
                "completion",
                "--query",
                "--shell",
                "bash",
                "zsh",
                "--",
                "privacy-pools",
            ])),
            Ok(None)
        ));
    }

    #[test]
    fn completion_query_accepts_inline_shell_and_cword() {
        let result = parse_completion_query(&argv(&[
            "--chain",
            "mainnet",
            "completion",
            "--query",
            "--shell=zsh",
            "--cword=2",
            "--",
            "privacy-pools",
            "flow",
        ]));
        let spec = match result {
            Ok(Some(spec)) => spec,
            Ok(None) => panic!("inline completion query should stay native"),
            Err(_) => panic!("inline completion query should parse"),
        };

        assert_eq!(spec.shell, "zsh");
        assert_eq!(spec.cword, Some(2));
        assert_eq!(
            spec.words,
            vec!["privacy-pools".to_string(), "flow".to_string()]
        );
    }

    #[test]
    fn completion_script_rejects_invalid_invocations() {
        let not_completion = parse_completion_script_spec(&argv(&["status"]))
            .expect_err("non-completion should fail");
        assert_eq!(not_completion.code, "INPUT_ERROR");

        let missing_shell = parse_completion_script_spec(&argv(&["completion", "--shell"]))
            .expect_err("missing shell should fail");
        assert_eq!(missing_shell.code, "INPUT_ERROR");

        let too_many_args = parse_completion_script_spec(&argv(&["completion", "bash", "zsh"]))
            .expect_err("extra args should fail");
        assert_eq!(too_many_args.code, "INPUT_ERROR");

        let invalid_shell = parse_completion_script_spec(&argv(&["completion", "--shell", "tcsh"]))
            .expect_err("invalid shell should fail");
        assert_eq!(invalid_shell.code, "INPUT_ERROR");
    }

    #[test]
    fn completion_script_supports_flag_shell_and_ignores_query_args() {
        let result = parse_completion_script_spec(&argv(&[
            "--rpc-url",
            "https://rpc.example",
            "completion",
            "--query",
            "--cword",
            "2",
            "--shell=bash",
            "--",
            "privacy-pools",
        ]));
        let spec = match result {
            Ok(spec) => spec,
            Err(_) => panic!("script spec should parse"),
        };

        assert_eq!(spec.shell.as_deref(), Some("bash"));
    }

    #[test]
    fn completion_shell_detection_prefers_known_shells() {
        assert_eq!(detect_completion_shell_from_value("/bin/zsh"), "zsh");
        assert_eq!(detect_completion_shell_from_value("/usr/bin/fish"), "fish");
        assert_eq!(detect_completion_shell_from_value("/bin/bash"), "bash");
        assert_eq!(detect_completion_shell_from_value(""), "bash");
    }
}
