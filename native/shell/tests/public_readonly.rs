mod support;

use serde_json::Value;
use support::{
    launch_fixture_server, launch_fixture_server_with_behavior, parse_stdout_json,
    run_native_with_env, stderr_string, stdout_string, FixtureBehavior,
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
fn explicit_chain_activity_keeps_filtered_json_and_human_notes_stable() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let env = [("PRIVACY_POOLS_ASP_HOST", asp_host.as_str())];

    let agent = run_native_with_env(&["--chain", "sepolia", "activity", "--agent"], &env);
    assert!(agent.status.success());
    assert!(stderr_string(&agent).trim().is_empty());
    let payload = parse_stdout_json(&agent);
    assert_eq!(payload["success"], Value::Bool(true));
    assert_eq!(payload["chain"], Value::String("sepolia".to_string()));
    assert_eq!(payload["chainFiltered"], Value::Bool(true));
    assert_eq!(payload["total"], Value::Null);
    assert_eq!(payload["totalPages"], Value::Null);
    assert!(payload["note"]
        .as_str()
        .expect("chain-filtered note should be present")
        .contains("Pagination totals are unavailable"),);

    let human = run_native_with_env(&["--chain", "sepolia", "activity"], &env);
    assert!(human.status.success());
    assert!(stdout_string(&human).is_empty());
    let stderr = stderr_string(&human);
    assert!(stderr.contains("Global activity (sepolia):"));
    assert!(stderr.contains("Note: Results filtered to sepolia. Some pages may be sparse."));
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

    let activity = run_native_with_env(
        &[
            "--chain", "sepolia", "activity", "--asset", "ETH", "--agent",
        ],
        &env,
    );
    assert!(activity.status.success());
    assert!(stderr_string(&activity).trim().is_empty());
    let activity_payload = parse_stdout_json(&activity);
    assert_eq!(activity_payload["success"], Value::Bool(true));
    assert_eq!(
        activity_payload["mode"],
        Value::String("pool-activity".to_string())
    );
    assert_eq!(activity_payload["asset"], Value::String("ETH".to_string()));
    assert_eq!(
        activity_payload["scope"],
        Value::String("12345".to_string())
    );
}

#[test]
fn multi_chain_pools_queries_stay_deterministic_against_the_rust_fixture() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_MAINNET", rpc_url.as_str()),
        ("PRIVACY_POOLS_RPC_URL_ARBITRUM", rpc_url.as_str()),
        ("PRIVACY_POOLS_RPC_URL_OPTIMISM", rpc_url.as_str()),
    ];

    let pools = run_native_with_env(&["pools", "--agent"], &env);
    assert!(pools.status.success());
    assert!(stderr_string(&pools).trim().is_empty());

    let payload = parse_stdout_json(&pools);
    assert_eq!(payload["success"], Value::Bool(true));
    assert_eq!(payload["allChains"], Value::Bool(true));
    assert!(payload["warnings"].is_null());

    let chains = payload["chains"]
        .as_array()
        .expect("multi-chain pools should expose chain summaries");
    assert_eq!(chains.len(), 3);
    assert_eq!(chains[0]["chain"], Value::String("mainnet".to_string()));
    assert_eq!(chains[1]["chain"], Value::String("arbitrum".to_string()));
    assert_eq!(chains[2]["chain"], Value::String("optimism".to_string()));
    assert_eq!(chains[0]["error"], Value::Null);
    assert_eq!(chains[1]["error"], Value::Null);
    assert_eq!(chains[2]["error"], Value::Null);

    let pools = payload["pools"]
        .as_array()
        .expect("multi-chain pools output should include pools");
    assert_eq!(pools.len(), 3);
}

#[test]
fn single_chain_pools_deduplicate_duplicate_stats_entries() {
    let fixture =
        launch_fixture_server_with_behavior(FixtureBehavior::default().with_pools_stats_override(
            1,
            serde_json::json!([
                {
                    "scope": "12345",
                    "chainId": 1,
                    "poolAddress": "0x1234567890abcdef1234567890abcdef12345678",
                    "tokenAddress": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                    "tokenSymbol": "ETH",
                    "totalDepositsCount": 42
                },
                {
                    "scope": "12345",
                    "chainId": 1,
                    "poolAddress": "0x1234567890abcdef1234567890abcdef12345678",
                    "tokenAddress": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                    "tokenSymbol": "ETH",
                    "totalDepositsCount": 84
                }
            ]),
        ));
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_MAINNET", rpc_url.as_str()),
    ];

    let pools = run_native_with_env(&["--chain", "mainnet", "pools", "--agent"], &env);
    assert!(pools.status.success());
    assert!(stderr_string(&pools).trim().is_empty());

    let payload = parse_stdout_json(&pools);
    let pools = payload["pools"]
        .as_array()
        .expect("single-chain pools output should include pools");
    assert_eq!(pools.len(), 1);
    assert_eq!(pools[0]["chain"], Value::Null);
}

#[test]
fn single_chain_pools_skip_foreign_chain_stats_entries_without_spurious_warnings() {
    let fixture =
        launch_fixture_server_with_behavior(FixtureBehavior::default().with_pools_stats_override(
            1,
            serde_json::json!([
                {
                    "scope": "12345",
                    "chainId": 1,
                    "poolAddress": "0x1234567890abcdef1234567890abcdef12345678",
                    "tokenAddress": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                    "tokenSymbol": "ETH",
                    "totalDepositsCount": 42
                },
                {
                    "scope": "12345",
                    "chainId": 10,
                    "poolAddress": "0x9999999999999999999999999999999999999999",
                    "tokenAddress": "0x9999999999999999999999999999999999999998",
                    "tokenSymbol": "ETH",
                    "totalDepositsCount": 99
                }
            ]),
        ));
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_MAINNET", rpc_url.as_str()),
    ];

    let pools = run_native_with_env(&["--chain", "mainnet", "pools", "--agent"], &env);
    assert!(pools.status.success());
    assert!(stderr_string(&pools).trim().is_empty());

    let payload = parse_stdout_json(&pools);
    assert_eq!(payload["success"], Value::Bool(true));
    let pools = payload["pools"]
        .as_array()
        .expect("single-chain pools output should include pools");
    assert_eq!(pools.len(), 1);
    assert_eq!(pools[0]["asset"], Value::String("ETH".to_string()));
}

#[test]
fn multi_chain_pools_queries_keep_partial_failure_warnings_stable() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_MAINNET", rpc_url.as_str()),
        ("PRIVACY_POOLS_RPC_URL_ARBITRUM", rpc_url.as_str()),
        ("PRIVACY_POOLS_RPC_URL_OPTIMISM", "http://127.0.0.1:9"),
    ];

    let pools = run_native_with_env(&["pools", "--agent"], &env);
    assert!(pools.status.success());
    assert!(stderr_string(&pools).trim().is_empty());

    let payload = parse_stdout_json(&pools);
    assert_eq!(payload["success"], Value::Bool(true));
    assert_eq!(payload["allChains"], Value::Bool(true));
    let warnings = payload["warnings"]
        .as_array()
        .expect("partial failures should produce warnings");
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0]["chain"], Value::String("optimism".to_string()));

    let chains = payload["chains"]
        .as_array()
        .expect("multi-chain pools should expose chain summaries");
    assert_eq!(chains.len(), 3);
    assert_eq!(chains[0]["chain"], Value::String("mainnet".to_string()));
    assert_eq!(chains[1]["chain"], Value::String("arbitrum".to_string()));
    assert_eq!(chains[2]["chain"], Value::String("optimism".to_string()));
    assert_eq!(chains[2]["pools"], Value::Number(0.into()));
    assert!(chains[2]["error"]
        .as_str()
        .unwrap_or_default()
        .contains("Failed to resolve pools on optimism"));

    let pools = payload["pools"]
        .as_array()
        .expect("successful chains should still return their pools");
    assert_eq!(pools.len(), 2);
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
fn explicit_native_read_only_subroutes_stay_covered_in_rust() {
    let fixture = launch_fixture_server();
    let asp_host = fixture.base_url().to_string();
    let rpc_url = fixture.base_url().to_string();
    let env = [
        ("PRIVACY_POOLS_ASP_HOST", asp_host.as_str()),
        ("PRIVACY_POOLS_RPC_URL_SEPOLIA", rpc_url.as_str()),
    ];

    let pool_activity = run_native_with_env(
        &[
            "--chain", "sepolia", "activity", "--asset", "ETH", "--agent",
        ],
        &env,
    );
    assert!(pool_activity.status.success());
    assert!(stderr_string(&pool_activity).trim().is_empty());
    let pool_activity_payload = parse_stdout_json(&pool_activity);
    assert_eq!(pool_activity_payload["success"], Value::Bool(true));
    assert_eq!(
        pool_activity_payload["mode"],
        Value::String("pool-activity".to_string())
    );
    assert_eq!(
        pool_activity_payload["chain"],
        Value::String("sepolia".to_string())
    );
    assert_eq!(
        pool_activity_payload["asset"],
        Value::String("ETH".to_string())
    );
    assert_eq!(
        pool_activity_payload["scope"],
        Value::String("12345".to_string())
    );

    let stats_global = run_native_with_env(&["stats", "global", "--agent"], &env);
    assert!(stats_global.status.success());
    assert!(stderr_string(&stats_global).trim().is_empty());
    let stats_global_payload = parse_stdout_json(&stats_global);
    assert_eq!(stats_global_payload["success"], Value::Bool(true));
    assert_eq!(
        stats_global_payload["mode"],
        Value::String("global-stats".to_string())
    );
    assert_eq!(
        stats_global_payload["chain"],
        Value::String("all-mainnets".to_string())
    );
    assert!(stats_global_payload["chains"].is_array());
}

#[test]
fn invalid_native_read_only_flag_combinations_fail_cleanly() {
    let fixture = launch_fixture_server();
    let stats_global = run_native_with_env(
        &["--agent", "--chain", "sepolia", "stats", "global"],
        &[("PRIVACY_POOLS_ASP_HOST", fixture.base_url())],
    );
    assert_eq!(stats_global.status.code(), Some(2));
    assert!(stderr_string(&stats_global).trim().is_empty());
    let stats_global_payload = parse_stdout_json(&stats_global);
    assert_eq!(stats_global_payload["success"], Value::Bool(false));
    assert_eq!(
        stats_global_payload["errorCode"],
        Value::String("INPUT_ERROR".to_string())
    );
    assert!(stats_global_payload["errorMessage"]
        .as_str()
        .unwrap_or_default()
        .contains("Global statistics are aggregated across all chains"),);
    assert!(stats_global_payload["error"]["hint"]
        .as_str()
        .unwrap_or_default()
        .contains("For chain-specific data use: privacy-pools stats pool"),);

    let pools_with_rpc_url =
        run_native_with_env(&["--agent", "pools", "--rpc-url", fixture.base_url()], &[]);
    assert_eq!(pools_with_rpc_url.status.code(), Some(2));
    assert!(stderr_string(&pools_with_rpc_url).trim().is_empty());
    let pools_payload = parse_stdout_json(&pools_with_rpc_url);
    assert_eq!(pools_payload["success"], Value::Bool(false));
    assert_eq!(
        pools_payload["errorCode"],
        Value::String("INPUT_ERROR".to_string())
    );
    assert!(pools_payload["errorMessage"]
        .as_str()
        .unwrap_or_default()
        .contains("--rpc-url cannot be combined with multi-chain queries"),);
    assert!(pools_payload["error"]["hint"]
        .as_str()
        .unwrap_or_default()
        .contains("Use --chain <name> to target a single chain with --rpc-url"),);
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
