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

pub(crate) fn parse_completion_query(argv: &[String]) -> Result<Option<CompletionQuerySpec>, CliError> {
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

pub(crate) fn parse_completion_script_spec(argv: &[String]) -> Result<CompletionScriptSpec, CliError> {
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
    let shell = env::var("SHELL").unwrap_or_default().to_lowercase();
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
