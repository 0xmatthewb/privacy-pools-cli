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
            Ok(response) => match extract_rpc_call_result(&response) {
                Ok(Some(result)) => return Ok(result),
                Ok(None) => {}
                Err(error) => {
                    last_error = Some(error);
                    continue;
                }
            },
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

fn extract_rpc_call_result(response: &Value) -> Result<Option<String>, CliError> {
    if let Some(result) = response.get("result").and_then(Value::as_str) {
        return Ok(Some(result.to_string()));
    }

    if let Some(error_message) = response
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return Err(CliError::rpc(
            format!("RPC error: {error_message}"),
            Some("Check your RPC connection and try again.".to_string()),
            None,
        ));
    }

    Ok(None)
}

#[cfg(test)]
mod extended_tests {
    use super::extract_rpc_call_result;
    use serde_json::json;

    #[test]
    fn extract_rpc_call_result_returns_successful_result_payloads() {
        let result = extract_rpc_call_result(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": "0x1234"
        }))
        .expect("result payload should succeed")
        .expect("result string should be returned");
        assert_eq!(result, "0x1234");
    }

    #[test]
    fn extract_rpc_call_result_surfaces_rpc_error_messages() {
        let error = extract_rpc_call_result(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "error": { "message": "upstream exploded" }
        }))
        .expect_err("rpc error payload should fail");
        assert!(error.message.contains("upstream exploded"));
    }

    #[test]
    fn extract_rpc_call_result_returns_none_when_result_and_error_are_absent() {
        let result = extract_rpc_call_result(&json!({
            "jsonrpc": "2.0",
            "id": 1
        }))
        .expect("empty payload should not throw");
        assert_eq!(result, None);
    }
}
