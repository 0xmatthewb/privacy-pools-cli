import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  TEST_MNEMONIC,
  TEST_PRIVATE_KEY,
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";
import {
  assertCapabilitiesAgentContract,
  assertDescribeWithdrawQuoteAgentContract,
  assertGuideAgentContract,
  assertStatusDegradedHealthAgentContract,
  assertStatusSetupRequiredAgentContract,
  assertUnknownCommandAgentContract,
} from "../helpers/agent-contract.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { CLI_ROOT } from "../helpers/paths.ts";
import { npmBin } from "../helpers/npm-bin.ts";
import {
  cleanupWorkspaceSnapshot,
  createBuiltWorkspaceSnapshot,
  createWorkspaceSnapshot,
} from "../helpers/workspace-snapshot.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
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
const currentPackageName = launcherTestInternals.nativePackageName();
const nativePackageSmokeTest =
  CARGO_AVAILABLE && currentTriplet && currentPackageName ? test : test.skip;
const BANNER_SENTINEL =
  ",---. ,---. ,-.-.   .-.--.   ,--.-.   .-.   ,---.  .---.  .---. ,-.     .---.";
const PREPARED_CLI_TARBALL =
  process.env.PP_INSTALL_CLI_TARBALL?.trim() || null;
const PREPARED_NATIVE_TARBALL =
  process.env.PP_INSTALL_NATIVE_TARBALL?.trim() || null;
const USE_EXISTING_DIST = process.env.PP_INSTALL_USE_EXISTING_DIST?.trim() === "1";

function createPreparedCliSnapshot(tarballPath: string): string {
  const installRoot = createTrackedTempDir("pp-native-package-cli-install-");
  const snapshotContainer = createTrackedTempDir("pp-native-package-cli-root-");
  const snapshotRoot = join(snapshotContainer, "workspace");

  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify(
      {
        name: "pp-native-package-smoke-root",
        private: true,
        dependencies: {
          "privacy-pools-cli": `file:${resolve(tarballPath)}`,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const installResult = spawnSync(
    npmBin(),
    [
      "install",
      "--silent",
      "--no-package-lock",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    {
      cwd: installRoot,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: buildChildProcessEnv(),
    },
  );

  if (installResult.status !== 0) {
    throw new Error(
      `installing prepared cli tarball failed (exit ${installResult.status}):\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  cpSync(
    join(installRoot, "node_modules", "privacy-pools-cli"),
    snapshotRoot,
    {
      recursive: true,
    },
  );
  return snapshotRoot;
}

function installPreparedNativePackage(snapshotRoot: string, tarballPath: string): void {
  const result = spawnSync(
    npmBin(),
    [
      "install",
      "--silent",
      "--no-save",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      resolve(tarballPath),
    ],
    {
      cwd: snapshotRoot,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: buildChildProcessEnv(),
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `installing prepared native tarball failed (exit ${result.status}):\n${result.stderr}\n${result.stdout}`,
    );
  }
}

describe("native package smoke", () => {
  let nativeBinary: string;
  let snapshotRoot: string;
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    if (!CARGO_AVAILABLE || !currentTriplet) return;
    if (!PREPARED_NATIVE_TARBALL) {
      nativeBinary = ensureNativeShellBinary();
    }
    snapshotRoot = PREPARED_CLI_TARBALL
      ? createPreparedCliSnapshot(PREPARED_CLI_TARBALL)
      : USE_EXISTING_DIST
        ? createWorkspaceSnapshot({
            includeDist: true,
            nodeModulesMode: "copy",
          })
        : createBuiltWorkspaceSnapshot({ nodeModulesMode: "copy" });
    fixture = await launchFixtureServer();

    if (PREPARED_NATIVE_TARBALL) {
      installPreparedNativePackage(snapshotRoot, PREPARED_NATIVE_TARBALL);
    } else {
      const outputDir = join(
        snapshotRoot,
        "node_modules",
        ...currentPackageName!.split("/"),
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
    }
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
    cleanupWorkspaceSnapshot(snapshotRoot);
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
        "--recovery-phrase",
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

  nativePackageSmokeTest("packaged launcher keeps bare welcome output on stdout and only prints the banner once per session", () => {
    const termSessionId = `pp-native-package-welcome-${Date.now()}`;
    const env = {
      TERM_SESSION_ID: termSessionId,
    };

    const firstResult = runBuiltCli([], {
      cwd: snapshotRoot,
      env,
    });

    expect(firstResult.status).toBe(0);
    expect(firstResult.stdout).toContain("Explore (no wallet needed)");
    expect(firstResult.stdout).toContain("For large transactions, use privacypools.com.");
    expect(firstResult.stderr).toContain(BANNER_SENTINEL);
    expect(firstResult.stderr).toContain(
      "A compliant way to transact privately on Ethereum.",
    );

    const secondResult = runBuiltCli([], {
      cwd: snapshotRoot,
      env,
    });

    expect(secondResult.status).toBe(0);
    expect(secondResult.stdout).toContain("Explore (no wallet needed)");
    expect(secondResult.stderr).not.toContain(BANNER_SENTINEL);
  });

  nativePackageSmokeTest("packaged native honors quiet mode for human capabilities output", () => {
    const result = runBuiltCli(["--quiet", "capabilities"], {
      cwd: snapshotRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr.trim()).toBe("");
  });

  nativePackageSmokeTest("packaged native keeps discovery structured when agent mode and csv are mixed", () => {
    const guideResult = runBuiltCli(["--agent", "--format", "csv", "guide"], {
      cwd: snapshotRoot,
    });
    expect(guideResult.status).toBe(0);
    expect(guideResult.stderr.trim()).toBe("");
    expect(
      parseJsonOutput<{ success: boolean; mode: string; help: string }>(
        guideResult.stdout,
      ),
    ).toMatchObject({
      success: true,
      mode: "help",
    });

    const capabilitiesResult = runBuiltCli(
      ["--json", "--format", "csv", "capabilities"],
      {
        cwd: snapshotRoot,
      },
    );
    expect(capabilitiesResult.status).toBe(0);
    expect(capabilitiesResult.stderr.trim()).toBe("");
    expect(
      parseJsonOutput<{ success: boolean; commands: unknown[] }>(
        capabilitiesResult.stdout,
      ),
    ).toMatchObject({
      success: true,
    });
  });

  nativePackageSmokeTest("representative agent contracts stay stable through the packaged native path", () => {
    assertGuideAgentContract(
      runBuiltCli(["--agent", "guide"], {
        cwd: snapshotRoot,
      }),
    );
    assertCapabilitiesAgentContract(
      runBuiltCli(["--agent", "capabilities"], {
        cwd: snapshotRoot,
      }),
    );
    assertDescribeWithdrawQuoteAgentContract(
      runBuiltCli(["--agent", "describe", "withdraw", "quote"], {
        cwd: snapshotRoot,
      }),
    );
    assertStatusSetupRequiredAgentContract(
      runBuiltCli(["--agent", "status", "--no-check"], {
        cwd: snapshotRoot,
        home: createTempHome("pp-native-agent-setup-"),
      }),
    );

    const degradedHome = createTempHome("pp-native-agent-degraded-");
    mustInitSeededHome(degradedHome, "sepolia");
    assertStatusDegradedHealthAgentContract(
      runBuiltCli(["--agent", "status", "--check"], {
        cwd: snapshotRoot,
        home: degradedHome,
        env: {
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
          PRIVACY_POOLS_RPC_URL: "http://127.0.0.1:9",
        },
        timeoutMs: 30_000,
      }),
    );

    assertUnknownCommandAgentContract(
      runBuiltCli(["--agent", "not-a-command"], {
        cwd: snapshotRoot,
      }),
    );
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

  nativePackageSmokeTest("broken-worker help check still distinguishes native from js fallback", () => {
    const result = runBuiltCli(["flow", "--help"], {
      cwd: snapshotRoot,
      env: {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_CLI_JS_WORKER: join(snapshotRoot, "missing-worker.js"),
      },
    });

    expect(result.status).not.toBe(0);
  });

  nativePackageSmokeTest("packaged native returns a structured js-runtime error when the worker path is broken", () => {
    const result = runBuiltCli(["--agent", "status", "--no-check"], {
      cwd: snapshotRoot,
      env: {
        PRIVACY_POOLS_CLI_JS_WORKER: join(snapshotRoot, "missing-worker.js"),
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout).not.toContain("MODULE_NOT_FOUND");

    const payload = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; hint?: string };
    }>(result.stdout);
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe("INPUT_ERROR");
    expect(payload.error.category).toBe("INPUT");
    expect(payload.errorMessage).toContain("JS runtime worker is unavailable");
    expect(payload.error.hint).toContain("PRIVACY_POOLS_CLI_JS_WORKER");
  });

  nativePackageSmokeTest("packaged native keeps broken bare invocation human-readable when the worker path is broken", () => {
    const result = runBuiltCli([], {
      cwd: snapshotRoot,
      env: {
        PRIVACY_POOLS_CLI_JS_WORKER: join(snapshotRoot, "missing-worker.js"),
      },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("The JS runtime worker is unavailable.");
    expect(result.stderr).not.toContain("MODULE_NOT_FOUND");
    expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
  });

  nativePackageSmokeTest("prepared native package keeps its binary internal to avoid shadowing the public launcher", () => {
    const packageJsonPath = join(
      snapshotRoot,
      "node_modules",
      ...currentPackageName!.split("/"),
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
        "--recovery-phrase-stdin",
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
        "--recovery-phrase",
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
        "--recovery-phrase",
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
      ...currentPackageName!.split("/"),
      "package.json",
    );
    const originalPackageJson = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(originalPackageJson) as {
      privacyPoolsCliNative?: Record<string, unknown>;
    };
    parsed.privacyPoolsCliNative = {
      ...parsed.privacyPoolsCliNative,
      bridgeVersion: "999",
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

  nativePackageSmokeTest("incompatible packaged native metadata still falls back to successful JS-owned commands", () => {
    const packageJsonPath = join(
      snapshotRoot,
      "node_modules",
      ...currentPackageName!.split("/"),
      "package.json",
    );
    const originalPackageJson = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(originalPackageJson) as {
      privacyPoolsCliNative?: Record<string, unknown>;
    };
    parsed.privacyPoolsCliNative = {
      ...parsed.privacyPoolsCliNative,
      bridgeVersion: "999",
    };
    writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

    const home = createTempHome("pp-native-package-incompatible-fallback-");

    try {
      const initResult = runBuiltCli(
        [
          "--agent",
          "init",
          "--recovery-phrase",
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
      expect(parseJsonOutput<{ success: boolean }>(initResult.stdout).success).toBe(true);

      const statusResult = runBuiltCli(["--agent", "status", "--no-check"], {
        cwd: snapshotRoot,
        home,
      });

      expect(statusResult.status).toBe(0);
      expect(
        parseJsonOutput<{ success: boolean; recoveryPhraseSet: boolean }>(
          statusResult.stdout,
        ),
      ).toMatchObject({
        success: true,
        recoveryPhraseSet: true,
      });
    } finally {
      writeFileSync(packageJsonPath, originalPackageJson, "utf8");
    }
  });
});
