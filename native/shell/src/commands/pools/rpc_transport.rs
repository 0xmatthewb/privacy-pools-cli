use crate::error::CliError;
use crate::http_client::http_post_json;
use serde_json::{json, Value};

pub(super) fn rpc_call(
    rpc_urls: &[String],
    to: &str,
    data: &str,
    timeout_ms: u64,
) -> Result<String, CliError> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [
            {
                "to": to,
                "data": data,
            },
            "latest"
        ]
    });

    let mut last_error = None;
    for rpc_url in rpc_urls {
        match http_post_json(rpc_url, &body, timeout_ms) {
            Ok(response) => {
                if let Some(result) = response.get("result").and_then(Value::as_str) {
                    return Ok(result.to_string());
                }

                if let Some(error_message) = response
                    .get("error")
                    .and_then(Value::as_object)
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                {
                    last_error = Some(CliError::rpc(
                        format!("RPC error: {error_message}"),
                        Some("Check your RPC connection and try again.".to_string()),
                        None,
                    ));
                    continue;
                }
            }
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        CliError::rpc(
            "RPC pool resolution failed.",
            Some("Check your RPC connection and try again.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    }))
}
