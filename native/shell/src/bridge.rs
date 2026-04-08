use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Deserialize;
use serde_json::json;
use std::env;
use std::process::{Command, ExitStatus, Stdio};

use crate::contract::runtime_contract;
use crate::error::CliError;

const ENV_JS_WORKER_PATH: &str = "PRIVACY_POOLS_CLI_JS_WORKER";

#[derive(Debug, Clone, Deserialize)]
struct JsBridgeDescriptor {
    #[serde(rename = "runtimeVersion")]
    runtime_version: String,
    #[serde(rename = "workerProtocolVersion")]
    worker_protocol_version: String,
    #[serde(rename = "nativeBridgeVersion")]
    native_bridge_version: String,
    #[serde(rename = "workerRequestEnv")]
    worker_request_env: String,
    #[serde(rename = "workerCommand")]
    worker_command: String,
    #[serde(rename = "workerArgs")]
    worker_args: Vec<String>,
}

pub fn forward_to_js_worker(argv: &[String]) -> Result<i32, CliError> {
    let (worker_command, worker_args, worker_request_env, worker_protocol_version) =
        resolve_js_worker_launch()?;
    let encoded_request = encode_worker_request(argv, &worker_protocol_version)?;

    let mut child = Command::new(worker_command);
    child
        .args(worker_args)
        .env(worker_request_env, encoded_request)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let status = child.status().map_err(|error| {
        CliError::unknown(
            format!("Failed to launch JS worker: {error}"),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        )
    })?;

    Ok(exit_code_from_status(status))
}

pub fn capture_js_worker_stdout(argv: &[String]) -> Result<String, CliError> {
    let (worker_command, worker_args, worker_request_env, worker_protocol_version) =
        resolve_js_worker_launch()?;
    let encoded_request = encode_worker_request(argv, &worker_protocol_version)?;

    let output = Command::new(worker_command)
        .args(worker_args)
        .env(worker_request_env, encoded_request)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            CliError::unknown(
                format!("Failed to launch JS worker: {error}"),
                Some("Reinstall the CLI or disable native mode and retry.".to_string()),
            )
        })?;

    let exit_code = exit_code_from_status(output.status);
    if exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(CliError::unknown(
            format!(
                "JS worker request failed with exit code {exit_code}.{}",
                if stderr.trim().is_empty() {
                    String::new()
                } else {
                    format!(" {stderr}")
                }
            ),
            Some("Disable native mode and retry if the problem persists.".to_string()),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn resolve_js_worker_launch() -> Result<(String, Vec<String>, String, String), CliError> {
    let runtime_contract = runtime_contract();
    let bridge = env::var(&runtime_contract.native_bridge_env)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(|encoded| decode_js_bridge_descriptor(&encoded))
        .transpose()?;

    let (worker_command, worker_args, worker_request_env, worker_protocol_version) = match bridge {
        Some(bridge) => (
            bridge.worker_command,
            bridge.worker_args,
            bridge.worker_request_env,
            bridge.worker_protocol_version,
        ),
        None => {
            let worker_command = env::var(ENV_JS_WORKER_PATH)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    CliError::unknown(
                        "JS worker bootstrap is unavailable.",
                        Some(
                            "Run the native shell through the npm launcher so it can forward JS-owned commands."
                                .to_string(),
                        ),
                    )
                })?;

            (
                worker_command,
                Vec::new(),
                runtime_contract.worker_request_env.clone(),
                runtime_contract.worker_protocol_version.clone(),
            )
        }
    };

    Ok((
        worker_command,
        worker_args,
        worker_request_env,
        worker_protocol_version,
    ))
}

fn encode_worker_request(argv: &[String], worker_protocol_version: &str) -> Result<String, CliError> {
    let request = json!({
        "protocolVersion": worker_protocol_version,
        "argv": argv,
    });
    Ok(BASE64.encode(serde_json::to_vec(&request).map_err(|error| {
        CliError::unknown(
            format!("Failed to encode worker request: {error}"),
            Some("Please report this issue.".to_string()),
        )
    })?))
}

fn decode_js_bridge_descriptor(encoded: &str) -> Result<JsBridgeDescriptor, CliError> {
    let runtime_contract = runtime_contract();
    let bytes = BASE64.decode(encoded).map_err(|error| {
        CliError::unknown(
            format!("Failed to decode JS bridge descriptor: {error}"),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        )
    })?;

    let descriptor: JsBridgeDescriptor = serde_json::from_slice(&bytes).map_err(|error| {
        CliError::unknown(
            format!("Malformed JS bridge descriptor: {error}"),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        )
    })?;

    if descriptor.runtime_version.trim().is_empty()
        || descriptor.worker_protocol_version.trim().is_empty()
        || descriptor.native_bridge_version.trim().is_empty()
        || descriptor.worker_request_env.trim().is_empty()
        || descriptor.worker_command.trim().is_empty()
    {
        return Err(CliError::unknown(
            "JS bridge descriptor is incomplete.",
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.runtime_version != runtime_contract.runtime_version {
        return Err(CliError::unknown(
            format!(
                "JS bridge runtime version mismatch: expected {}, got {}.",
                runtime_contract.runtime_version, descriptor.runtime_version
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.worker_protocol_version != runtime_contract.worker_protocol_version {
        return Err(CliError::unknown(
            format!(
                "JS bridge worker protocol mismatch: expected {}, got {}.",
                runtime_contract.worker_protocol_version, descriptor.worker_protocol_version
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.native_bridge_version != runtime_contract.native_bridge_version {
        return Err(CliError::unknown(
            format!(
                "JS bridge version mismatch: expected {}, got {}.",
                runtime_contract.native_bridge_version, descriptor.native_bridge_version
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    if descriptor.worker_request_env != runtime_contract.worker_request_env {
        return Err(CliError::unknown(
            format!(
                "JS bridge worker request env mismatch: expected {}, got {}.",
                runtime_contract.worker_request_env, descriptor.worker_request_env
            ),
            Some("Reinstall the CLI or disable native mode and retry.".to_string()),
        ));
    }

    Ok(descriptor)
}

fn exit_code_from_status(status: ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return match signal {
                2 => 130,
                15 => 143,
                value => 128 + value,
            };
        }
    }

    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn with_env<R>(vars: &[(&str, Option<&str>)], run: impl FnOnce() -> R) -> R {
        let _guard = crate::test_env::env_lock().lock().unwrap();
        let previous = vars
            .iter()
            .map(|(key, _)| ((*key).to_string(), env::var(key).ok()))
            .collect::<Vec<_>>();

        for (key, value) in vars {
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
        }

        let result = run();

        for (key, value) in previous {
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
        }

        result
    }

    fn runtime_contract_fixture() -> &'static crate::contract::NativeRuntimeContract {
        runtime_contract()
    }

    fn encode_descriptor(value: serde_json::Value) -> String {
        BASE64.encode(serde_json::to_vec(&value).expect("descriptor should serialize"))
    }

    #[test]
    fn decode_js_bridge_descriptor_accepts_runtime_contract_match() {
        let contract = runtime_contract_fixture();
        let descriptor = encode_descriptor(json!({
            "runtimeVersion": contract.runtime_version,
            "workerProtocolVersion": contract.worker_protocol_version,
            "nativeBridgeVersion": contract.native_bridge_version,
            "workerRequestEnv": contract.worker_request_env,
            "workerCommand": "node",
            "workerArgs": ["-e", "process.exit(0)"],
        }));

        let decoded = decode_js_bridge_descriptor(&descriptor).expect("descriptor should decode");
        assert_eq!(decoded.worker_command, "node");
        assert_eq!(decoded.worker_args.len(), 2);
    }

    #[test]
    fn decode_js_bridge_descriptor_rejects_incomplete_and_mismatched_contracts() {
        let contract = runtime_contract_fixture();
        let incomplete = encode_descriptor(json!({
            "runtimeVersion": contract.runtime_version,
            "workerProtocolVersion": contract.worker_protocol_version,
            "nativeBridgeVersion": contract.native_bridge_version,
            "workerRequestEnv": contract.worker_request_env,
            "workerCommand": "",
            "workerArgs": [],
        }));
        let incomplete_error = decode_js_bridge_descriptor(&incomplete)
            .expect_err("incomplete descriptor should fail");
        assert!(incomplete_error.message.contains("incomplete"));

        let mismatch = encode_descriptor(json!({
            "runtimeVersion": "runtime/v999",
            "workerProtocolVersion": contract.worker_protocol_version,
            "nativeBridgeVersion": contract.native_bridge_version,
            "workerRequestEnv": contract.worker_request_env,
            "workerCommand": "node",
            "workerArgs": [],
        }));
        let mismatch_error =
            decode_js_bridge_descriptor(&mismatch).expect_err("runtime mismatch should fail");
        assert!(mismatch_error.message.contains("runtime version mismatch"));
    }

    #[test]
    fn forward_to_js_worker_supports_bridge_descriptor_and_legacy_worker_path() {
        let contract = runtime_contract_fixture();
        let bridge_descriptor = encode_descriptor(json!({
            "runtimeVersion": contract.runtime_version,
            "workerProtocolVersion": contract.worker_protocol_version,
            "nativeBridgeVersion": contract.native_bridge_version,
            "workerRequestEnv": contract.worker_request_env,
            "workerCommand": "node",
            "workerArgs": [
                "-e",
                format!("process.exit(process.env.{} ? 7 : 1)", contract.worker_request_env),
            ],
        }));

        let bridge_exit = with_env(
            &[
                (
                    contract.native_bridge_env.as_str(),
                    Some(bridge_descriptor.as_str()),
                ),
                (ENV_JS_WORKER_PATH, None),
            ],
            || forward_to_js_worker(&["status".to_string()]),
        )
        .expect("bridge descriptor should launch");
        assert_eq!(bridge_exit, 7);

        let temp_dir = env::temp_dir().join(format!(
            "pp-bridge-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).expect("temp dir should create");
        let script_path = temp_dir.join("worker.sh");
        fs::write(
            &script_path,
            format!(
                "#!/bin/sh\n[ -n \"${}\" ]\nexit $?\n",
                contract.worker_request_env
            ),
        )
        .expect("script should write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&script_path)
                .expect("script should exist")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions).expect("script should be executable");
        }

        let legacy_exit = with_env(
            &[
                (contract.native_bridge_env.as_str(), None),
                (
                    ENV_JS_WORKER_PATH,
                    Some(script_path.to_string_lossy().as_ref()),
                ),
            ],
            || forward_to_js_worker(&["status".to_string()]),
        )
        .expect("legacy worker path should launch");
        assert_eq!(legacy_exit, 0);
    }

    #[test]
    fn exit_code_from_status_returns_process_exit_code() {
        let status = Command::new("sh")
            .arg("-c")
            .arg("exit 19")
            .status()
            .expect("shell should run");
        assert_eq!(exit_code_from_status(status), 19);
    }
}
