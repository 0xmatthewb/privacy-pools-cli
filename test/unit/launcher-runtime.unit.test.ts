import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CLI_PROTOCOL_PROFILE } from "../../src/config/protocol-profile.js";
import { launcherTestInternals, runLauncher } from "../../src/launcher.ts";
import {
  CURRENT_NATIVE_JS_BRIDGE_ENV,
  CURRENT_RUNTIME_REQUEST_ENV,
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import { parseRootArgv } from "../../src/utils/root-argv.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  captureAsyncOutputAllowExit,
  captureAsyncJsonOutputAllowExit,
} from "../helpers/output.ts";

const PKG = { version: "1.7.0" };
const ORIGINAL_BINARY_OVERRIDE = process.env.PRIVACY_POOLS_CLI_BINARY;
const ORIGINAL_WORKER_OVERRIDE = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
const ORIGINAL_EXIT_CODE = process.exitCode ?? 0;

type SpawnMockChild = EventEmitter & {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals) => boolean;
};

function createSpawnMockChild(): SpawnMockChild {
  const child = new EventEmitter() as SpawnMockChild;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

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

function createNativeVerificationHome(tempDir: string): string {
  const home = join(tempDir, ".privacy-pools");
  mkdirSync(home, { recursive: true });
  return home;
}

describe("launcher runtime coverage", () => {
  afterEach(() => {
    launcherTestInternals.resetSpawnImplementationForTests();
    process.exitCode = ORIGINAL_EXIT_CODE;
    if (ORIGINAL_BINARY_OVERRIDE === undefined) {
      delete process.env.PRIVACY_POOLS_CLI_BINARY;
    } else {
      process.env.PRIVACY_POOLS_CLI_BINARY = ORIGINAL_BINARY_OVERRIDE;
    }
    if (ORIGINAL_WORKER_OVERRIDE === undefined) {
      delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    } else {
      process.env.PRIVACY_POOLS_CLI_JS_WORKER = ORIGINAL_WORKER_OVERRIDE;
    }
  });

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

  test("validateJsWorkerPath requires a real js worker file", () => {
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
      ).toThrow("The JS runtime worker is unavailable.");
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

  test("resolveJsRuntimeCommand ignores bun-like npm_node_execpath values", () => {
    const resolved = launcherTestInternals.resolveJsRuntimeCommand({
      npm_node_execpath: process.platform === "win32" ? "bun.exe" : "/tmp/bun",
    });

    expect(basename(resolved)).toMatch(/^node(?:\.exe)?$/i);
  });

  test("resolveLaunchTarget honors disable-native by forcing the js worker route", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["stats"],
      {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      },
      {
        parsed: parseRootArgv(["stats"]),
      },
    );

    expect(target.kind).toBe("js-worker");
    expect(typeof target.env[CURRENT_RUNTIME_REQUEST_ENV]).toBe("string");
  });

  test("resolveLaunchTarget forwards native bridge metadata without leaking signer secrets", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["stats"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
        PRIVACY_POOLS_PRIVATE_KEY: `0x${"11".repeat(32)}`,
      },
      {
        parsed: parseRootArgv(["stats"]),
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/privacy-pools-native");
    expect(target.env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(typeof target.env.PRIVACY_POOLS_CLI_JS_WORKER).toBe("string");
    expect(target.env.PRIVACY_POOLS_CLI_JS_WORKER?.endsWith(".js")).toBe(true);
    expect(typeof target.env[CURRENT_NATIVE_JS_BRIDGE_ENV]).toBe("string");
  });

  test("resolveLaunchTarget prefers a verified installed native binary when one is available", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["stats"],
      {},
      {
        parsed: parseRootArgv(["stats"]),
        resolveInstalledNativeBinary: () => "/tmp/verified-native",
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/verified-native");
    expect(typeof target.env[CURRENT_NATIVE_JS_BRIDGE_ENV]).toBe("string");
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

  test("tryRunLocalFastPath skips local handling when an explicit js worker override is configured", async () => {
    const result = await launcherTestInternals.tryRunLocalFastPath(
      PKG,
      ["--help"],
      parseRootArgv(["--help"]),
      {
        PRIVACY_POOLS_CLI_JS_WORKER: "/tmp/privacy-pools-worker.js",
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
        {},
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
        {},
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

  test("exitSuccessfulFastPath preserves an existing non-zero exit code", () => {
    const originalExit = process.exit;
    let forcedExitCode: number | null = null;
    process.exitCode = 7;
    process.exit = ((code?: number) => {
      forcedExitCode = code ?? 0;
      throw new Error(`unexpected exit(${forcedExitCode})`);
    }) as never;

    try {
      launcherTestInternals.exitSuccessfulFastPath();
      expect(forcedExitCode).toBeNull();
      expect(process.exitCode).toBe(7);
    } finally {
      process.exit = originalExit;
      process.exitCode = ORIGINAL_EXIT_CODE;
    }
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
        {},
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
        {},
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
    const tempDir = createTrackedTempDir("pp-launcher-inline-status-");
    const originalHome = process.env.PRIVACY_POOLS_HOME;
    const originalConfigDir = process.env.PRIVACY_POOLS_CONFIG_DIR;
    const originalDisableNative = process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE;
    const originalDisableFastPath = process.env.PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH;
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    const originalBinaryOverride = process.env.PRIVACY_POOLS_CLI_BINARY;
    let spawnCalled = false;

    launcherTestInternals.setSpawnImplementationForTests((() => {
      spawnCalled = true;
      throw new Error("spawn should not be used for inline js-owned launcher routes");
    }) as typeof import("node:child_process").spawn);

    process.env.PRIVACY_POOLS_HOME = join(tempDir, ".privacy-pools");
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
    delete process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE;
    delete process.env.PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH;
    delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    delete process.env.PRIVACY_POOLS_CLI_BINARY;

    try {
      const argv = ["--agent", "status", "--no-check"];
      const parsed = parseRootArgv(argv);
      const target = launcherTestInternals.resolveLaunchTarget(PKG, argv, process.env, {
        parsed,
      });

      expect(target.kind).toBe("js-worker");
      expect(launcherTestInternals.hasExplicitJsWorkerOverride(process.env)).toBe(false);

      const { json, stderr } = await captureAsyncJsonOutputAllowExit(() =>
        runLauncher(PKG, argv),
      );

      expect(spawnCalled).toBe(false);
      expect(json.schemaVersion).toBe("1.7.0");
      expect(typeof json.success).toBe("boolean");
      expect(stderr).toBe("");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      if (originalHome === undefined) {
        delete process.env.PRIVACY_POOLS_HOME;
      } else {
        process.env.PRIVACY_POOLS_HOME = originalHome;
      }
      if (originalConfigDir === undefined) {
        delete process.env.PRIVACY_POOLS_CONFIG_DIR;
      } else {
        process.env.PRIVACY_POOLS_CONFIG_DIR = originalConfigDir;
      }
      if (originalDisableNative === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE;
      } else {
        process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE = originalDisableNative;
      }
      if (originalDisableFastPath === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH;
      } else {
        process.env.PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH = originalDisableFastPath;
      }
      if (originalWorkerOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
      } else {
        process.env.PRIVACY_POOLS_CLI_JS_WORKER = originalWorkerOverride;
      }
      if (originalBinaryOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_BINARY;
      } else {
        process.env.PRIVACY_POOLS_CLI_BINARY = originalBinaryOverride;
      }
    }
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

  test("runLauncher spawns the configured js worker override for non-secret invocations", async () => {
    const tempDir = createTrackedTempDir("pp-worker-override-spawn-");
    const workerPath = join(tempDir, "worker.js");
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    const argv = ["--agent", "status", "--no-check"];
    let spawnCall:
      | {
          command: string;
          args: string[];
          env: NodeJS.ProcessEnv;
          stdio: "inherit";
        }
      | null = null;

    writeFileSync(workerPath, "// mocked worker path\n", "utf8");
    process.env.PRIVACY_POOLS_CLI_JS_WORKER = workerPath;
    launcherTestInternals.setSpawnImplementationForTests(
      ((command, args, options) => {
        spawnCall = {
          command,
          args,
          env: options.env,
          stdio: options.stdio,
        };
        const child = createSpawnMockChild();
        queueMicrotask(() => {
          child.emit("exit", 0, null);
        });
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
    );

    try {
      const parsed = parseRootArgv(argv);
      const target = launcherTestInternals.resolveLaunchTarget(PKG, argv, process.env, {
        parsed,
      });
      const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
        runLauncher(PKG, argv),
      );

      expect(target.kind).toBe("js-worker");
      expect(exitCode).toBeNull();
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(spawnCall).not.toBeNull();
      expect(spawnCall?.command).toBe(target.command);
      expect(spawnCall?.args).toEqual(target.args);
      expect(spawnCall?.stdio).toBe("inherit");
      expect(spawnCall?.env[CURRENT_RUNTIME_REQUEST_ENV]).toBeDefined();
    } finally {
      if (originalWorkerOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
      } else {
        process.env.PRIVACY_POOLS_CLI_JS_WORKER = originalWorkerOverride;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runLauncher forwards explicit js worker exit codes", async () => {
    const tempDir = createTrackedTempDir("pp-worker-override-exit-");
    const workerPath = join(tempDir, "worker.js");
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;

    writeFileSync(workerPath, "// mocked worker path\n", "utf8");
    process.env.PRIVACY_POOLS_CLI_JS_WORKER = workerPath;
    launcherTestInternals.setSpawnImplementationForTests(
      ((_, __, ___) => {
        const child = createSpawnMockChild();
        queueMicrotask(() => {
          child.emit("exit", 7, null);
        });
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
    );

    try {
      const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
        runLauncher(PKG, ["--agent", "status", "--no-check"]),
      );

      expect(exitCode).toBe(7);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
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
      const child = createSpawnMockChild();
      queueMicrotask(() => {
        child.emit("error", new Error("spawn /tmp/private/native-worker ENOENT"));
      });
      return child as EventEmitter & {
        exitCode: number | null;
        signalCode: NodeJS.Signals | null;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
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

  test("resolveInstalledNativeBinary reuses the persistent verification cache on repeated launches", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-cache-");
    const home = createNativeVerificationHome(tempDir);
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    let checksumCalls = 0;

    try {
      writeNativePackageJson(packageJsonPath, sha256);
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });

      const options = {
        platform: "darwin" as const,
        arch: "arm64" as const,
        env: {
          PRIVACY_POOLS_HOME: home,
        },
        requireResolve: () => packageJsonPath,
        hasValidChecksum: (packageJson: Parameters<
          typeof launcherTestInternals.hasValidInstalledNativeChecksum
        >[0], binaryPath: string) => {
          checksumCalls += 1;
          return launcherTestInternals.hasValidInstalledNativeChecksum(
            packageJson,
            binaryPath,
          );
        },
      };

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, options),
      ).toBe(binPath);
      expect(checksumCalls).toBe(1);
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, options),
      ).toBe(binPath);
      expect(checksumCalls).toBe(1);
    } finally {
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveInstalledNativeBinary does not create the config home just to cache verification", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-cache-side-effect-");
    const home = join(tempDir, ".privacy-pools");
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
      expect(existsSync(home)).toBe(false);

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          env: {
            PRIVACY_POOLS_HOME: home,
          },
          requireResolve: () => packageJsonPath,
        }),
      ).toBe(binPath);

      expect(existsSync(home)).toBe(false);
      expect(
        existsSync(
          launcherTestInternals.installedNativeVerificationCachePath({
            PRIVACY_POOLS_HOME: home,
          }),
        ),
      ).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveInstalledNativeBinary can skip verification cache writes for read-only inspection", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-cache-readonly-");
    const home = createNativeVerificationHome(tempDir);
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
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          env: {
            PRIVACY_POOLS_HOME: home,
          },
          requireResolve: () => packageJsonPath,
          recordVerificationCache: false,
        }),
      ).toBe(binPath);

      expect(
        launcherTestInternals.readInstalledNativeVerificationCache({
          PRIVACY_POOLS_HOME: home,
        }),
      ).toBeNull();
    } finally {
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveInstalledNativeBinary ignores a corrupted persistent verification cache and recomputes", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-cache-corrupt-");
    const home = createNativeVerificationHome(tempDir);
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    let checksumCalls = 0;

    try {
      writeNativePackageJson(packageJsonPath, sha256);
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });

      const options = {
        platform: "darwin" as const,
        arch: "arm64" as const,
        env: {
          PRIVACY_POOLS_HOME: home,
        },
        requireResolve: () => packageJsonPath,
        hasValidChecksum: (packageJson: Parameters<
          typeof launcherTestInternals.hasValidInstalledNativeChecksum
        >[0], binaryPath: string) => {
          checksumCalls += 1;
          return launcherTestInternals.hasValidInstalledNativeChecksum(
            packageJson,
            binaryPath,
          );
        },
      };

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, options),
      ).toBe(binPath);
      expect(checksumCalls).toBe(1);

      writeFileSync(
        launcherTestInternals.installedNativeVerificationCachePath({
          PRIVACY_POOLS_HOME: home,
        }),
        "{not-json",
        "utf8",
      );

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, options),
      ).toBe(binPath);
      expect(checksumCalls).toBe(2);
    } finally {
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveInstalledNativeBinary invalidates the persistent verification cache when the binary identity changes", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-cache-invalidate-");
    const home = createNativeVerificationHome(tempDir);
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    let checksumCalls = 0;

    try {
      writeNativePackageJson(packageJsonPath, sha256);
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });

      const options = {
        platform: "darwin" as const,
        arch: "arm64" as const,
        env: {
          PRIVACY_POOLS_HOME: home,
        },
        requireResolve: () => packageJsonPath,
        hasValidChecksum: (packageJson: Parameters<
          typeof launcherTestInternals.hasValidInstalledNativeChecksum
        >[0], binaryPath: string) => {
          checksumCalls += 1;
          return launcherTestInternals.hasValidInstalledNativeChecksum(
            packageJson,
            binaryPath,
          );
        },
      };

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, options),
      ).toBe(binPath);
      expect(checksumCalls).toBe(1);

      writeFileSync(binPath, "#!/usr/bin/env bun!\n", "utf8");
      const nextTime = new Date(Date.now() + 1_000);
      utimesSync(binPath, nextTime, nextTime);

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, options),
      ).toBeNull();
      expect(checksumCalls).toBe(2);
    } finally {
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("resolveInstalledNativeBinary never lets the persistent verification cache bypass metadata mismatches", () => {
    const tempDir = createTrackedTempDir("pp-native-runtime-cache-metadata-");
    const home = createNativeVerificationHome(tempDir);
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
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          env: {
            PRIVACY_POOLS_HOME: home,
          },
          requireResolve: () => packageJsonPath,
        }),
      ).toBe(binPath);

      writeNativePackageJson(packageJsonPath, sha256, {
        bridgeVersion: "2",
      });

      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          env: {
            PRIVACY_POOLS_HOME: home,
          },
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();
    } finally {
      launcherTestInternals.clearInstalledNativeVerificationCache({
        PRIVACY_POOLS_HOME: home,
      });
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
