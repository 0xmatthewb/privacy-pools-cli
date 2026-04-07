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

/// Send multiple eth_call requests as a single JSON-RPC batch.
///
/// Returns a Vec of results in the same order as `requests`.
/// Retries later RPC URLs when a batch response is partial or contains per-call errors.
/// Falls back to sequential `rpc_call` if the RPC returns a non-array response.
pub(super) fn rpc_batch_call(
    rpc_urls: &[String],
    requests: &[(&str, &str)], // (to, data) pairs
    timeout_ms: u64,
) -> Result<Vec<Result<String, CliError>>, CliError> {
    if requests.is_empty() {
        return Ok(vec![]);
    }
    if requests.len() == 1 {
        return Ok(vec![rpc_call(
            rpc_urls,
            requests[0].0,
            requests[0].1,
            timeout_ms,
        )]);
    }

    let batch: Vec<Value> = requests
        .iter()
        .enumerate()
        .map(|(id, (to, data))| {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": "eth_call",
                "params": [{ "to": to, "data": data }, "latest"]
            })
        })
        .collect();

    let batch_body = Value::Array(batch);

    let mut last_error = None;
    for rpc_url in rpc_urls {
        match http_post_json(rpc_url, &batch_body, timeout_ms) {
            Ok(response) => {
                if let Some(items) = response.as_array() {
                    let parsed = parse_batch_response(items, requests.len());
                    if let Some(error) = first_batch_error(&parsed) {
                        last_error = Some(error);
                        continue;
                    }
                    return Ok(parsed);
                }
                // Non-array response: RPC doesn't support batch. Fall back to sequential.
                return sequential_fallback(rpc_urls, requests, timeout_ms);
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

fn first_batch_error(results: &[Result<String, CliError>]) -> Option<CliError> {
    results
        .iter()
        .find_map(|entry| entry.as_ref().err().cloned())
}

fn parse_batch_response(items: &[Value], expected_count: usize) -> Vec<Result<String, CliError>> {
    let mut results: Vec<Option<Result<String, CliError>>> = vec![None; expected_count];

    for item in items {
        let id = item.get("id").and_then(Value::as_u64).unwrap_or(u64::MAX) as usize;
        if id >= expected_count {
            continue;
        }
        results[id] = Some(match extract_rpc_call_result(item) {
            Ok(Some(result)) => Ok(result),
            Ok(None) => Err(CliError::rpc(
                "Batch RPC call returned no result.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )),
            Err(error) => Err(error),
        });
    }

    results
        .into_iter()
        .map(|entry| {
            entry.unwrap_or_else(|| {
                Err(CliError::rpc(
                    "Batch RPC call missing response entry.",
                    Some("Retry the command or switch RPC providers.".to_string()),
                    Some("RPC_POOL_RESOLUTION_FAILED"),
                ))
            })
        })
        .collect()
}

fn sequential_fallback(
    rpc_urls: &[String],
    requests: &[(&str, &str)],
    timeout_ms: u64,
) -> Result<Vec<Result<String, CliError>>, CliError> {
    Ok(requests
        .iter()
        .map(|(to, data)| rpc_call(rpc_urls, to, data, timeout_ms))
        .collect())
}

#[cfg(test)]
mod extended_tests {
    use super::{extract_rpc_call_result, parse_batch_response, rpc_batch_call};
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    #[test]
    fn parse_batch_response_returns_results_in_order() {
        let items = vec![
            json!({"jsonrpc": "2.0", "id": 1, "result": "0xBBBB"}),
            json!({"jsonrpc": "2.0", "id": 0, "result": "0xAAAA"}),
        ];
        let results = parse_batch_response(&items, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].as_ref().unwrap(), "0xAAAA");
        assert_eq!(results[1].as_ref().unwrap(), "0xBBBB");
    }

    #[test]
    fn parse_batch_response_handles_individual_errors() {
        let items = vec![
            json!({"jsonrpc": "2.0", "id": 0, "result": "0x1234"}),
            json!({"jsonrpc": "2.0", "id": 1, "error": {"message": "revert"}}),
        ];
        let results = parse_batch_response(&items, 2);
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
    }

    #[test]
    fn parse_batch_response_fills_missing_entries_with_errors() {
        let items = vec![json!({"jsonrpc": "2.0", "id": 0, "result": "0xAA"})];
        let results = parse_batch_response(&items, 3);
        assert_eq!(results.len(), 3);
        assert!(results[0].is_ok());
        assert!(results[1].is_err());
        assert!(results[2].is_err());
    }

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

    #[test]
    fn rpc_batch_call_retries_later_urls_when_first_batch_is_partial() {
        let first = spawn_rpc_test_server(json!([
            {"jsonrpc": "2.0", "id": 0, "result": "0xAAAA"},
            {"jsonrpc": "2.0", "id": 1, "error": {"message": "rate limited"}},
        ]));
        let second = spawn_rpc_test_server(json!([
            {"jsonrpc": "2.0", "id": 0, "result": "0xBBBB"},
            {"jsonrpc": "2.0", "id": 1, "result": "0xCCCC"},
        ]));

        let rpc_urls = vec![first.url.clone(), second.url.clone()];
        let results = rpc_batch_call(
            &rpc_urls,
            &[("0xpool", "0xscope"), ("0xasset", "0xsymbol")],
            1_000,
        )
        .expect("later healthy rpc should satisfy the batch");

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].as_ref().unwrap(), "0xBBBB");
        assert_eq!(results[1].as_ref().unwrap(), "0xCCCC");
    }

    struct RpcTestServer {
        url: String,
        handle: Option<thread::JoinHandle<()>>,
    }

    impl Drop for RpcTestServer {
        fn drop(&mut self) {
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn spawn_rpc_test_server(response_body: serde_json::Value) -> RpcTestServer {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test rpc listener should bind");
        let address = listener
            .local_addr()
            .expect("test rpc listener should expose address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("test rpc server should accept a client");
            let _request = read_http_request(&mut stream);
            let body = response_body.to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("test rpc server should respond");
            let _ = stream.flush();
        });

        RpcTestServer {
            url: format!("http://{address}"),
            handle: Some(handle),
        }
    }

    fn read_http_request(stream: &mut TcpStream) -> Vec<u8> {
        let mut buffer = Vec::<u8>::new();
        let mut chunk = [0u8; 2048];

        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    buffer.extend_from_slice(&chunk[..read]);
                    if request_is_complete(&buffer) {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Err(error) => panic!("test rpc server failed to read request: {error}"),
            }
        }

        buffer
    }

    fn request_is_complete(buffer: &[u8]) -> bool {
        let Some(headers_end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") else {
            return false;
        };
        let headers_len = headers_end + 4;
        let headers = String::from_utf8_lossy(&buffer[..headers_len]);
        let content_length = headers
            .lines()
            .find_map(|line| line.split_once(':'))
            .and_then(|(name, value)| {
                if name.eq_ignore_ascii_case("content-length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);

        buffer.len() >= headers_len + content_length
    }
}
