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
  buildIncompatibleBridgeEnv,
  ensureNativeShellBinary,
  expectJsonParity,
  expectStreamParity,
  fixtureEnv,
  multiChainFixtureEnv,
  nativeTest,
  normalizeParityStderr,
  runBuiltCli,
  runNativeBinaryDirect,
  TEST_RECIPIENT,
  withJsFallback,
} from "../helpers/native-shell.ts";
import { expectCsvHeaderColumns } from "../helpers/contract-assertions.ts";

describe("native routing smoke", () => {
  let nativeBinary: string;
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    nativeBinary = ensureNativeShellBinary();
    fixture = await launchFixtureServer();
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  nativeTest("root argv parsing stops at -- consistently across JS and native", () => {
    expectJsonParity(nativeBinary, ["--json", "--", "status", "--json"]);
  });

  nativeTest("status --agent --no-check stays JS-owned through native forwarding", () => {
    const jsHome = createTempHome("pp-native-status-js-");
    const nativeHome = createTempHome("pp-native-status-native-");
    expectJsonParity(
      nativeBinary,
      ["--agent", "status", "--no-check"],
      {
        js: { home: jsHome },
        native: { home: nativeHome },
      },
    );
  });

  nativeTest("status --agent --check stays JS-owned through native forwarding", () => {
    const home = createSeededHome("sepolia");

    expectJsonParity(
      nativeBinary,
      [
        "--agent",
        "--chain",
        "sepolia",
        "--rpc-url",
        "http://127.0.0.1:9",
        "status",
        "--check",
      ],
      {
        js: {
          home,
          env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" },
        },
        native: {
          home,
          env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" },
        },
      },
    );
  });

  nativeTest("direct native forwarding fails closed on an incompatible JS bridge descriptor", () => {
    const result = runNativeBinaryDirect(
      nativeBinary,
      ["--agent", "status", "--no-check"],
      {
        env: buildIncompatibleBridgeEnv({ runtimeVersion: "v999" }),
      },
    );

    expect(result.status).toBe(1);
    expect(
      parseJsonOutput<{ errorMessage: string }>(result.stdout).errorMessage,
    ).toContain("JS bridge runtime version mismatch");
    expect(result.stderr).toBe("");
  });

  nativeTest("direct native forwarding fails closed on an incompatible JS bridge version", () => {
    const result = runNativeBinaryDirect(
      nativeBinary,
      ["--agent", "status", "--no-check"],
      {
        env: buildIncompatibleBridgeEnv({ nativeBridgeVersion: "999" }),
      },
    );

    expect(result.status).toBe(1);
    expect(
      parseJsonOutput<{ errorMessage: string }>(result.stdout).errorMessage,
    ).toContain("JS bridge version mismatch");
    expect(result.stderr).toBe("");
  });

  nativeTest("stats pool stays native-owned when option values follow the command path", () => {
    const args = ["--json", "--chain", "sepolia", "stats", "pool", "ETH"];
    const env = {
      PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
      PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
    };

    const jsResult = runBuiltCli(args, withJsFallback({ env }));
    const directNativeResult = runNativeBinaryDirect(nativeBinary, args, { env });

    expect(directNativeResult.status).toBe(jsResult.status);
    expect(parseJsonOutput(directNativeResult.stdout)).toEqual(
      parseJsonOutput(jsResult.stdout),
    );
    expect(normalizeParityStderr(directNativeResult.stderr)).toBe(
      normalizeParityStderr(jsResult.stderr),
    );
  }, 20_000);

  nativeTest("direct native public routes reject unsupported argv edge cases with JS parity", () => {
    expectJsonParity(
      nativeBinary,
      ["--agent", "pools", "--", "--search", "ETH"],
      {
        js: { env: multiChainFixtureEnv(fixture!) },
        native: { env: multiChainFixtureEnv(fixture!) },
      },
    );
    expectJsonParity(
      nativeBinary,
      ["--agent", "activity", "-t", "1"],
      {
        js: { env: fixtureEnv(fixture!) },
        native: { env: fixtureEnv(fixture!) },
      },
    );
    expectJsonParity(
      nativeBinary,
      ["--agent", "stats", "-t", "1"],
      {
        js: { env: fixtureEnv(fixture!) },
        native: { env: fixtureEnv(fixture!) },
      },
    );
  });

  nativeTest("native public render paths work directly without a JS bridge", () => {
    const env = fixtureEnv(fixture!);

    for (const { args, expectedText } of [
      { args: ["stats"], expectedText: "All Time" },
      { args: ["--format", "csv", "stats"], expectedText: "Metric,All Time,Last 24h" },
      { args: ["--chain", "sepolia", "stats", "pool", "ETH"] },
      { args: ["activity"] },
      { args: ["--format", "csv", "activity"], expectedText: "Type,Pool,Amount" },
      { args: ["--chain", "sepolia", "pools"] },
      { args: ["--format", "csv", "--chain", "sepolia", "pools"], expectedText: null },
    ]) {
      const result = runNativeBinaryDirect(nativeBinary, args, { env });
      const renderedOutput = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(0);
      expect(renderedOutput.trim().length).toBeGreaterThan(0);
      if (args.join(" ") === "--format csv --chain sepolia pools") {
        expectCsvHeaderColumns(result.stdout, [
          "Asset",
          "Total Deposits",
          "Pool Balance",
          "USD Value",
          "Pending",
          "Min Deposit",
          "Vetting Fee",
        ]);
      } else if (expectedText) {
        expect(renderedOutput).toContain(expectedText);
      }
      expect(result.stderr).not.toContain("JS worker bootstrap is unavailable");
    }
  });

  nativeTest("JS-owned commands still forward through the native shell unchanged", () => {
    const replacementSigner =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    const args = [
      "--agent",
      "init",
      "--signer-only",
      "--private-key",
      replacementSigner,
      "--yes",
    ];
    const jsHome = createSeededHome("sepolia");
    const nativeHome = createSeededHome("sepolia");

    expectJsonParity(nativeBinary, args, {
      js: { home: jsHome },
      native: { home: nativeHome },
    });
  });

  nativeTest("machine-friendly root completion shell output keeps parity", () => {
    expectStreamParity(nativeBinary, ["completion", "bash"]);
  });
}, 300_000);
