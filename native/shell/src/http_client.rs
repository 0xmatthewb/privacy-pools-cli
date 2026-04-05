use crate::error::{CliError, ErrorCategory};
use serde_json::Value;
use std::time::Duration;

pub(crate) fn http_get_json(
    url: &str,
    headers: &[(&str, String)],
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let mut request = ureq::get(url).timeout(Duration::from_millis(timeout_ms));
    for (key, value) in headers {
        request = request.set(key, value);
    }

    let response = request
        .call()
        .map_err(|error| classify_network_error(error, url, ErrorCategory::Asp))?;
    serde_json::from_reader(response.into_reader()).map_err(|error| {
        CliError::unknown(
            format!("Invalid JSON response from {url}: {error}"),
            Some("Retry the command once; if it persists, report the issue.".to_string()),
        )
    })
}

pub(crate) fn http_get_json_with_js_transport_error(
    url: &str,
    headers: &[(&str, String)],
    timeout_ms: u64,
) -> Result<Value, CliError> {
    let mut request = ureq::get(url).timeout(Duration::from_millis(timeout_ms));
    for (key, value) in headers {
        request = request.set(key, value);
    }

    let response = match request.call() {
        Ok(response) => response,
        Err(ureq::Error::Transport(_)) => return Err(js_like_rpc_network_error()),
        Err(error) => return Err(classify_network_error(error, url, ErrorCategory::Asp)),
    };

    serde_json::from_reader(response.into_reader()).map_err(|error| {
        CliError::unknown(
            format!("Invalid JSON response from {url}: {error}"),
            Some("Retry the command once; if it persists, report the issue.".to_string()),
        )
    })
}

pub(crate) fn http_post_json(url: &str, body: &Value, timeout_ms: u64) -> Result<Value, CliError> {
    let response = ureq::post(url)
        .timeout(Duration::from_millis(timeout_ms))
        .set("Content-Type", "application/json")
        .send_string(&serde_json::to_string(body).map_err(|error| {
            CliError::unknown(
                format!("Failed to serialize JSON request: {error}"),
                Some("Please report this issue.".to_string()),
            )
        })?)
        .map_err(|error| classify_network_error(error, url, ErrorCategory::Rpc))?;

    serde_json::from_reader(response.into_reader()).map_err(|error| {
        CliError::unknown(
            format!("Invalid JSON response from {url}: {error}"),
            Some("Retry the command once; if it persists, report the issue.".to_string()),
        )
    })
}

fn js_like_rpc_network_error() -> CliError {
    CliError::rpc_retryable(
        "Network error: fetch failed",
        Some(
            "Check your RPC URL and network connectivity. If using a custom --rpc-url, verify it is reachable."
                .to_string(),
        ),
        Some("RPC_NETWORK_ERROR"),
    )
}

fn classify_network_error(error: ureq::Error, url: &str, category: ErrorCategory) -> CliError {
    match error {
        ureq::Error::Status(404, _) if matches!(category, ErrorCategory::Asp) => CliError::asp(
            "ASP service: resource not found.",
            Some("The pool may not be registered yet. Run 'privacy-pools pools' to verify.".to_string()),
            None,
            false,
        ),
        ureq::Error::Status(400, _) if matches!(category, ErrorCategory::Asp) => CliError::asp(
            "ASP service returned an error.",
            Some("Try 'privacy-pools sync' and retry. If it persists, the CLI may be out of date.".to_string()),
            None,
            false,
        ),
        ureq::Error::Status(429, _) | ureq::Error::Status(403, _) if matches!(category, ErrorCategory::Asp) => {
            CliError::asp(
                "ASP service is temporarily rate-limiting requests.",
                Some("Wait a moment and try again.".to_string()),
                None,
                false,
            )
        }
        other => match category {
            ErrorCategory::Asp => CliError::asp(
                "Could not reach the ASP service.".to_string(),
                Some(
                    "Check your network connection. If it persists, the service may be temporarily down."
                        .to_string(),
                ),
                None,
                matches!(other, ureq::Error::Status(code, _) if code >= 500),
            ),
            ErrorCategory::Rpc => CliError::rpc(
                format!("Network error: {url}"),
                Some(
                    "Check your RPC URL and network connectivity. If using a custom --rpc-url, verify it is reachable."
                        .to_string(),
                ),
                Some("RPC_NETWORK_ERROR"),
            ),
            _ => CliError::unknown(
                "Unexpected network failure.",
                Some("Retry the command once; if it persists, report the issue.".to_string()),
            ),
        },
    }
}
