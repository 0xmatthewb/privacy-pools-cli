import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  createSeededHome,
  createTempHome,
  parseJsonOutput,
} from "../helpers/cli.ts";
import {
  type FixtureServer,
  killFixtureServer,
  launchFixtureServer,
} from "../helpers/fixture-server.ts";
import {
  DEFAULT_PARITY_COMMAND_TIMEOUT_MS,
  expectDirectNativeBuiltJsonParity,
  expectJsonErrorContract,
  expectJsonParity,
  expectMachineSilenceParity,
  expectSilentStreamParity,
  expectStreamParity,
  fixtureEnv,
  multiChainFixtureEnv,
  nativeTest,
  normalizeParityStderr,
  resolveParityTestTimeout,
  runBuiltCli,
  runNativeBinaryDirect,
  runNativeBuiltCli,
  seedSavedWorkflow,
  TEST_RECIPIENT,
  withJsFallback,
  ensureNativeShellBinary,
} from "../helpers/native-shell.ts";
import { expectJsonGolden } from "../helpers/golden.ts";
import {
  GOLDEN_JSON_CASES,
  resolveGoldenCaseRunOptions,
} from "../helpers/golden-cli-cases.ts";

describe("native machine contract parity", () => {
  let nativeBinary: string;
  let fixture: FixtureServer | null = null;
  const sharedJsonCases = GOLDEN_JSON_CASES.filter((goldenCase) => goldenCase.sharedNative);

  beforeAll(async () => {
    nativeBinary = ensureNativeShellBinary();
    fixture = await launchFixtureServer();
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  for (const goldenCase of sharedJsonCases) {
    nativeTest(goldenCase.name, () => {
      const runOptions = resolveGoldenCaseRunOptions(goldenCase.env, fixture);
      const jsResult = runBuiltCli(goldenCase.args, withJsFallback(runOptions));
      const nativeResult = runNativeBuiltCli(nativeBinary, goldenCase.args, runOptions);

      expect(jsResult.status).toBe(goldenCase.status);
      expect(nativeResult.status).toBe(goldenCase.status);
      expect(jsResult.stderr).toBe("");
      expect(nativeResult.stderr).toBe("");
      expectJsonGolden(goldenCase.name, parseJsonOutput(jsResult.stdout));
      expectJsonGolden(goldenCase.name, parseJsonOutput(nativeResult.stdout));
    });
  }

  nativeTest("structured root help stays machine-readable", () => {
    expectJsonParity(nativeBinary, ["--json", "--help"]);
  });

  nativeTest("machine-readable version output stays identical", () => {
    expectJsonParity(nativeBinary, ["--json", "--version"]);
  });

  nativeTest("machine-readable guide and capabilities outputs stay identical", () => {
    expectJsonParity(nativeBinary, ["--agent", "guide"]);
    expectJsonParity(nativeBinary, ["--agent", "capabilities"]);
  });

  nativeTest("completion scripts and query payloads stay identical", () => {
    expectStreamParity(nativeBinary, ["completion", "bash"]);
    expectJsonParity(nativeBinary, [
      "--json",
      "completion",
      "--query",
      "--shell",
      "bash",
      "--cword",
      "1",
      "--",
      "privacy-pools",
    ]);
    expectStreamParity(nativeBinary, [
      "completion",
      "--query",
      "--shell",
      "bash",
      "--cword",
      "3",
      "--",
      "privacy-pools",
      "deposit",
      "--unsigned",
      "",
    ]);
  });

  nativeTest("public read-only agent paths stay JSON-identical on fixture data", () => {
    const singleChainEnv = fixtureEnv(fixture!);
    const multiChainEnv = multiChainFixtureEnv(fixture!);

    expectJsonParity(nativeBinary, ["--agent", "stats"], {
      js: { env: singleChainEnv },
      native: { env: singleChainEnv },
    });
    expectJsonParity(
      nativeBinary,
      ["--agent", "--chain", "sepolia", "stats", "pool", "ETH"],
      {
        js: { env: singleChainEnv },
        native: { env: singleChainEnv },
      },
    );
    expectJsonParity(nativeBinary, ["--agent", "activity"], {
      js: { env: singleChainEnv },
      native: { env: singleChainEnv },
    });
    expectJsonParity(nativeBinary, ["--agent", "pools"], {
      js: { env: multiChainEnv },
      native: { env: multiChainEnv },
    });
    expectJsonParity(nativeBinary, ["--agent", "--chain", "sepolia", "pools"], {
      js: { env: singleChainEnv },
      native: { env: singleChainEnv },
    });
  });

  nativeTest("offline public envelopes and degraded pool discovery stay aligned", () => {
    const offlineActivityArgs = ["--json", "--chain", "mainnet", "activity"];
    const offlineActivityEnv = { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" };
    const jsOfflineActivity = runBuiltCli(
      offlineActivityArgs,
      withJsFallback({ env: offlineActivityEnv }),
    );
    const nativeOfflineActivity = runNativeBuiltCli(
      nativeBinary,
      offlineActivityArgs,
      { env: offlineActivityEnv },
    );
    for (const result of [jsOfflineActivity, nativeOfflineActivity]) {
      expectJsonErrorContract(result, {
        status: 3,
        errorCode: "RPC_NETWORK_ERROR",
        category: "RPC",
        message: "Network error",
      });
      expect(normalizeParityStderr(result.stderr)).toBe("");
    }
    expect(nativeOfflineActivity.status).toBe(jsOfflineActivity.status);

    expectJsonParity(
      nativeBinary,
      ["--json", "--chain", "mainnet", "stats", "pool", "ETH"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
          },
        },
      },
    );
    expectJsonParity(
      nativeBinary,
      ["--json", "--chain", "sepolia", "stats", "pool", "ETH"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
          },
        },
      },
    );
    expectJsonParity(nativeBinary, ["--json", "stats"], {
      js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
    });
    expectJsonParity(nativeBinary, ["--json", "--chain", "sepolia", "pools"], {
      js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
    });
    expectJsonParity(
      nativeBinary,
      ["--json", "--chain", "sepolia", "pools"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture!.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture!.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
          },
        },
      },
    );
  }, 60_000);

  nativeTest("quiet and machine stream contracts stay intact across native routing", () => {
    const env = fixtureEnv(fixture!);
    expectSilentStreamParity(nativeBinary, ["--quiet", "activity"], {
      js: { env },
      native: { env },
    });

    const seededHome = createSeededHome("sepolia");

    expectStreamParity(
      nativeBinary,
      ["--quiet", "--no-banner", "status", "--no-check"],
      {
        js: { home: seededHome },
        native: { home: seededHome },
      },
    );
    expectMachineSilenceParity(
      nativeBinary,
      ["--agent", "status", "--no-check"],
      {
        js: { home: seededHome },
        native: { home: seededHome },
      },
    );
  });

  nativeTest("stats pool input validation keeps the same structured error contract", () => {
    const args = ["--json", "stats", "pool", "--chain", "sepolia"];
    const env = { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" };
    const jsResult = runBuiltCli(args, withJsFallback({ env }));
    const nativeResult = runNativeBuiltCli(nativeBinary, args, { env });

    for (const result of [jsResult, nativeResult]) {
      expectJsonErrorContract(result, {
        status: 2,
        errorCode: "INPUT_ERROR",
        category: "INPUT",
        message: "asset",
      });
      expect(normalizeParityStderr(result.stderr)).toBe("");
    }
  });

  nativeTest("direct native offline error paths stay JSON-identical without a JS bridge", () => {
    expectDirectNativeBuiltJsonParity(
      nativeBinary,
      ["--json", "stats"],
      {
        js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
        native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      },
    );

    const offlineActivityArgs = ["--json", "--chain", "mainnet", "activity"];
    const offlineActivityEnv = { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" };
    const jsOfflineActivity = runBuiltCli(
      offlineActivityArgs,
      withJsFallback({ env: offlineActivityEnv }),
    );
    const nativeOfflineActivity = runNativeBuiltCli(
      nativeBinary,
      offlineActivityArgs,
      { env: offlineActivityEnv },
    );
    const directNativeOfflineActivity = runNativeBinaryDirect(
      nativeBinary,
      offlineActivityArgs,
      { env: offlineActivityEnv },
    );
    for (const result of [
      jsOfflineActivity,
      nativeOfflineActivity,
      directNativeOfflineActivity,
    ]) {
      expectJsonErrorContract(result, {
        status: 3,
        errorCode: "RPC_NETWORK_ERROR",
        category: "RPC",
        message: "Network error",
      });
      expect(normalizeParityStderr(result.stderr)).toBe("");
    }

    expectDirectNativeBuiltJsonParity(
      nativeBinary,
      ["--agent", "pools"],
      {
        js: { env: multiChainFixtureEnv(fixture!) },
        native: { env: multiChainFixtureEnv(fixture!) },
      },
    );
    expectDirectNativeBuiltJsonParity(
      nativeBinary,
      ["--json", "--chain", "sepolia", "pools"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture!.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture!.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
          },
        },
      },
    );
  }, 30_000);

  nativeTest("flow status latest succeeds identically through native forwarding", () => {
    const jsHome = createTempHome("pp-native-flow-status-success-js-");
    const nativeHome = createTempHome("pp-native-flow-status-success-native-");
    seedSavedWorkflow(jsHome);
    seedSavedWorkflow(nativeHome);

    expectJsonParity(nativeBinary, ["--agent", "flow", "status", "latest"], {
      js: { home: jsHome },
      native: { home: nativeHome },
    });
  });

  const forwardingCases = [
    {
      label: "flow status latest",
      args: ["--agent", "flow", "status", "latest"],
    },
    {
      label: "flow start",
      args: ["--agent", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT],
      testTimeoutMs: 20_000,
    },
    {
      label: "deposit",
      args: ["--agent", "deposit", "0.1", "ETH"],
      testTimeoutMs: 20_000,
    },
    {
      label: "withdraw quote",
      args: [
        "--agent",
        "--chain",
        "not-a-chain",
        "withdraw",
        "quote",
        "0.1",
        "ETH",
        "--to",
        TEST_RECIPIENT,
      ],
    },
    {
      label: "withdraw",
      args: ["--agent", "withdraw", "0.1", "ETH", "--to", TEST_RECIPIENT],
    },
    {
      label: "ragequit",
      args: ["--agent", "--chain", "sepolia", "ragequit", "ETH", "--pool-account", "PA-1"],
      envFactory: fixtureEnv,
      testTimeoutMs: 20_000,
    },
    {
      label: "accounts",
      args: ["--agent", "accounts"],
    },
    {
      label: "sync",
      args: ["--agent", "sync"],
      timeoutMs: 45_000,
      testTimeoutMs: 120_000,
    },
  ];

  for (const { label, args, envFactory, timeoutMs, testTimeoutMs } of forwardingCases) {
    nativeTest(`${label} stays identical through native forwarding`, () => {
      const jsHome = createTempHome(`pp-native-${label.replaceAll(" ", "-")}-js-`);
      const nativeHome = createTempHome(
        `pp-native-${label.replaceAll(" ", "-")}-native-`,
      );
      const env = envFactory ? envFactory(fixture!) : undefined;

      expectJsonParity(nativeBinary, args, {
        js: { home: jsHome, env, timeoutMs },
        native: { home: nativeHome, env, timeoutMs },
      });
    }, resolveParityTestTimeout(timeoutMs ?? DEFAULT_PARITY_COMMAND_TIMEOUT_MS, testTimeoutMs));
  }
}, 300_000);
