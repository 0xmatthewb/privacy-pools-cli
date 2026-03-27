mod support;

use serde_json::Value;
use support::{
    launch_fixture_server, parse_stdout_json, run_native_with_env, stderr_string, stdout_string,
};

#[test]
fn global_public_commands_succeed_against_the_rust_fixture() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let env = [("PRIVACY_POOLS_ASP_HOST", asp_host.as_str())];

    let activity = run_native_with_env(&["activity", "--agent"], &env);
    assert!(activity.status.success());
    assert!(stderr_string(&activity).trim().is_empty());
    let activity_payload = parse_stdout_json(&activity);
    assert_eq!(activity_payload["success"], Value::Bool(true));
    assert_eq!(
        activity_payload["mode"],
        Value::String("global-activity".to_string())
    );
    assert_eq!(
        activity_payload["chain"],
        Value::String("all-mainnets".to_string())
    );
    assert_eq!(
        activity_payload["events"]
            .as_array()
            .expect("events should be an array")
            .len(),
        1
    );

    let stats = run_native_with_env(&["stats", "--agent"], &env);
    assert!(stats.status.success());
    assert!(stderr_string(&stats).trim().is_empty());
    let stats_payload = parse_stdout_json(&stats);
    assert_eq!(stats_payload["success"], Value::Bool(true));
    assert_eq!(
        stats_payload["mode"],
        Value::String("global-stats".to_string())
    );
    assert_eq!(
        stats_payload["cacheTimestamp"],
        Value::String("2025-01-01T00:00:00.000Z".to_string())
    );
}

#[test]
fn global_public_commands_render_human_and_csv_output_against_the_rust_fixture() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let env = [("PRIVACY_POOLS_ASP_HOST", asp_host.as_str())];

    let human_activity = run_native_with_env(&["activity"], &env);
    assert!(human_activity.status.success());
    assert!(stdout_string(&human_activity).is_empty());
    assert!(stderr_string(&human_activity).contains("Global activity"));

    let csv_activity = run_native_with_env(&["--format", "csv", "activity"], &env);
    assert!(csv_activity.status.success());
    assert!(stderr_string(&csv_activity).contains("Fetching public activity"));
    assert!(stdout_string(&csv_activity).contains("Type,Pool,Amount,Status,Time,Tx"));

    let human_stats = run_native_with_env(&["stats"], &env);
    assert!(human_stats.status.success());
    assert!(stdout_string(&human_stats).is_empty());
    assert!(stderr_string(&human_stats).contains("Global statistics (all-mainnets):"));

    let csv_stats = run_native_with_env(&["--format", "csv", "stats"], &env);
    assert!(csv_stats.status.success());
    assert!(stderr_string(&csv_stats).contains("Fetching global statistics"));
    assert!(stdout_string(&csv_stats).contains("Metric,All Time,Last 24h"));
}

#[test]
fn pool_read_only_commands_succeed_against_the_rust_fixture() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_SEPOLIA", rpc_url.as_str()),
    ];

    let pools = run_native_with_env(&["--chain", "sepolia", "pools", "--agent"], &env);
    assert!(pools.status.success());
    assert!(stderr_string(&pools).trim().is_empty());
    let pools_payload = parse_stdout_json(&pools);
    assert_eq!(pools_payload["success"], Value::Bool(true));
    assert_eq!(pools_payload["chain"], Value::String("sepolia".to_string()));
    assert_eq!(
        pools_payload["pools"][0]["asset"],
        Value::String("ETH".to_string())
    );

    let stats_pool = run_native_with_env(
        &[
            "--chain", "sepolia", "stats", "pool", "--asset", "ETH", "--agent",
        ],
        &env,
    );
    assert!(stats_pool.status.success());
    assert!(stderr_string(&stats_pool).trim().is_empty());
    let stats_pool_payload = parse_stdout_json(&stats_pool);
    assert_eq!(stats_pool_payload["success"], Value::Bool(true));
    assert_eq!(
        stats_pool_payload["mode"],
        Value::String("pool-stats".to_string())
    );
    assert_eq!(
        stats_pool_payload["asset"],
        Value::String("ETH".to_string())
    );
    assert_eq!(
        stats_pool_payload["scope"],
        Value::String("12345".to_string())
    );
}

#[test]
fn pool_read_only_commands_render_human_and_csv_output_against_the_rust_fixture() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_SEPOLIA", rpc_url.as_str()),
    ];

    let human_pools = run_native_with_env(&["--chain", "sepolia", "pools"], &env);
    assert!(human_pools.status.success());
    assert!(stdout_string(&human_pools).is_empty());
    assert!(stderr_string(&human_pools).contains("Pools on sepolia:"));

    let csv_pools = run_native_with_env(&["--format", "csv", "--chain", "sepolia", "pools"], &env);
    assert!(csv_pools.status.success());
    assert!(stderr_string(&csv_pools).is_empty());
    assert!(stdout_string(&csv_pools).contains("Asset,Total Deposits,Pool Balance"));

    let human_stats_pool = run_native_with_env(
        &["--chain", "sepolia", "stats", "pool", "--asset", "ETH"],
        &env,
    );
    assert!(human_stats_pool.status.success());
    assert!(stdout_string(&human_stats_pool).is_empty());
    assert!(stderr_string(&human_stats_pool).contains("Pool statistics for ETH on sepolia:"));

    let csv_stats_pool = run_native_with_env(
        &[
            "--format", "csv", "--chain", "sepolia", "stats", "pool", "--asset", "ETH",
        ],
        &env,
    );
    assert!(csv_stats_pool.status.success());
    assert!(stderr_string(&csv_stats_pool).contains("Fetching pool statistics"));
    assert!(stdout_string(&csv_stats_pool).contains("Metric,All Time,Last 24h"));
}

#[test]
fn network_failures_keep_machine_readable_error_contracts() {
    let env = [("PRIVACY_POOLS_ASP_HOST", "http://127.0.0.1:9")];
    let output = run_native_with_env(&["activity", "--agent"], &env);

    assert_eq!(output.status.code(), Some(3));
    assert!(stderr_string(&output).trim().is_empty());
    let payload = parse_stdout_json(&output);
    assert_eq!(payload["success"], Value::Bool(false));
    assert_eq!(
        payload["errorCode"],
        Value::String("RPC_NETWORK_ERROR".to_string())
    );
    assert!(
        stdout_string(&output).contains("Check your RPC URL and network connectivity"),
        "expected the JSON payload to keep the retry hint",
    );
}
