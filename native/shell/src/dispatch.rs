use std::collections::HashMap;

use serde_json::json;

use crate::bridge::forward_to_js_worker;
use crate::completion::{
    detect_completion_shell, parse_completion_query, parse_completion_script_spec,
};
use crate::contract::{CompletionCommandSpec, CompletionOptionSpec, Manifest};
use crate::error::CliError;
use crate::output::{print_json_success, write_stderr_block_text, write_stdout_text};
use crate::root_argv::ParsedRootArgv;
use crate::routing::{is_static_quiet_mode, resolve_command_path};

#[derive(Debug, Clone)]
struct CompletionNode {
    options: Vec<CompletionOptionSpec>,
    subcommands: HashMap<String, CompletionNode>,
}

pub fn handle_guide(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
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

pub fn handle_capabilities(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
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

pub fn handle_describe(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
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

pub fn handle_completion(
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

pub fn commander_unknown_option_error(token: &str) -> CliError {
    CliError::input(
        format!("unknown option '{token}'"),
        Some("Use --help to see usage and examples.".to_string()),
    )
}

pub fn commander_too_many_arguments_error(
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

fn guard_csv_unsupported(parsed: &ParsedRootArgv, command_name: &str) -> Result<(), CliError> {
    if parsed.is_csv_mode {
        return Err(CliError::input(
            format!("--format csv is not supported for '{command_name}'."),
            Some(format!(
                "CSV output is available for: {}.",
                crate::CSV_SUPPORTED_COMMANDS.join(", ")
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
