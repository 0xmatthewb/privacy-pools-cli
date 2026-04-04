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

    let request = json!({
        "protocolVersion": worker_protocol_version,
        "argv": argv,
    });
    let encoded_request = BASE64.encode(serde_json::to_vec(&request).map_err(|error| {
        CliError::unknown(
            format!("Failed to encode worker request: {error}"),
            Some("Please report this issue.".to_string()),
        )
    })?);

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
