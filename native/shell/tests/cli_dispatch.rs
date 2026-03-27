mod support;

use serde_json::Value;
use support::{
    missing_worker_path, parse_stdout_json, run_native, run_native_with_env, stderr_string,
    stdout_string,
};

#[test]
fn root_help_and_version_stay_on_stdout() {
    let help = run_native(&["--help"]);
    assert!(help.status.success());
    assert!(stdout_string(&help).contains("privacy-pools"));
    assert!(stderr_string(&help).is_empty());

    let version = run_native(&["--version"]);
    assert!(version.status.success());
    assert_eq!(stdout_string(&version).trim(), env!("CARGO_PKG_VERSION"));
    assert!(stderr_string(&version).is_empty());
}

#[test]
fn guide_keeps_human_output_on_stderr() {
    let output = run_native(&["guide"]);
    assert!(output.status.success());
    assert!(stdout_string(&output).is_empty());
    assert!(stderr_string(&output).contains("Privacy Pools: Quick Guide"));
}

#[test]
fn quiet_capabilities_stays_silent() {
    let output = run_native(&["--quiet", "capabilities"]);
    assert!(output.status.success());
    assert!(stdout_string(&output).trim().is_empty());
    assert!(stderr_string(&output).trim().is_empty());
}

#[test]
fn machine_mode_beats_csv_for_native_discovery_commands() {
    let guide = run_native(&["--agent", "--format", "csv", "guide"]);
    assert!(guide.status.success());
    assert!(stderr_string(&guide).trim().is_empty());
    let guide_json = parse_stdout_json(&guide);
    assert_eq!(guide_json["success"], Value::Bool(true));
    assert_eq!(guide_json["mode"], Value::String("help".to_string()));

    let capabilities = run_native(&["--json", "--format", "csv", "capabilities"]);
    assert!(capabilities.status.success());
    assert!(stderr_string(&capabilities).trim().is_empty());
    let capabilities_json = parse_stdout_json(&capabilities);
    assert_eq!(capabilities_json["success"], Value::Bool(true));
    assert!(capabilities_json["commands"].is_array());
}

#[test]
fn completion_contracts_hold_for_human_and_agent_modes() {
    let human = run_native(&["completion", "bash"]);
    assert!(human.status.success());
    assert!(stdout_string(&human).contains("_privacy_pools_completion"));
    assert!(stderr_string(&human).is_empty());

    let agent = run_native(&["--agent", "completion", "bash"]);
    assert!(agent.status.success());
    assert!(stderr_string(&agent).trim().is_empty());
    let payload = parse_stdout_json(&agent);
    assert_eq!(payload["success"], Value::Bool(true));
    assert_eq!(
        payload["mode"],
        Value::String("completion-script".to_string())
    );
    assert!(payload["completionScript"]
        .as_str()
        .unwrap_or_default()
        .contains("_privacy_pools_completion"));
}

#[test]
fn native_help_does_not_depend_on_the_js_worker() {
    let output = run_native_with_env(
        &["flow", "--help"],
        &[("PRIVACY_POOLS_CLI_JS_WORKER", &missing_worker_path())],
    );

    assert!(output.status.success());
    assert!(stdout_string(&output).contains("Usage: privacy-pools flow"));
    assert!(stderr_string(&output).is_empty());
}

#[test]
fn direct_binary_js_owned_commands_fail_cleanly_in_agent_mode() {
    let output = run_native(&["--agent", "status", "--no-check"]);

    assert_eq!(output.status.code(), Some(1));
    assert!(stderr_string(&output).trim().is_empty());

    let payload = parse_stdout_json(&output);
    assert_eq!(payload["success"], Value::Bool(false));
    assert_eq!(
        payload["errorCode"],
        Value::String("UNKNOWN_ERROR".to_string())
    );
    assert_eq!(
        payload["errorMessage"],
        Value::String("JS worker bootstrap is unavailable.".to_string())
    );
    assert_eq!(
        payload["error"]["hint"],
        Value::String(
            "Run the native shell through the npm launcher so it can forward JS-owned commands."
                .to_string(),
        )
    );
}
