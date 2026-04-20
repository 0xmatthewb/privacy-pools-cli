mod support;

use regex::Regex;
use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::path::PathBuf;
use support::{
    launch_fixture_server, parse_stdout_json, run_native_with_env, stderr_string, stdout_string,
};

#[derive(Clone, Copy)]
enum EnvMode {
    None,
    Fixture,
}

#[derive(Clone, Copy)]
enum StreamKind {
    Stdout,
    Stderr,
}

struct TextGoldenCase {
    name: &'static str,
    args: &'static [&'static str],
    env_mode: EnvMode,
    status: i32,
    stream: StreamKind,
}

struct JsonGoldenCase {
    name: &'static str,
    args: &'static [&'static str],
    env_mode: EnvMode,
    status: i32,
}

fn golden_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/golden")
}

fn golden_path(name: &str, ext: &str) -> PathBuf {
    golden_root().join(format!("{name}.golden.{ext}"))
}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("golden regex should compile")
}

fn normalize_text(value: &str) -> (String, BTreeSet<&'static str>) {
    let mut applied = BTreeSet::new();
    let mut normalized = value.replace("\r\n", "\n");

    let ts = regex(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b");
    if ts.is_match(&normalized) {
        applied.insert("TS");
        normalized = ts.replace_all(&normalized, "<TS>").into_owned();
    }

    let hash = regex(r"0x[a-fA-F0-9]{64}\b");
    if hash.is_match(&normalized) {
        applied.insert("HASH");
        normalized = hash.replace_all(&normalized, "<HASH>").into_owned();
    }

    let addr = regex(r"0x[a-fA-F0-9]{40}\b");
    if addr.is_match(&normalized) {
        applied.insert("ADDR");
        normalized = addr.replace_all(&normalized, "<ADDR>").into_owned();
    }

    let block = regex(r"\b(Block(?: number)?\s*:\s*)\d+\b");
    if block.is_match(&normalized) {
        applied.insert("BLOCK");
        normalized = block.replace_all(&normalized, "${1}<BLOCK>").into_owned();
    }

    let trailing_space = regex(r"[ \t]+\n");
    normalized = trailing_space.replace_all(&normalized, "\n").into_owned();

    let extra_breaks = regex(r"\n{3,}");
    normalized = extra_breaks.replace_all(&normalized, "\n\n").into_owned();

    if !normalized.ends_with('\n') {
        normalized.push('\n');
    }

    (normalized, applied)
}

fn is_block_key(key: &str) -> bool {
    matches!(
        key,
        "blockNumber"
            | "depositBlockNumber"
            | "ragequitBlockNumber"
            | "rpcBlockNumber"
            | "withdrawBlockNumber"
    )
}

fn is_wei_key(key: &str) -> bool {
    matches!(
        key,
        "acceptedDepositsValue"
            | "amount"
            | "committedValue"
            | "depositAmount"
            | "estimatedCommittedValue"
            | "feeAmount"
            | "minimumDeposit"
            | "minWithdrawAmount"
            | "netAmount"
            | "pendingDepositsValue"
            | "remainingBalance"
            | "requiredNativeFunding"
            | "requiredTokenFunding"
            | "totalDepositsValue"
            | "totalInPoolValue"
            | "totalWithdrawalsValue"
            | "value"
            | "vettingFee"
    )
}

fn normalize_json_value(
    value: Value,
    applied: &mut BTreeSet<&'static str>,
    key: Option<&str>,
) -> Value {
    match value {
        Value::Array(entries) => Value::Array(
            entries
                .into_iter()
                .map(|entry| normalize_json_value(entry, applied, None))
                .collect(),
        ),
        Value::Object(entries) => {
            let mut sorted_keys = entries.keys().cloned().collect::<Vec<_>>();
            sorted_keys.sort();
            let mut normalized = Map::new();
            for child_key in sorted_keys {
                let child_value = entries
                    .get(&child_key)
                    .cloned()
                    .expect("sorted child key should exist");
                normalized.insert(
                    child_key.clone(),
                    normalize_json_value(child_value, applied, Some(&child_key)),
                );
            }
            Value::Object(normalized)
        }
        Value::Number(number) if key.is_some_and(is_block_key) => {
            applied.insert("BLOCK");
            Value::String("<BLOCK>".to_string())
        }
        Value::String(text) => {
            if key.is_some_and(is_block_key) && text.chars().all(|ch| ch.is_ascii_digit()) {
                applied.insert("BLOCK");
                return Value::String("<BLOCK>".to_string());
            }

            if key.is_some_and(is_wei_key) && text.chars().all(|ch| ch.is_ascii_digit()) {
                applied.insert("WEI");
                return Value::String("<WEI>".to_string());
            }

            let mut normalized = text;
            let ts = regex(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b");
            if ts.is_match(&normalized) {
                applied.insert("TS");
                normalized = ts.replace_all(&normalized, "<TS>").into_owned();
            }

            let hash = regex(r"0x[a-fA-F0-9]{64}\b");
            if hash.is_match(&normalized) {
                applied.insert("HASH");
                normalized = hash.replace_all(&normalized, "<HASH>").into_owned();
            }

            let addr = regex(r"0x[a-fA-F0-9]{40}\b");
            if addr.is_match(&normalized) {
                applied.insert("ADDR");
                normalized = addr.replace_all(&normalized, "<ADDR>").into_owned();
            }

            Value::String(normalized)
        }
        other => other,
    }
}

fn render_text_golden(value: &str) -> String {
    let (normalized, applied) = normalize_text(value);
    let header = if applied.is_empty() {
        "// normalized: NONE".to_string()
    } else {
        format!(
            "// normalized: {}",
            applied.into_iter().collect::<Vec<_>>().join(", ")
        )
    };
    format!("{header}\n{normalized}")
}

fn render_json_golden(value: Value) -> String {
    let mut applied = BTreeSet::new();
    let normalized = normalize_json_value(value, &mut applied, None);
    let header = if applied.is_empty() {
        "// normalized: NONE".to_string()
    } else {
        format!(
            "// normalized: {}",
            applied.into_iter().collect::<Vec<_>>().join(", ")
        )
    };
    let body = serde_json::to_string_pretty(&normalized).expect("normalized json should serialize");
    format!("{header}\n{body}\n")
}

fn expect_text_golden(name: &str, actual: &str) {
    let expected = std::fs::read_to_string(golden_path(name, "txt"))
        .unwrap_or_else(|error| panic!("missing text golden for {name}: {error}"));
    let rendered = render_text_golden(actual);
    assert_eq!(expected, rendered, "text golden mismatch for {name}");
}

fn expect_json_golden(name: &str, actual: Value) {
    let expected = std::fs::read_to_string(golden_path(name, "json"))
        .unwrap_or_else(|error| panic!("missing json golden for {name}: {error}"));
    let rendered = render_json_golden(actual);
    assert_eq!(expected, rendered, "json golden mismatch for {name}");
}

fn text_cases() -> Vec<TextGoldenCase> {
    vec![
        TextGoldenCase {
            name: "cli/root-help",
            args: &["--help"],
            env_mode: EnvMode::None,
            status: 0,
            stream: StreamKind::Stdout,
        },
        TextGoldenCase {
            name: "cli/version",
            args: &["--version"],
            env_mode: EnvMode::None,
            status: 0,
            stream: StreamKind::Stdout,
        },
        TextGoldenCase {
            name: "withdraw/quote-help",
            args: &["withdraw", "quote", "--help"],
            env_mode: EnvMode::None,
            status: 0,
            stream: StreamKind::Stdout,
        },
        TextGoldenCase {
            name: "guide/index-human",
            args: &["guide"],
            env_mode: EnvMode::None,
            status: 0,
            stream: StreamKind::Stderr,
        },
        TextGoldenCase {
            name: "pools/sepolia-human",
            args: &["--chain", "sepolia", "pools"],
            env_mode: EnvMode::Fixture,
            status: 0,
            stream: StreamKind::Stderr,
        },
    ]
}

fn json_cases() -> Vec<JsonGoldenCase> {
    vec![
        JsonGoldenCase {
            name: "cli/root-help-json",
            args: &["--json", "--help"],
            env_mode: EnvMode::None,
            status: 0,
        },
        JsonGoldenCase {
            name: "cli/version-json",
            args: &["--json", "--version"],
            env_mode: EnvMode::None,
            status: 0,
        },
        JsonGoldenCase {
            name: "guide/index-agent",
            args: &["--agent", "guide"],
            env_mode: EnvMode::None,
            status: 0,
        },
        JsonGoldenCase {
            name: "capabilities/agent",
            args: &["--agent", "capabilities"],
            env_mode: EnvMode::None,
            status: 0,
        },
        JsonGoldenCase {
            name: "completion/query-bash-agent",
            args: &[
                "--json",
                "completion",
                "--query",
                "--shell",
                "bash",
                "--cword",
                "1",
                "--",
                "privacy-pools",
            ],
            env_mode: EnvMode::None,
            status: 0,
        },
        JsonGoldenCase {
            name: "pools/sepolia-agent",
            args: &["--agent", "--chain", "sepolia", "pools"],
            env_mode: EnvMode::Fixture,
            status: 0,
        },
    ]
}

#[test]
fn native_human_outputs_match_shared_goldens() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();

    for case in text_cases() {
        let base_env = [("LANG", "en_US.UTF-8"), ("COLUMNS", "120")];
        let output = match case.env_mode {
            EnvMode::None => run_native_with_env(case.args, &base_env),
            EnvMode::Fixture => {
                let env = [
                    ("LANG", "en_US.UTF-8"),
                    ("COLUMNS", "120"),
                    ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
                    ("PRIVACY_POOLS_RPC_URL_SEPOLIA", rpc_url.as_str()),
                ];
                run_native_with_env(case.args, &env)
            }
        };

        assert_eq!(
            output.status.code(),
            Some(case.status),
            "unexpected status for {}",
            case.name
        );

        match case.stream {
            StreamKind::Stdout => {
                assert!(stderr_string(&output).is_empty(), "stderr should be empty for {}", case.name);
                expect_text_golden(case.name, &stdout_string(&output));
            }
            StreamKind::Stderr => {
                assert!(stdout_string(&output).is_empty(), "stdout should be empty for {}", case.name);
                expect_text_golden(case.name, &stderr_string(&output));
            }
        }
    }
}

#[test]
fn native_json_outputs_match_shared_goldens() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();

    for case in json_cases() {
        let output = match case.env_mode {
            EnvMode::None => run_native_with_env(case.args, &[("LANG", "en_US.UTF-8")]),
            EnvMode::Fixture => {
                let env = [
                    ("LANG", "en_US.UTF-8"),
                    ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
                    ("PRIVACY_POOLS_RPC_URL_SEPOLIA", rpc_url.as_str()),
                ];
                run_native_with_env(case.args, &env)
            }
        };

        assert_eq!(
            output.status.code(),
            Some(case.status),
            "unexpected status for {}",
            case.name
        );
        assert!(
            stderr_string(&output).is_empty(),
            "stderr should be empty for {}",
            case.name
        );
        expect_json_golden(case.name, parse_stdout_json(&output));
    }
}
