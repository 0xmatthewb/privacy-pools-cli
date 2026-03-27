import { beforeAll, describe, expect, test } from "bun:test";
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

  beforeAll(() => {
    if (!CARGO_AVAILABLE || !currentTriplet) return;
    nativeBinary = ensureNativeShellBinary();
    snapshotRoot = createBuiltWorkspaceSnapshot();

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

  nativePackageSmokeTest("launcher prefers the packaged native binary by default and keeps JS forwarding intact", () => {
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
        home: createTempHome("pp-native-package-smoke-"),
        timeoutMs: 60_000,
      },
    );

    expect(initResult.status).toBe(0);
    const payload = parseJsonOutput<{ success: boolean; defaultChain: string }>(
      initResult.stdout,
    );
    expect(payload.success).toBe(true);
    expect(payload.defaultChain).toBe("sepolia");
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
      expect(payload.errorCode).toBeTruthy();
    } finally {
      renameSync(statsHandlerBackupPath, statsHandlerPath);
    }
  });

  nativePackageSmokeTest("disable-native still forces the js fallback when a packaged binary exists", () => {
    const result = runBuiltCli(["--help"], {
      cwd: snapshotRoot,
      env: {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("privacy-pools");
    expect(result.stderr.trim()).toBe("");
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
