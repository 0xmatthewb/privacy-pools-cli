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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{Shutdown, TcpListener};
    use std::thread;

    fn header_end(buffer: &[u8]) -> Option<usize> {
        buffer
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
    }

    fn expected_body_len(buffer: &[u8]) -> Option<usize> {
        let header_bytes = buffer.get(..header_end(buffer)?)?;
        let header_text = std::str::from_utf8(header_bytes).ok()?;
        header_text.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if !name.eq_ignore_ascii_case("Content-Length") {
                return None;
            }
            value.trim().parse::<usize>().ok()
        })
    }

    fn serve_once(response: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
        let address = listener
            .local_addr()
            .expect("listener should expose address");
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("request should arrive");
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .expect("stream should support timeouts");
            let mut buffer = Vec::new();
            let mut chunk = [0u8; 1024];
            loop {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(read) => {
                        buffer.extend_from_slice(&chunk[..read]);
                        if let Some(headers_end) = header_end(&buffer) {
                            let body_len = expected_body_len(&buffer).unwrap_or(0);
                            if buffer.len() >= headers_end + body_len {
                                break;
                            }
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
                    Err(error) => panic!("fixture request should read: {error}"),
                }
            }
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
            let _ = stream.flush();
            let _ = stream.shutdown(Shutdown::Both);
        });
        format!("http://{address}")
    }

    fn json_response(status: &str, body: &str) -> String {
        format!(
            "{status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn http_get_json_reads_successful_json() {
        let url = serve_once(json_response("HTTP/1.1 200 OK", r#"{"ok":true}"#));
        let value = http_get_json(&url, &[("X-Test", "1".to_string())], 2_000)
            .expect("http get should succeed");
        assert_eq!(value["ok"], Value::Bool(true));
    }

    #[test]
    fn http_post_json_reads_successful_json() {
        let url = serve_once(json_response("HTTP/1.1 200 OK", r#"{"result":"ok"}"#));
        let value = http_post_json(&url, &Value::Null, 2_000).expect("http post should succeed");
        assert_eq!(value["result"], Value::String("ok".to_string()));
    }

    #[test]
    fn http_get_json_reports_invalid_json() {
        let url = serve_once(json_response("HTTP/1.1 200 OK", "not-json"));
        let error = http_get_json(&url, &[], 2_000).expect_err("invalid json should fail");
        assert_eq!(error.code, "UNKNOWN_ERROR");
        assert!(error.message.contains("Invalid JSON response"));
    }

    #[test]
    fn http_get_json_with_js_transport_error_matches_js_rpc_shape() {
        let error = http_get_json_with_js_transport_error("http://127.0.0.1:1", &[], 100)
            .expect_err("transport failure should fail");
        assert_eq!(error.code, "RPC_NETWORK_ERROR");
        assert_eq!(error.message, "Network error: fetch failed");
        assert_eq!(error.category, ErrorCategory::Rpc);
        assert!(error.retryable);
    }

    #[test]
    fn classify_network_error_maps_asp_statuses() {
        let not_found_url = serve_once(json_response(
            "HTTP/1.1 404 Not Found",
            r#"{"error":"missing"}"#,
        ));
        let missing = http_get_json(&not_found_url, &[], 2_000).expect_err("404 should fail");
        assert_eq!(missing.category, ErrorCategory::Asp);
        assert!(missing.message.contains("resource not found"));
        assert!(!missing.retryable);

        let bad_request_url = serve_once(json_response(
            "HTTP/1.1 400 Bad Request",
            r#"{"error":"bad"}"#,
        ));
        let bad_request = http_get_json(&bad_request_url, &[], 2_000).expect_err("400 should fail");
        assert!(bad_request.message.contains("returned an error"));
        assert!(!bad_request.retryable);

        let rate_limit_url = serve_once(json_response(
            "HTTP/1.1 429 Too Many Requests",
            r#"{"error":"slow"}"#,
        ));
        let rate_limited = http_get_json(&rate_limit_url, &[], 2_000).expect_err("429 should fail");
        assert!(rate_limited.message.contains("rate-limiting"));
        assert!(!rate_limited.retryable);

        let unavailable_url = serve_once(json_response(
            "HTTP/1.1 503 Service Unavailable",
            r#"{"error":"down"}"#,
        ));
        let unavailable = http_get_json(&unavailable_url, &[], 2_000).expect_err("503 should fail");
        assert!(unavailable
            .message
            .contains("Could not reach the ASP service"));
        assert!(unavailable.retryable);
    }

    #[test]
    fn http_post_json_classifies_rpc_transport_failures() {
        let error = http_post_json("http://127.0.0.1:1", &Value::Null, 100)
            .expect_err("rpc transport failure should fail");
        assert_eq!(error.code, "RPC_NETWORK_ERROR");
        assert_eq!(error.category, ErrorCategory::Rpc);
        assert!(error.message.contains("http://127.0.0.1:1"));
    }
}
