import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TEST_MNEMONIC,
  TEST_PRIVATE_KEY,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { CLI_ROOT } from "../helpers/paths.ts";
import { createBuiltWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";
import {
  killFixtureServer,
  launchFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import {
  CARGO_AVAILABLE,
  ensureNativeShellBinary,
} from "../helpers/native.ts";
import { launcherTestInternals } from "../../src/launcher.ts";

const currentTriplet = launcherTestInternals.nativeTriplet();
const nativePackageSmokeTest =
  CARGO_AVAILABLE && currentTriplet ? test : test.skip;

describe("native package smoke", () => {
  let nativeBinary: string;
  let snapshotRoot: string;
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    if (!CARGO_AVAILABLE || !currentTriplet) return;
    nativeBinary = ensureNativeShellBinary();
    snapshotRoot = createBuiltWorkspaceSnapshot({ nodeModulesMode: "copy" });
    fixture = await launchFixtureServer();

    const outputDir = join(
      snapshotRoot,
      "node_modules",
      "@0xbow",
      `privacy-pools-cli-native-${currentTriplet}`,
    );
    const result = spawnSync(
      "node",
      [
        join(CLI_ROOT, "scripts", "prepare-native-package.mjs"),
        "--triplet",
        currentTriplet,
        "--binary",
        nativeBinary,
        "--out-dir",
        outputDir,
      ],
      {
        cwd: CLI_ROOT,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: buildChildProcessEnv(),
      },
    );

    if (result.status !== 0) {
      throw new Error(
        `prepare-native-package failed (exit ${result.status}):\n${result.stderr}\n${result.stdout}`,
      );
    }
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  nativePackageSmokeTest("launcher prefers the packaged native binary by default and keeps JS forwarding intact", () => {
    const home = createTempHome("pp-native-package-smoke-");
    const helpResult = runBuiltCli(["--help"], {
      cwd: snapshotRoot,
    });

    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("privacy-pools");
    expect(helpResult.stderr.trim()).toBe("");

    const initResult = runBuiltCli(
      [
        "--agent",
        "init",
        "--mnemonic",
        TEST_MNEMONIC,
        "--private-key",
        TEST_PRIVATE_KEY,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        cwd: snapshotRoot,
        home,
        timeoutMs: 60_000,
      },
    );

    expect(initResult.status).toBe(0);
    const payload = parseJsonOutput<{ success: boolean; defaultChain: string }>(
      initResult.stdout,
    );
    expect(payload.success).toBe(true);
    expect(payload.defaultChain).toBe("sepolia");

    const statusResult = runBuiltCli(["--agent", "status", "--no-check"], {
      cwd: snapshotRoot,
      home,
    });
    expect(statusResult.status).toBe(0);
    expect(parseJsonOutput<{ success: boolean }>(statusResult.stdout).success).toBe(true);
  });

  nativePackageSmokeTest("packaged native still serves native-owned help when the JS worker path is broken", () => {
    const result = runBuiltCli(["flow", "--help"], {
      cwd: snapshotRoot,
      env: {
        PRIVACY_POOLS_CLI_JS_WORKER: join(snapshotRoot, "missing-worker.js"),
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: privacy-pools flow");
    expect(result.stderr).toBe("");
  });

  nativePackageSmokeTest("prepared native package keeps its binary internal to avoid shadowing the public launcher", () => {
    const packageJsonPath = join(
      snapshotRoot,
      "node_modules",
      "@0xbow",
      `privacy-pools-cli-native-${currentTriplet}`,
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      bin?: string | Record<string, string>;
      privacyPoolsCliNative?: { binaryPath?: string };
    };

    expect(pkg.bin).toBeUndefined();
    expect(pkg.privacyPoolsCliNative?.binaryPath).toBeTruthy();
  });

  nativePackageSmokeTest("packaged native executes fixture-backed public read-only commands successfully", () => {
    const env = {
      PRIVACY_POOLS_ASP_HOST: fixture!.url,
      PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
    };

    const statsResult = runBuiltCli(["--agent", "stats"], {
      cwd: snapshotRoot,
      env,
    });
    expect(statsResult.status).toBe(0);
    expect(parseJsonOutput<{ success: boolean; mode: string }>(statsResult.stdout)).toMatchObject({
      success: true,
      mode: "global-stats",
    });

    const statsPoolResult = runBuiltCli(
      ["--agent", "--chain", "sepolia", "stats", "pool", "--asset", "ETH"],
      {
        cwd: snapshotRoot,
        env,
      },
    );
    expect(statsPoolResult.status).toBe(0);
    expect(
      parseJsonOutput<{ success: boolean; mode: string; asset: string }>(
        statsPoolResult.stdout,
      ),
    ).toMatchObject({
      success: true,
      mode: "pool-stats",
      asset: "ETH",
    });

    const activityResult = runBuiltCli(["--agent", "activity"], {
      cwd: snapshotRoot,
      env,
    });
    expect(activityResult.status).toBe(0);
    expect(
      parseJsonOutput<{ success: boolean; mode: string; events: unknown[] }>(
        activityResult.stdout,
      ),
    ).toMatchObject({
      success: true,
      mode: "global-activity",
    });

    const poolsResult = runBuiltCli(["--agent", "--chain", "sepolia", "pools"], {
      cwd: snapshotRoot,
      env,
    });
    expect(poolsResult.status).toBe(0);
    expect(
      parseJsonOutput<{ success: boolean; pools: Array<{ asset: string }> }>(
        poolsResult.stdout,
      ),
    ).toMatchObject({
      success: true,
    });

    const humanStatsResult = runBuiltCli(["stats"], {
      cwd: snapshotRoot,
      env,
    });
    expect(humanStatsResult.status).toBe(0);
    expect(humanStatsResult.stdout).toBe("");
    expect(humanStatsResult.stderr).toContain("Global statistics (all-mainnets):");

    const csvStatsResult = runBuiltCli(["--format", "csv", "stats"], {
      cwd: snapshotRoot,
      env,
    });
    expect(csvStatsResult.status).toBe(0);
    expect(csvStatsResult.stderr).toContain("Fetching global statistics");
    expect(csvStatsResult.stdout).toContain("Metric,All Time,Last 24h");

    const humanActivityResult = runBuiltCli(["activity"], {
      cwd: snapshotRoot,
      env,
    });
    expect(humanActivityResult.status).toBe(0);
    expect(humanActivityResult.stdout).toBe("");
    expect(humanActivityResult.stderr).toContain("Global activity");

    const csvPoolsResult = runBuiltCli(["--format", "csv", "--chain", "sepolia", "pools"], {
      cwd: snapshotRoot,
      env,
    });
    expect(csvPoolsResult.status).toBe(0);
    expect(csvPoolsResult.stderr).toBe("");
    expect(csvPoolsResult.stdout).toContain("Asset,Total Deposits,Pool Balance");
  });

  nativePackageSmokeTest("packaged native preserves stdin secret forwarding without leaking secrets", () => {
    const mnemonicHome = createTempHome("pp-native-package-mnemonic-stdin-");
    const mnemonicResult = runBuiltCli(
      [
        "--agent",
        "init",
        "--mnemonic-stdin",
        "--private-key",
        TEST_PRIVATE_KEY,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        cwd: snapshotRoot,
        home: mnemonicHome,
        input: `${TEST_MNEMONIC}\n`,
        timeoutMs: 60_000,
      },
    );

    expect(mnemonicResult.status).toBe(0);
    expect(parseJsonOutput<{ success: boolean }>(mnemonicResult.stdout).success).toBe(true);
    expect(mnemonicResult.stdout).not.toContain(TEST_MNEMONIC);
    expect(mnemonicResult.stderr).not.toContain(TEST_MNEMONIC);

    const privateKeyHome = createTempHome("pp-native-package-key-stdin-");
    const privateKeyResult = runBuiltCli(
      [
        "--agent",
        "init",
        "--mnemonic",
        TEST_MNEMONIC,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        cwd: snapshotRoot,
        home: privateKeyHome,
        input: `${TEST_PRIVATE_KEY}\n`,
        timeoutMs: 60_000,
      },
    );

    expect(privateKeyResult.status).toBe(0);
    expect(parseJsonOutput<{ success: boolean }>(privateKeyResult.stdout).success).toBe(true);
    expect(privateKeyResult.stdout).not.toContain(TEST_PRIVATE_KEY);
    expect(privateKeyResult.stderr).not.toContain(TEST_PRIVATE_KEY);
  });

  nativePackageSmokeTest("packaged native selection survives even when the JS stats handler is unavailable", () => {
    const statsHandlerPath = join(snapshotRoot, "dist", "commands", "stats.js");
    const statsHandlerBackupPath = `${statsHandlerPath}.bak`;
    renameSync(statsHandlerPath, statsHandlerBackupPath);

    try {
      const result = runBuiltCli(["--agent", "stats"], {
        cwd: snapshotRoot,
        env: {
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr.trim()).toBe("");

      const payload = parseJsonOutput<{
        success: boolean;
        errorCode?: string;
      }>(result.stdout);
      expect(payload.success).toBe(false);
      expect(payload.errorCode).toBe("RPC_NETWORK_ERROR");
    } finally {
      renameSync(statsHandlerBackupPath, statsHandlerPath);
    }
  });

  nativePackageSmokeTest("disable-native still forces the js fallback when a packaged binary exists", () => {
    const helpResult = runBuiltCli(["--help"], {
      cwd: snapshotRoot,
      env: {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    });

    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("privacy-pools");
    expect(helpResult.stderr.trim()).toBe("");

    const home = createTempHome("pp-native-package-disable-native-");
    const initResult = runBuiltCli(
      [
        "--agent",
        "init",
        "--mnemonic",
        TEST_MNEMONIC,
        "--private-key",
        TEST_PRIVATE_KEY,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        cwd: snapshotRoot,
        home,
        timeoutMs: 60_000,
        env: {
          PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        },
      },
    );

    expect(initResult.status).toBe(0);
    expect(parseJsonOutput<{ success: boolean }>(initResult.stdout).success).toBe(true);

    const statusResult = runBuiltCli(["--agent", "status", "--no-check"], {
      cwd: snapshotRoot,
      home,
      env: {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    });

    expect(statusResult.status).toBe(0);
    expect(parseJsonOutput<{ success: boolean }>(statusResult.stdout).success).toBe(true);
  });

  nativePackageSmokeTest("launcher falls back to JS when the packaged native bridge metadata is incompatible", () => {
    const packageJsonPath = join(
      snapshotRoot,
      "node_modules",
      "@0xbow",
      `privacy-pools-cli-native-${currentTriplet}`,
      "package.json",
    );
    const originalPackageJson = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(originalPackageJson) as {
      privacyPoolsCliNative?: Record<string, unknown>;
    };
    parsed.privacyPoolsCliNative = {
      ...parsed.privacyPoolsCliNative,
      bridgeVersion: "999",
      protocolVersion: "999",
    };
    writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const statsHandlerPath = join(snapshotRoot, "dist", "commands", "stats.js");
    const statsHandlerBackupPath = `${statsHandlerPath}.bak`;
    renameSync(statsHandlerPath, statsHandlerBackupPath);

    try {
      const result = runBuiltCli(["--agent", "stats"], {
        cwd: snapshotRoot,
        env: {
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr.trim()).toBe("");

      const payload = parseJsonOutput<{
        success: boolean;
        errorCode?: string;
      }>(result.stdout);
      expect(payload.success).toBe(false);
      expect(payload.errorCode).toBeTruthy();
    } finally {
      renameSync(statsHandlerBackupPath, statsHandlerPath);
      writeFileSync(packageJsonPath, originalPackageJson, "utf8");
    }
  });
});
