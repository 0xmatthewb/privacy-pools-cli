mod support;

use serde::Deserialize;
use std::path::PathBuf;
use std::process;
use support::{
    launch_fixture_server, live_bridge_env, parse_stdout_json, run_native_with_env, stderr_string,
    stdout_string,
};

#[derive(Debug, Deserialize)]
struct ModeResolutionCase {
    name: String,
    argv: Vec<String>,
    #[serde(default)]
    env: std::collections::BTreeMap<String, String>,
    #[serde(default, rename = "seededHome")]
    seeded_home: bool,
    expected: ModeExpectation,
}

#[derive(Debug, Deserialize)]
struct ModeExpectation {
    status: i32,
    streams: StreamExpectation,
}

#[derive(Debug, Deserialize)]
struct StreamExpectation {
    stdout: StreamKind,
    stderr: StreamKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum StreamKind {
    Empty,
    Envelope,
    Prose,
}

fn fixture_cases() -> Vec<ModeResolutionCase> {
    serde_json::from_str(include_str!(
        "../../../test/fixtures/mode-resolution-cases.json"
    ))
    .expect("mode-resolution fixture should parse")
}

fn isolated_home(case_name: &str) -> String {
    let safe_name = case_name.replace(['/', '\\', ' '], "-");
    let path = std::env::temp_dir().join(format!("pp-native-mode-{}-{}", process::id(), safe_name));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("temp home should be creatable");
    path.to_string_lossy().into_owned()
}

fn seed_config_home(home: &str) {
    let config_home = PathBuf::from(home).join(".privacy-pools");
    std::fs::create_dir_all(&config_home).expect("config home should be creatable");
    std::fs::write(
        config_home.join("config.json"),
        "{\n  \"defaultChain\": \"sepolia\",\n  \"rpcOverrides\": {}\n}\n",
    )
    .expect("config should be written");
}

fn expect_stream(label: &str, value: &str, expected: StreamKind) {
    let trimmed = value.trim();
    match expected {
        StreamKind::Empty => assert!(trimmed.is_empty(), "{label} should be empty, got:\n{value}"),
        StreamKind::Envelope => {
            assert!(
                !trimmed.is_empty(),
                "{label} should contain a JSON envelope"
            );
            serde_json::from_str::<serde_json::Value>(trimmed)
                .unwrap_or_else(|err| panic!("{label} should parse as JSON: {err}\n{value}"));
        }
        StreamKind::Prose => {
            assert!(!trimmed.is_empty(), "{label} should contain prose");
            assert!(
                serde_json::from_str::<serde_json::Value>(trimmed).is_err(),
                "{label} should not be JSON"
            );
        }
    }
}

#[test]
fn native_mode_resolution_consumes_shared_fixture() {
    let fixture = launch_fixture_server();
    let (bridge_key, bridge_value) = live_bridge_env();

    for case in fixture_cases() {
        let home = isolated_home(&case.name);
        if case.seeded_home {
            seed_config_home(&home);
        }

        let mut env: Vec<(String, String)> = vec![
            (
                "PRIVACY_POOLS_HOME".to_string(),
                format!("{home}/.privacy-pools"),
            ),
            (bridge_key.clone(), bridge_value.clone()),
        ];
        for (key, value) in &case.env {
            env.push((
                key.clone(),
                if value == "<fixture>" {
                    fixture.base_url().to_string()
                } else {
                    value.clone()
                },
            ));
        }
        let env_refs: Vec<(&str, &str)> = env
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let argv_refs: Vec<&str> = case.argv.iter().map(String::as_str).collect();

        let output = run_native_with_env(&argv_refs, &env_refs);
        assert_eq!(
            output.status.code(),
            Some(case.expected.status),
            "status mismatch for {}",
            case.name
        );
        expect_stream(
            &format!("{} stdout", case.name),
            &stdout_string(&output),
            case.expected.streams.stdout,
        );
        expect_stream(
            &format!("{} stderr", case.name),
            &stderr_string(&output),
            case.expected.streams.stderr,
        );

        if case.expected.streams.stdout == StreamKind::Envelope {
            let payload = parse_stdout_json(&output);
            assert_eq!(
                payload["success"].is_boolean(),
                true,
                "{} stdout envelope should contain success",
                case.name
            );
        }
    }
}
