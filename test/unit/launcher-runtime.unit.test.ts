import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_PROTOCOL_PROFILE } from "../../src/config/protocol-profile.js";
import { launcherTestInternals, runLauncher } from "../../src/launcher.ts";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import { parseRootArgv } from "../../src/utils/root-argv.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  captureAsyncOutputAllowExit,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "../helpers/output.ts";

const PKG = { version: "1.7.0" };

function writeNativePackageJson(
  packageJsonPath: string,
  sha256: string,
  extra: Record<string, unknown> = {},
): void {
  writeFileSync(
    packageJsonPath,
    JSON.stringify({
      version: "1.7.0",
      privacyPoolsCliNative: {
        binaryPath: "bin/privacy-pools-cli-native-shell",
        bridgeVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
        protocolProfile: CLI_PROTOCOL_PROFILE.profile,
        runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
        triplet: "darwin-arm64",
        sha256,
        ...extra,
      },
    }),
    "utf8",
  );
}

describe("launcher runtime coverage", () => {
  test("native distribution helpers map supported and unsupported targets", () => {
    expect(launcherTestInternals.nativeTriplet("darwin", "arm64")).toBe("darwin-arm64");
    expect(launcherTestInternals.nativePackageName("win32", "x64")).toContain("windows-x64-msvc");
    expect(launcherTestInternals.nativeTriplet("linux", "x64", "glibc")).toBe(
      "linux-x64-gnu",
    );
    expect(
      launcherTestInternals.nativePackageName("linux", "x64", "glibc"),
    ).toContain("linux-x64-gnu");
    expect(launcherTestInternals.nativeTriplet("linux", "x64", "musl")).toBeNull();
    expect(
      launcherTestInternals.nativePackageName("linux", "x64", "musl"),
    ).toBeNull();
    expect(launcherTestInternals.nativeTriplet("linux", "x64", null)).toBeNull();
    expect(launcherTestInternals.nativePackageName("linux", "x64", null)).toBeNull();
    expect(launcherTestInternals.nativeTriplet("linux", "arm64")).toBeNull();
    expect(launcherTestInternals.nativePackageName("linux", "arm64")).toBeNull();
  });

  test("invocationContainsInlineSecrets detects both split and inline secret flags", () => {
    expect(
      launcherTestInternals.invocationContainsInlineSecrets([
        "init",
        "--mnemonic",
        "test test test test test test test test test test test junk",
      ]),
    ).toBe(true);
    expect(
      launcherTestInternals.invocationContainsInlineSecrets([
        "init",
        `--private-key=0x${"44".repeat(32)}`,
      ]),
    ).toBe(true);
    expect(
      launcherTestInternals.invocationContainsInlineSecrets([
        "status",
        "--no-check",
      ]),
    ).toBe(false);
  });

  test("validateJsWorkerPath accepts compiled workers and source twins", () => {
    const tempDir = createTrackedTempDir("pp-worker-path-");
    const compiledWorker = join(tempDir, "worker.js");
    const sourceTwin = join(tempDir, "source-twin.ts");
    writeFileSync(compiledWorker, "// worker\n", "utf8");
    writeFileSync(sourceTwin, "// worker source\n", "utf8");

    try {
      expect(() =>
        launcherTestInternals.validateJsWorkerPath({
          PRIVACY_POOLS_CLI_JS_WORKER: compiledWorker,
        }),
      ).not.toThrow();
      expect(() =>
        launcherTestInternals.validateJsWorkerPath({
          PRIVACY_POOLS_CLI_JS_WORKER: sourceTwin.replace(/\.ts$/, ".js"),
        }),
      ).not.toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("invocationRequiresJsWorker keeps root fast paths local and covers native hybrid mode routing", () => {
    expect(
      launcherTestInternals.invocationRequiresJsWorker(parseRootArgv(["--version"])),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(parseRootArgv(["--help"])),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["pools", "--help"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(parseRootArgv(["pools"])),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["pools", "--json"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["pools", "--format", "csv"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["stats", "global", "--json"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["activity", "--format", "csv"]),
      ),
    ).toBe(false);
  });

  test("tryRunLocalFastPath skips local handling when an explicit native binary is configured", async () => {
    const result = await launcherTestInternals.tryRunLocalFastPath(
      PKG,
      ["--help"],
      parseRootArgv(["--help"]),
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );

    expect(result).toBe(false);
  });

  test("tryRunLocalFastPath can be disabled for launcher-native benchmark coverage", async () => {
    const result = await launcherTestInternals.tryRunLocalFastPath(
      PKG,
      ["--help"],
      parseRootArgv(["--help"]),
      {
        PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH: "1",
      },
    );

    expect(result).toBe(false);
  });

  test("tryRunLocalFastPath serves root version and root help through the real fast paths", async () => {
    const versionResult = await captureAsyncOutputAllowExit(() =>
      launcherTestInternals.tryRunLocalFastPath(
        PKG,
        ["--version"],
        parseRootArgv(["--version"]),
      ),
    );
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout).toBe("1.7.0\n");
    expect(versionResult.stderr).toBe("");

    const helpResult = await captureAsyncOutputAllowExit(() =>
      launcherTestInternals.tryRunLocalFastPath(
        PKG,
        ["--help"],
        parseRootArgv(["--help"]),
      ),
    );
    expect(helpResult.exitCode).toBe(0);
    expect(helpResult.stdout).toContain("Usage:");
    expect(helpResult.stderr).toBe("");
  });

  test("tryRunLocalFastPath rejects invalid output formats before serving fast paths", async () => {
    const version = await captureAsyncJsonOutputAllowExit(() =>
      runLauncher(PKG, ["--json", "--format", "yaml", "--version"]),
    );
    expect(version.exitCode).toBe(2);
    expect(version.stderr).toBe("");
    expect(version.json.success).toBe(false);
    expect(version.json.errorCode).toBe("INPUT_ERROR");
    expect(version.json.errorMessage).toContain("argument 'yaml' is invalid");

    const guide = await captureAsyncJsonOutputAllowExit(() =>
      runLauncher(PKG, ["--json", "--format", "yaml", "guide"]),
    );
    expect(guide.exitCode).toBe(2);
    expect(guide.stderr).toBe("");
    expect(guide.json.success).toBe(false);
    expect(guide.json.errorCode).toBe("INPUT_ERROR");
  });

  test("tryRunLocalFastPath serves real completion and static discovery commands", async () => {
    const completionArgv = [
      "--json",
      "completion",
      "--query",
      "--shell",
      "bash",
      "--cword",
      "1",
      "--",
      "privacy-pools",
      "flo",
    ];
    const completionResult = await captureAsyncJsonOutputAllowExit(() =>
      launcherTestInternals.tryRunLocalFastPath(
        PKG,
        completionArgv,
        parseRootArgv(completionArgv),
      ),
    );
    expect(completionResult.exitCode).toBe(0);
    expect(completionResult.json).toMatchObject({
      success: true,
      mode: "completion-query",
      shell: "bash",
    });
    expect(completionResult.stderr).toBe("");

    const guideResult = await captureAsyncOutputAllowExit(() =>
      launcherTestInternals.tryRunLocalFastPath(
        PKG,
        ["guide"],
        parseRootArgv(["guide"]),
      ),
    );
    expect(guideResult.exitCode).toBe(0);
    expect(guideResult.stdout).toBe("");
    expect(guideResult.stderr).toContain("Privacy Pools: Quick Guide");
  });

  test("launcher test spawn seam can be swapped and restored", () => {
    const fakeSpawn = (() => {
      throw new Error("spawn should not be invoked in this seam test");
    }) as unknown as typeof import("node:child_process").spawn;

    launcherTestInternals.setSpawnImplementationForTests(fakeSpawn);
    launcherTestInternals.resetSpawnImplementationForTests();
  });

  test("runLauncher resolves js-owned routes inline when no worker override is set", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runLauncher(PKG, ["--agent", "status", "--no-check"]),
    );

    expect(json.success).toBe(true);
    expect(json.recoveryPhraseSet).toBeDefined();
    expect(json.readyForDeposit).toBeDefined();
    expect(stderr).toBe("");
  });

  test("runLauncher prints structured worker-path failures for js-owned routes", async () => {
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    process.env.PRIVACY_POOLS_CLI_JS_WORKER = "/tmp/pp-missing-worker.js";

    try {
      const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        runLauncher(PKG, ["--agent", "status", "--no-check"]),
      );

      expect(exitCode).toBe(2);
      expect(stderr).toBe("");
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.errorMessage).toBe("The JS runtime worker is unavailable.");
    } finally {
      if (originalWorkerOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
      } else {
        process.env.PRIVACY_POOLS_CLI_JS_WORKER = originalWorkerOverride;
      }
    }
  });

  test("runLauncher rejects secret-bearing invocations when a js worker override is set", async () => {
    const tempDir = createTrackedTempDir("pp-worker-override-runtime-");
    const workerPath = join(tempDir, "worker.js");
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    writeFileSync(workerPath, "// mocked worker path\n", "utf8");
    process.env.PRIVACY_POOLS_CLI_JS_WORKER = workerPath;

    try {
      const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        runLauncher(PKG, [
          "--agent",
          "init",
          "--mnemonic",
          "test test test test test test test test test test test junk",
          "--default-chain",
          "mainnet",
        ]),
      );

      expect(exitCode).toBe(2);
      expect(stderr).toBe("");
      expect(json.success).toBe(false);
      expect(json.errorMessage).toBe(
        "The JS worker override is unavailable for secret-bearing invocations.",
      );
    } finally {
      if (originalWorkerOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
      } else {
        process.env.PRIVACY_POOLS_CLI_JS_WORKER = originalWorkerOverride;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runLauncher sanitizes native spawn failures through the shared cli error path", async () => {
    const originalBinaryOverride = process.env.PRIVACY_POOLS_CLI_BINARY;
    const spawnMock = (
      _command: string,
      _args: string[],
      _options: {
        env: NodeJS.ProcessEnv;
        stdio: "inherit";
      },
    ) => {
      const child = new EventEmitter() as EventEmitter & {
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      child.exitCode = null;
      child.signalCode = null;
      child.kill = () => true;
      queueMicrotask(() => {
        child.emit("error", new Error("spawn /tmp/private/native-worker ENOENT"));
      });
      return child;
    };

    launcherTestInternals.setSpawnImplementationForTests(
      spawnMock as unknown as typeof import("node:child_process").spawn,
    );
    process.env.PRIVACY_POOLS_CLI_BINARY = "/tmp/privacy-pools-native";

    try {
      const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        runLauncher(PKG, ["--agent", "stats"]),
      );

      expect(exitCode).toBe(1);
      expect(stderr).toBe("");
      expect(json.success).toBe(false);
      expect(json.errorMessage).toContain("<redacted-path>");
      expect(json.errorMessage).not.toContain("/tmp/private/native-worker");
    } finally {
      launcherTestInternals.resetSpawnImplementationForTests();
      if (originalBinaryOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_BINARY;
      } else {
        process.env.PRIVACY_POOLS_CLI_BINARY = originalBinaryOverride;
      }
    }
  });

  test("resolveInstalledNativeBinary enforces version, bridge, checksum, and resolver failures", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");

    try {
      writeNativePackageJson(packageJsonPath, sha256);
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBe(binPath);

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(
          { version: "1.7.1" },
          {
            platform: "darwin",
            arch: "arm64",
            requireResolve: () => packageJsonPath,
          },
        ),
      ).toBeNull();

      writeNativePackageJson(packageJsonPath, sha256, {
        bridgeVersion: "2",
      });
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();

      writeNativePackageJson(packageJsonPath, "deadbeef");
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => {
            throw new Error("missing package");
          },
        }),
      ).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
