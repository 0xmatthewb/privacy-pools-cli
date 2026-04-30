use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value};

use crate::bridge::forward_to_js_worker;
use crate::completion::{
    detect_completion_shell, parse_completion_query, parse_completion_script_spec,
};
use crate::contract::{CompletionCommandSpec, CompletionOptionSpec, Manifest};
use crate::error::CliError;
use crate::output::{
    print_json_success, render_next_steps, write_stderr_human_block_text, write_stderr_human_text,
    write_stdout_text,
};
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
        print_json_success(manifest.guide_structured_payload.clone());
        return Ok(0);
    }

    if is_static_quiet_mode(parsed) {
        return Ok(0);
    }

    write_stderr_human_block_text(manifest.guide_human_text.trim_end());
    Ok(0)
}

pub fn handle_capabilities(parsed: &ParsedRootArgv, manifest: &Manifest) -> Result<i32, CliError> {
    guard_csv_unsupported(parsed, "capabilities")?;

    if parsed.non_option_tokens.len() > 1 {
        return forward_to_js_worker(&parsed.argv);
    }

    if parsed.is_structured_output_mode {
        let mut payload = manifest.capabilities_payload.clone();
        if let Some(runtime) = payload.get_mut("runtime").and_then(Value::as_object_mut) {
            runtime.insert("runtime".to_string(), Value::String("native".to_string()));
        }
        print_json_success(payload);
        return Ok(0);
    }

    if is_static_quiet_mode(parsed) {
        return Ok(0);
    }

    write_stderr_human_text(manifest.capabilities_human_text.trim_end());
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
        return Err(CliError::input(
            "Missing command path for describe.".to_string(),
            Some(format!(
                "Valid command paths: {}",
                manifest.command_paths.join(", ")
            )),
        ));
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
    write_stderr_human_block_text(text.trim_end());
    Ok(0)
}

pub fn handle_completion(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    guard_csv_unsupported(parsed, "completion")?;

    if let Some(query) = parse_completion_query(argv)? {
        let candidates = query_completion_candidates(&query.words, query.cword, manifest);

        if parsed.is_structured_output_mode {
            let mut install_options = Map::new();
            install_options.insert("agent".to_string(), Value::Bool(true));
            install_options.insert("install".to_string(), Value::Bool(true));
            print_json_success(json!({
                "mode": "completion-query",
                "shell": query.shell,
                "cword": query.cword,
                "candidates": candidates,
                "nextActions": [crate::output::build_next_action(
                    "completion",
                    "Install managed shell completion after validating the generated candidates.",
                    "after_completion",
                    None,
                    Some(&install_options),
                    None,
                )],
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
    if spec.install {
        return forward_to_js_worker(argv);
    }
    let mut install_options = Map::new();
    install_options.insert("install".to_string(), Value::Bool(true));
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
            "nextActions": [crate::output::build_next_action(
                "completion",
                "Use the managed installer instead of wiring the script by hand if you want the CLI to update shell config automatically.",
                "after_completion",
                None,
                Some(&install_options),
                None,
            )],
        }));
    } else {
        write_stdout_text(&script);
        if !is_static_quiet_mode(parsed) {
            render_next_steps(&[crate::output::build_next_action(
                "completion",
                "Use the managed installer instead if you want the CLI to update shell config automatically.",
                "after_completion",
                None,
                Some(&install_options),
                None,
            )]);
        }
    }

    Ok(0)
}

pub fn commander_unknown_option_error(token: &str, command_options: &[&str]) -> CliError {
    let available_options = available_options_for_error(command_options);
    let unknown_option = token.starts_with("--").then(|| token.to_ascii_lowercase());
    let suggestions = unknown_option
        .as_deref()
        .map(|option| did_you_mean_many(option, &available_options, 3, 3))
        .unwrap_or_default();
    let mut details = Map::new();
    if let Some(option) = unknown_option {
        details.insert("unknownOption".to_string(), Value::String(option));
    }
    details.insert(
        "availableOptions".to_string(),
        Value::Array(
            available_options
                .into_iter()
                .map(Value::String)
                .collect::<Vec<_>>(),
        ),
    );
    details.insert(
        "suggestions".to_string(),
        Value::Array(suggestions.into_iter().map(Value::String).collect()),
    );

    CliError::new(
        crate::error::ErrorCategory::Input,
        format!("unknown option '{token}'"),
        Some("Use --help to see usage and examples.".to_string()),
        Some("INPUT_UNKNOWN_OPTION"),
        false,
    )
    .with_details(Value::Object(details))
}

fn available_options_for_error(command_options: &[&str]) -> Vec<String> {
    let mut options = crate::root_argv::available_global_long_options()
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    options.extend(command_options.iter().map(|option| (*option).to_string()));
    options.into_iter().collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let mut previous = (0..=b.chars().count()).collect::<Vec<_>>();
    let mut current = vec![0; previous.len()];

    for (i, left) in a.chars().enumerate() {
        current[0] = i + 1;
        for (j, right) in b.chars().enumerate() {
            let substitution = if left == right { 0 } else { 1 };
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + substitution);
        }
        std::mem::swap(&mut previous, &mut current);
    }

    previous[b.chars().count()]
}

fn did_you_mean_many(
    input: &str,
    candidates: &[String],
    max_distance: usize,
    limit: usize,
) -> Vec<String> {
    let lower = input.to_ascii_lowercase();
    let mut matches = candidates
        .iter()
        .filter_map(|candidate| {
            let distance = levenshtein(&lower, &candidate.to_ascii_lowercase());
            (distance <= max_distance).then(|| (candidate.clone(), distance))
        })
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
    matches
        .into_iter()
        .take(limit)
        .map(|(candidate, _)| candidate)
        .collect()
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
    CliError::new(
        crate::error::ErrorCategory::Input,
        format!(
            "too many arguments for '{command_name}'. Expected {expected_args} {noun} but got {received_args}."
        ),
        Some("Use --help to see usage and examples.".to_string()),
        Some("INPUT_PARSE_ERROR"),
        false,
    )
}

fn guard_csv_unsupported(parsed: &ParsedRootArgv, command_name: &str) -> Result<(), CliError> {
    if parsed.is_csv_mode {
        return Err(CliError::input(
            format!("--output csv is not supported for '{command_name}'."),
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
    manifest: &Manifest,
) -> Vec<String> {
    let root_spec = &manifest.completion_spec;
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

    let (current, command_path, expecting_value_for) =
        resolve_completion_context(&tree, &words, cword);

    if current_token.starts_with('-') && current_token.contains('=') {
        let mut parts = current_token.splitn(2, '=');
        let flag = parts.next().unwrap_or_default();
        let value_prefix = parts.next().unwrap_or_default();
        if let Some(option) = find_completion_option(flag, &current, &tree) {
            if is_json_fields_option(&option) {
                return complete_json_fields_value(&command_path, value_prefix, manifest)
                    .into_iter()
                    .map(|value| format!("{flag}={value}"))
                    .collect();
            }
            if !option.values.is_empty() {
                return filter_completion_candidates(option.values.clone(), value_prefix)
                    .into_iter()
                    .map(|value| format!("{flag}={value}"))
                    .collect();
            }
        }
    }

    if let Some(option) = expecting_value_for {
        if is_json_fields_option(&option) {
            return complete_json_fields_value(&command_path, &current_token, manifest);
        }
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
) -> (CompletionNode, Vec<String>, Option<CompletionOptionSpec>) {
    let mut current = root.clone();
    let mut command_path = vec![];
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
                if !token.contains('=')
                    && (option.takes_value
                        || (is_json_fields_option(&option) && !command_path.is_empty()))
                {
                    expecting_value_for = Some(option);
                }
            }
            continue;
        }

        if let Some(subcommand) = current.subcommands.get(token) {
            current = subcommand.clone();
            command_path.push(token.clone());
        }
    }

    (current, command_path, expecting_value_for)
}

fn is_json_fields_option(option: &CompletionOptionSpec) -> bool {
    option
        .names
        .iter()
        .any(|name| name == "--json-fields" || name == "--json" || name == "-j")
}

fn json_field_candidates(command_path: &[String], manifest: &Manifest) -> Vec<String> {
    let mut candidates = vec![
        "schemaVersion".to_string(),
        "success".to_string(),
        "errorCode".to_string(),
        "errorMessage".to_string(),
        "error".to_string(),
        "nextActions".to_string(),
    ];
    let path = command_path.join(" ");
    if let Some(json_fields) = manifest
        .capabilities_payload
        .get("commandDetails")
        .and_then(|details| details.get(&path))
        .and_then(|details| details.get("jsonFields"))
        .and_then(Value::as_str)
    {
        for raw_token in json_fields.split(',') {
            if let Some(name) = extract_json_field_name(raw_token) {
                candidates.push(name);
            }
        }
    }
    filter_completion_candidates(candidates, "")
}

fn extract_json_field_name(raw_token: &str) -> Option<String> {
    let token = raw_token
        .trim()
        .trim_start_matches(|character: char| {
            character == '{' || character == '[' || character.is_whitespace()
        })
        .trim_start();
    let mut characters = token.chars();
    let first = characters.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }

    let mut name = first.to_string();
    for character in characters {
        if character.is_ascii_alphanumeric() {
            name.push(character);
        } else {
            break;
        }
    }
    Some(name)
}

fn complete_json_fields_value(
    command_path: &[String],
    raw_value: &str,
    manifest: &Manifest,
) -> Vec<String> {
    let parts: Vec<&str> = raw_value.split(',').collect();
    let current = parts.last().map(|value| value.trim()).unwrap_or_default();
    let selected = parts
        .iter()
        .take(parts.len().saturating_sub(1))
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<HashSet<_>>();
    let prefix = if selected.is_empty() {
        String::new()
    } else {
        format!(
            "{},",
            parts
                .iter()
                .take(parts.len().saturating_sub(1))
                .map(|part| part.trim())
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(",")
        )
    };
    let candidates = json_field_candidates(command_path, manifest)
        .into_iter()
        .filter(|field| !selected.contains(field))
        .collect();
    filter_completion_candidates(candidates, current)
        .into_iter()
        .map(|field| format!("{prefix}{field}"))
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::manifest;
    use crate::root_argv::parse_root_argv;

    fn argv(tokens: &[&str]) -> Vec<String> {
        tokens.iter().map(|value| value.to_string()).collect()
    }

    #[derive(Debug, serde::Deserialize)]
    struct SharedCompletionQueryCase {
        name: String,
        words: Vec<String>,
        cword: usize,
        expected: Vec<String>,
    }

    fn shared_completion_query_cases() -> Vec<SharedCompletionQueryCase> {
        serde_json::from_str(include_str!(
            "../../../test/fixtures/completion-query-cases.json"
        ))
        .expect("shared completion query fixture must deserialize")
    }

    fn parsed(tokens: &[&str]) -> ParsedRootArgv {
        parse_root_argv(&argv(tokens))
    }

    #[test]
    fn guide_and_capabilities_reject_csv() {
        let manifest = manifest();
        let guide_error = handle_guide(&parsed(&["--output", "csv", "guide"]), manifest)
            .expect_err("guide csv should fail");
        assert_eq!(guide_error.code, "INPUT_ERROR");

        let capabilities_error =
            handle_capabilities(&parsed(&["--output", "csv", "capabilities"]), manifest)
                .expect_err("capabilities csv should fail");
        assert_eq!(capabilities_error.code, "INPUT_ERROR");
    }

    #[test]
    fn guide_and_capabilities_quiet_modes_short_circuit() {
        let manifest = manifest();
        assert_eq!(
            handle_guide(&parsed(&["--quiet", "guide"]), manifest).unwrap(),
            0
        );
        assert_eq!(
            handle_capabilities(&parsed(&["--quiet", "capabilities"]), manifest).unwrap(),
            0
        );
    }

    #[test]
    fn describe_reports_unknown_paths_and_missing_descriptors() {
        let manifest = manifest();
        let missing = handle_describe(&parsed(&["describe"]), manifest)
            .expect_err("missing path should fail");
        assert_eq!(missing.code, "INPUT_ERROR");
        assert!(missing
            .message
            .contains("Missing command path for describe"));
        assert!(missing
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("Valid command paths:"));

        let unknown = handle_describe(&parsed(&["describe", "missing"]), manifest)
            .expect_err("unknown path should fail");
        assert_eq!(unknown.code, "INPUT_ERROR");
        assert!(unknown.message.contains("Unknown command path"));

        let mut broken_manifest = manifest.clone();
        broken_manifest.capabilities_payload = json!({
            "commandDetails": {}
        });
        let missing_descriptor = handle_describe(
            &parsed(&["--agent", "describe", "withdraw", "quote"]),
            &broken_manifest,
        )
        .expect_err("missing descriptor should fail");
        assert_eq!(missing_descriptor.code, "UNKNOWN_ERROR");
    }

    #[test]
    fn completion_queries_filter_and_sort_candidates() {
        let manifest = manifest();
        let candidates =
            query_completion_candidates(&argv(&["privacy-pools", "pools", "s"]), Some(2), manifest);

        assert!(candidates.contains(&"show".to_string()));
        assert!(candidates.contains(&"stats".to_string()));
        assert!(!candidates.contains(&"activity".to_string()));
    }

    #[test]
    fn completion_queries_match_shared_parity_fixture() {
        let manifest = manifest();
        for test_case in shared_completion_query_cases() {
            assert_eq!(
                query_completion_candidates(&test_case.words, Some(test_case.cword), manifest),
                test_case.expected,
                "completion query mismatch for {}",
                test_case.name
            );
        }
    }

    #[test]
    fn completion_script_missing_shell_is_unknown_error() {
        let mut broken_manifest = manifest().clone();
        broken_manifest.completion_scripts.clear();
        let error = handle_completion(
            &argv(&["completion", "bash"]),
            &parsed(&["completion", "bash"]),
            &broken_manifest,
        )
        .expect_err("missing completion script should fail");

        assert_eq!(error.code, "UNKNOWN_ERROR");
        assert!(error.message.contains("Missing completion script"));
    }

    #[test]
    fn completion_helpers_cover_word_normalization_and_context() {
        let command_name = "privacy-pools".to_string();
        let normalized = normalize_completion_words(
            &argv(&["privacy-pools", "pools", "stats"]),
            &command_name,
            std::slice::from_ref(&command_name),
        );
        assert_eq!(normalized, argv(&["privacy-pools", "pools", "stats"]));

        let inserted = normalize_completion_words(
            &argv(&["pools", "stats"]),
            &command_name,
            std::slice::from_ref(&command_name),
        );
        assert_eq!(inserted, argv(&["privacy-pools", "pools", "stats"]));

        assert_eq!(normalize_completion_cword(Some(99), 2), 2);
        assert_eq!(normalize_completion_cword(None, 0), 0);

        let root = build_completion_tree(&manifest().completion_spec);
        let (current, _, expecting_value_for) = resolve_completion_context(
            &root,
            &argv(&["privacy-pools", "completion", "--shell"]),
            3,
        );
        assert!(current
            .options
            .iter()
            .any(|option| { option.names.iter().any(|name| name == "--shell") }));
        assert!(expecting_value_for
            .as_ref()
            .is_some_and(|option| option.names.iter().any(|name| name == "--shell")));
    }

    #[test]
    fn merged_options_and_candidate_filtering_stay_deterministic() {
        let root = CompletionNode {
            options: vec![CompletionOptionSpec {
                names: vec!["--help".to_string()],
                takes_value: false,
                values: vec![],
            }],
            subcommands: HashMap::new(),
        };
        let current = CompletionNode {
            options: vec![
                CompletionOptionSpec {
                    names: vec!["--help".to_string()],
                    takes_value: false,
                    values: vec![],
                },
                CompletionOptionSpec {
                    names: vec!["--shell".to_string()],
                    takes_value: true,
                    values: vec!["bash".to_string(), "zsh".to_string()],
                },
            ],
            subcommands: HashMap::new(),
        };

        let merged = merged_completion_options(&current, &root);
        assert_eq!(merged.len(), 2);
        assert!(find_completion_option("--shell", &current, &root).is_some());

        let filtered = filter_completion_candidates(
            vec![
                "--Shell".to_string(),
                "--shell".to_string(),
                "--agent".to_string(),
                "--shell".to_string(),
            ],
            "--s",
        );
        assert_eq!(filtered, vec!["--shell".to_string()]);
    }

    #[test]
    fn commander_error_helpers_match_commander_style() {
        let unknown = commander_unknown_option_error("--weird", &["--search"]);
        assert_eq!(unknown.code, "INPUT_UNKNOWN_OPTION");
        assert!(unknown.message.contains("unknown option '--weird'"));
        let details = unknown
            .details
            .as_deref()
            .and_then(Value::as_object)
            .expect("unknown option details");
        assert_eq!(
            details.get("unknownOption").and_then(Value::as_str),
            Some("--weird"),
        );
        assert!(details
            .get("availableOptions")
            .and_then(Value::as_array)
            .is_some_and(|options| options.contains(&Value::String("--search".to_string()))));

        let too_many = commander_too_many_arguments_error("pools", 1, 3);
        assert_eq!(too_many.code, "INPUT_PARSE_ERROR");
        assert!(too_many.message.contains("too many arguments"));
    }
}
