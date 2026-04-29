#![allow(dead_code)]
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Output};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tiny_keccak::{Hasher, Keccak};

const FIXTURE_CHAIN_ID: u64 = 11_155_111;
const FIXTURE_MAINNET_CHAIN_ID: u64 = 1;
const FIXTURE_OPTIMISM_CHAIN_ID: u64 = 10;
const FIXTURE_ARBITRUM_CHAIN_ID: u64 = 42_161;
const FIXTURE_POOL: &str = "0x1234567890abcdef1234567890abcdef12345678";
const FIXTURE_ASSET: &str = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

#[derive(Debug, Clone, Deserialize)]
pub struct RuntimeContractFixture {
    #[serde(rename = "runtimeVersion")]
    pub runtime_version: String,
    #[serde(rename = "workerProtocolVersion")]
    pub worker_protocol_version: String,
    #[serde(rename = "nativeBridgeVersion")]
    pub native_bridge_version: String,
    #[serde(rename = "workerRequestEnv")]
    pub worker_request_env: String,
    #[serde(rename = "nativeBridgeEnv")]
    pub native_bridge_env: String,
}

pub fn run_native(args: &[&str]) -> Output {
    run_native_with_env(args, &[])
}

pub fn run_native_with_env(args: &[&str], env: &[(&str, &str)]) -> Output {
    let _guard = native_subprocess_lock()
        .lock()
        .expect("native subprocess test lock should not be poisoned");
    let mut command = Command::new(native_shell_bin_path());
    command.current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    command.env_clear();
    for (key, value) in std::env::vars_os() {
        if should_inherit_env(&key) {
            command.env(key, value);
        }
    }
    command.env("NO_COLOR", "1");
    command.env("TERM", "xterm-256color");
    command.env("PP_NO_UPDATE_CHECK", "1");
    for (key, value) in env {
        command.env(key, value);
    }
    command.args(args);
    command.output().expect("native shell should execute")
}

fn native_subprocess_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn should_inherit_env(key: &OsString) -> bool {
    let Some(key) = key.to_str() else {
        return true;
    };
    !key.starts_with("PRIVACY_POOLS_")
        && !key.starts_with("PP_")
        && !matches!(
            key,
            "AIDER_AGENT"
                | "CLICOLOR_FORCE"
                | "CLAUDE_CODE"
                | "CLAUDECODE"
                | "COLORTERM"
                | "COLUMNS"
                | "CODEX_AGENT"
                | "CODEX_SANDBOX"
                | "CURSOR_AGENT"
                | "FORCE_COLOR"
                | "GEMINI_CLI"
                | "LANG"
                | "LC_ALL"
                | "NO_COLOR"
                | "OPENCODE"
                | "TERM"
        )
}

fn native_shell_bin_path() -> PathBuf {
    if let Some(path) = cargo_bin_env_path() {
        return path;
    }

    fallback_native_shell_bin_path()
}

fn cargo_bin_env_path() -> Option<PathBuf> {
    std::env::var_os("CARGO_BIN_EXE_privacy-pools-cli-native-shell").map(PathBuf::from)
}

fn fallback_native_shell_bin_path() -> PathBuf {
    let current_exe = std::env::current_exe().expect("test binary path should be available");
    let debug_dir = current_exe
        .parent()
        .and_then(|deps| deps.parent())
        .expect("test binary should live under target/<profile>/deps");
    let bin_name = native_shell_binary_name();
    let candidate = debug_dir.join(bin_name);
    assert!(
        candidate.exists(),
        "native shell binary should exist at {}",
        candidate.display()
    );
    candidate
}

fn native_shell_binary_name() -> OsString {
    let mut value = OsString::from("privacy-pools-cli-native-shell");
    if cfg!(windows) {
        value.push(".exe");
    }
    value
}

pub fn stdout_string(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).expect("stdout should be utf8")
}

pub fn stderr_string(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).expect("stderr should be utf8")
}

pub fn parse_stdout_json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).expect("stdout should contain valid json")
}

pub fn missing_worker_path() -> String {
    let mut path = std::env::temp_dir();
    path.push("pp-missing-worker.js");
    path.to_string_lossy().into_owned()
}

pub fn runtime_contract_fixture() -> RuntimeContractFixture {
    let contract_path = format!(
        "{}/generated/runtime-contract.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let raw =
        std::fs::read_to_string(&contract_path).expect("runtime contract fixture should exist");
    serde_json::from_str(&raw).expect("runtime contract fixture should parse")
}

pub fn encode_bridge_descriptor(value: Value) -> String {
    BASE64.encode(serde_json::to_vec(&value).expect("bridge descriptor should serialize"))
}

pub fn live_bridge_env() -> (String, String) {
    let contract = runtime_contract_fixture();
    let worker_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dist/runtime/v1/worker-main.js");
    assert!(
        worker_path.exists(),
        "worker-main.js should exist at {}",
        worker_path.display()
    );
    let encoded = encode_bridge_descriptor(json!({
        "runtimeVersion": contract.runtime_version,
        "workerProtocolVersion": contract.worker_protocol_version,
        "nativeBridgeVersion": contract.native_bridge_version,
        "workerRequestEnv": contract.worker_request_env,
        "workerCommand": std::env::var("NODE").unwrap_or_else(|_| "node".to_string()),
        "workerArgs": [worker_path.to_string_lossy().to_string()],
    }));
    (contract.native_bridge_env, encoded)
}

pub struct FixtureServer {
    base_url: String,
    running: Arc<AtomicBool>,
    connection_handles: Arc<Mutex<Vec<JoinHandle<()>>>>,
    join_handle: Option<JoinHandle<()>>,
}

#[derive(Debug, Clone, Default)]
pub struct FixtureBehavior {
    pools_stats_overrides: std::collections::HashMap<u64, Value>,
    activity_events_overrides: std::collections::HashMap<String, Value>,
}

impl FixtureBehavior {
    pub fn with_pools_stats_override(mut self, chain_id: u64, payload: Value) -> Self {
        self.pools_stats_overrides.insert(chain_id, payload);
        self
    }

    pub fn with_activity_events_override(
        mut self,
        path: impl Into<String>,
        payload: Value,
    ) -> Self {
        self.activity_events_overrides.insert(path.into(), payload);
        self
    }
}

impl FixtureServer {
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

impl Drop for FixtureServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        let _ = TcpStream::connect(
            self.base_url
                .strip_prefix("http://")
                .expect("fixture base url should be http"),
        )
        .and_then(|stream| stream.shutdown(Shutdown::Both));
        if let Some(handle) = self.join_handle.take() {
            let _ = handle.join();
        }
        if let Ok(mut handles) = self.connection_handles.lock() {
            while let Some(handle) = handles.pop() {
                let _ = handle.join();
            }
        }
    }
}

pub fn launch_fixture_server() -> FixtureServer {
    launch_fixture_server_with_behavior(FixtureBehavior::default())
}

pub fn launch_fixture_server_with_behavior(behavior: FixtureBehavior) -> FixtureServer {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("fixture listener should bind to a free port");
    listener
        .set_nonblocking(true)
        .expect("fixture listener should support nonblocking mode");
    let address = listener
        .local_addr()
        .expect("fixture listener should expose its local address");
    let base_url = format!("http://{address}");
    let running = Arc::new(AtomicBool::new(true));
    let running_for_thread = Arc::clone(&running);
    let behavior = Arc::new(behavior);
    let behavior_for_thread = Arc::clone(&behavior);
    let connection_handles = Arc::new(Mutex::new(Vec::<JoinHandle<()>>::new()));
    let connection_handles_for_thread = Arc::clone(&connection_handles);

    let join_handle = thread::spawn(move || {
        while running_for_thread.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let behavior = Arc::clone(&behavior_for_thread);
                    let handle = thread::spawn(move || handle_connection(stream, &behavior));
                    connection_handles_for_thread
                        .lock()
                        .expect("fixture server should track connection threads")
                        .push(handle);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });

    FixtureServer {
        base_url,
        running,
        connection_handles,
        join_handle: Some(join_handle),
    }
}

fn handle_connection(mut stream: TcpStream, behavior: &FixtureBehavior) {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("fixture stream should support timeouts");
    let request = read_http_request(&mut stream);
    let (status_line, body) = route_request(&request, behavior);
    let response = format!(
        "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body,
    );
    stream
        .write_all(response.as_bytes())
        .expect("fixture should write a complete response");
    let _ = stream.flush();
}

fn read_http_request(stream: &mut TcpStream) -> String {
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
            Err(error) => panic!("fixture failed to read request: {error}"),
        }
    }

    String::from_utf8(buffer).expect("fixture request should be utf8")
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

fn route_request(request: &str, behavior: &FixtureBehavior) -> (&'static str, String) {
    let (request_line, body) = request
        .split_once("\r\n")
        .map(|(head, _)| (head, request_body(request)))
        .unwrap_or_default();
    let mut tokens = request_line.split_whitespace();
    let method = tokens.next().unwrap_or_default();
    let raw_path = tokens.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or(raw_path);

    let json_body = match (method, path) {
        ("GET", "/global/public/events") => json!({
            "events": behavior
                .activity_events_overrides
                .get("global")
                .cloned()
                .unwrap_or_else(|| json!([activity_event("deposit")])),
            "page": 1,
            "perPage": 12,
            "total": behavior
                .activity_events_overrides
                .get("global")
                .and_then(Value::as_array)
                .map(|events| events.len() as u64)
                .unwrap_or(13),
            "totalPages": 1,
        }),
        ("GET", "/global/public/statistics") => json!({
            "allTime": {
                "tvl": "50000000000000000000",
                "tvlUsd": "150000",
                "totalDepositsCount": 100,
                "totalDepositsValue": "200000000000000000000",
                "totalDepositsValueUsd": "600000",
                "totalWithdrawalsCount": 50,
                "totalWithdrawalsValue": "100000000000000000000",
                "totalWithdrawalsValueUsd": "300000"
            },
            "last24h": {
                "totalDepositsCount": 5,
                "totalDepositsValue": "10000000000000000000",
                "totalWithdrawalsCount": 2,
                "totalWithdrawalsValue": "4000000000000000000"
            },
            "cacheTimestamp": "2025-01-01T00:00:00.000Z"
        }),
        ("GET", "/11155111/public/events") => json!({
            "events": behavior
                .activity_events_overrides
                .get("11155111")
                .cloned()
                .unwrap_or_else(|| json!([activity_event("deposit")])),
            "page": 1,
            "perPage": 12,
            "total": behavior
                .activity_events_overrides
                .get("11155111")
                .and_then(Value::as_array)
                .map(|events| events.len() as u64)
                .unwrap_or(1),
            "totalPages": 1,
        }),
        ("GET", "/1/public/pools-stats") => {
            pools_stats_for_chain(FIXTURE_MAINNET_CHAIN_ID, behavior)
        }
        ("GET", "/10/public/pools-stats") => {
            pools_stats_for_chain(FIXTURE_OPTIMISM_CHAIN_ID, behavior)
        }
        ("GET", "/42161/public/pools-stats") => {
            pools_stats_for_chain(FIXTURE_ARBITRUM_CHAIN_ID, behavior)
        }
        ("GET", "/11155111/public/pools-stats") => {
            pools_stats_for_chain(FIXTURE_CHAIN_ID, behavior)
        }
        ("GET", "/11155111/public/pool-statistics") => json!({
            "pool": {
                "scope": "12345",
                "chainId": format!("{FIXTURE_CHAIN_ID}"),
                "tokenSymbol": "ETH",
                "tokenAddress": FIXTURE_ASSET,
                "tokenDecimals": 18,
                "allTime": {
                    "tvl": "50000000000000000000",
                    "tvlUsd": "150000",
                    "totalDepositsCount": 100,
                    "totalDepositsValue": "200000000000000000000",
                    "totalDepositsValueUsd": "600000",
                    "totalWithdrawalsCount": 50,
                    "totalWithdrawalsValue": "100000000000000000000",
                    "totalWithdrawalsValueUsd": "300000"
                },
                "last24h": {
                    "totalDepositsCount": 5,
                    "totalDepositsValue": "10000000000000000000",
                    "totalWithdrawalsCount": 2,
                    "totalWithdrawalsValue": "4000000000000000000"
                }
            },
            "cacheTimestamp": "2025-01-01T00:00:00.000Z"
        }),
        ("POST", _) => route_rpc_request(body),
        _ => {
            return (
                "HTTP/1.1 404 Not Found",
                json!({ "error": "not found" }).to_string(),
            )
        }
    };

    ("HTTP/1.1 200 OK", json_body.to_string())
}

fn request_body(request: &str) -> &str {
    request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("")
}

fn route_rpc_request(body: &str) -> Value {
    let request: Value = serde_json::from_str(body).expect("fixture rpc body should be valid json");
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let id = request.get("id").cloned().unwrap_or_else(|| json!(1));

    if method == "eth_chainId" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": format!("0x{:x}", FIXTURE_CHAIN_ID),
        });
    }

    if method == "eth_blockNumber" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": "0x1",
        });
    }

    if method == "eth_getLogs" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": [],
        });
    }

    if method == "eth_getBlockByNumber" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "number": "0x1",
                "hash": format!("0x{}", "11".repeat(32)),
                "parentHash": format!("0x{}", "22".repeat(32)),
                "timestamp": "0x1",
                "transactions": [],
            },
        });
    }

    if method == "eth_getTransactionReceipt" || method == "eth_getTransactionByHash" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": null,
        });
    }

    if method == "eth_getCode" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": "0x",
        });
    }

    if method == "net_version" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": FIXTURE_CHAIN_ID.to_string(),
        });
    }

    if method == "web3_clientVersion" {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": "privacy-pools-native-fixture/1.0.0",
        });
    }

    if method == "eth_call" {
        let data = request
            .get("params")
            .and_then(Value::as_array)
            .and_then(|params| params.first())
            .and_then(|call| call.get("data"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();
        let asset_selector = format!(
            "0x{}",
            hex::encode(function_selector("assetConfig(address)"))
        );
        let scope_selector = format!("0x{}", hex::encode(function_selector("SCOPE()")));

        let result = if data.starts_with(&asset_selector) {
            format!(
                "0x{}{}{}{}",
                encode_address_word(FIXTURE_POOL),
                encode_u256(1_000_000_000_000_000),
                encode_u256(50),
                encode_u256(250)
            )
        } else if data.starts_with(&scope_selector) {
            format!("0x{}", encode_u256(12_345))
        } else {
            "0x".to_string()
        };

        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        });
    }

    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": "0x",
    })
}

fn activity_event(event_type: &str) -> Value {
    json!({
        "type": event_type,
        "txHash": "0xabc1230000000000000000000000000000000000000000000000000000000001",
        "timestamp": 1700000000,
        "amount": "1000000000000000000",
        "reviewStatus": "accepted",
        "pool": {
            "chainId": FIXTURE_CHAIN_ID,
            "poolAddress": FIXTURE_POOL,
            "tokenSymbol": "ETH",
            "denomination": "18"
        }
    })
}

fn pools_stats(chain_id: u64) -> Value {
    json!([
        {
            "scope": "12345",
            "chainId": chain_id,
            "tokenAddress": FIXTURE_ASSET,
            "tokenSymbol": "ETH",
            "totalInPoolValue": "5000000000000000000",
            "totalDepositsValue": "10000000000000000000",
            "acceptedDepositsValue": "8000000000000000000",
            "pendingDepositsValue": "2000000000000000000",
            "totalDepositsCount": 42,
            "acceptedDepositsCount": 35,
            "pendingDepositsCount": 7,
            "growth24h": 0.05
        }
    ])
}

fn pools_stats_for_chain(chain_id: u64, behavior: &FixtureBehavior) -> Value {
    behavior
        .pools_stats_overrides
        .get(&chain_id)
        .cloned()
        .unwrap_or_else(|| pools_stats(chain_id))
}

fn function_selector(signature: &str) -> [u8; 4] {
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(signature.as_bytes());
    keccak.finalize(&mut hash);
    [hash[0], hash[1], hash[2], hash[3]]
}

fn encode_address_word(address: &str) -> String {
    format!("{:0>64}", address.trim_start_matches("0x").to_lowercase())
}

fn encode_u256(value: u128) -> String {
    format!("{value:064x}")
}
