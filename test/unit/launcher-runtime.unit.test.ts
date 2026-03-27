import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_PROTOCOL_PROFILE } from "../../src/config/protocol-profile.js";
import { launcherTestInternals, runLauncher } from "../../src/launcher.ts";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import {
  CURRENT_RUNTIME_REQUEST_ENV,
  decodeCurrentWorkerRequest,
  decodeNativeJsBridgeDescriptor,
  NATIVE_JS_BRIDGE_ENV,
} from "../../src/runtime/current.ts";
import { parseRootArgv } from "../../src/utils/root-argv.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  captureAsyncOutput,
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
    expect(launcherTestInternals.nativeTriplet("linux", "arm64")).toBeNull();
    expect(launcherTestInternals.nativePackageName("linux", "arm64")).toBeNull();
  });

  test("resolveLaunchTarget encodes js worker requests when no native package is available", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["status", "--json"],
      {},
      {
        resolveInstalledNativeBinary: () => null,
      },
    );

    expect(target.kind).toBe("js-worker");
    expect(target.command).toBe(process.execPath);
    expect(target.args.at(-1)).toContain("worker-main");
    expect(
      decodeCurrentWorkerRequest(
        String(target.env[CURRENT_RUNTIME_REQUEST_ENV]),
      ),
    ).toEqual({
      protocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
      argv: ["status", "--json"],
    });
  });

  test("resolveLaunchTarget prefers an installed same-version native binary for native-owned routes", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["flow", "--help"],
      {},
      {
        resolveInstalledNativeBinary: () => "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/privacy-pools-native");
    expect(target.args).toEqual(["flow", "--help"]);
    expect(
      decodeNativeJsBridgeDescriptor(String(target.env[NATIVE_JS_BRIDGE_ENV])),
    ).toEqual({
      runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
      workerProtocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
      nativeBridgeVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
      workerRequestEnv: CURRENT_RUNTIME_REQUEST_ENV,
      workerCommand: process.execPath,
      workerArgs: process.versions.bun
        ? ["--no-env-file", launcherTestInternals.defaultJsWorkerPath()]
        : [launcherTestInternals.defaultJsWorkerPath()],
    });
  });

  test("resolveLaunchTarget keeps js-owned routes on the worker even when native is installed", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["--agent", "status", "--no-check"],
      {},
      {
        resolveInstalledNativeBinary: () => "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("js-worker");
    expect(target.command).toBe(process.execPath);
  });

  test("resolveLaunchTarget honors disable-native and explicit native binary overrides", () => {
    const disabled = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["flow", "--help"],
      {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );
    const explicit = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["flow", "--help"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );

    expect(disabled.kind).toBe("js-worker");
    expect(explicit.kind).toBe("native-binary");
    expect(explicit.command).toBe("/tmp/privacy-pools-native");
  });

  test("createNativeForwardingEnv strips private keys while preserving the bridge descriptor", () => {
    const env = launcherTestInternals.createNativeForwardingEnv({
      PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      PRIVACY_POOLS_PRIVATE_KEY: "0x" + "11".repeat(32),
    });

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PRIVACY_POOLS_CLI_JS_WORKER).toBeTruthy();
    expect(env[NATIVE_JS_BRIDGE_ENV]).toBeTruthy();
  });

  test("invocationRequiresJsWorker keeps sensitive and unknown routes on JS while allowing native help/read-only routes", () => {
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["--agent", "status", "--no-check"]),
      ),
    ).toBe(true);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["flow", "--help"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["stats", "pool", "--asset", "ETH"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["pools", "ETH"]),
      ),
    ).toBe(true);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["definitely-unknown-command"]),
      ),
    ).toBe(true);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["activity", "--format", "csv"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["pools", "--format", "csv"]),
      ),
    ).toBe(false);
    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["capabilities", "--help"]),
      ),
    ).toBe(false);
  });

  test("resolveCommandRoute normalizes help and aliases to canonical routes", () => {
    expect(launcherTestInternals.resolveCommandRoute([])).toBeNull();
    expect(
      launcherTestInternals.resolveCommandRoute(["help", "exit"]),
    ).toBe("ragequit");
    expect(
      launcherTestInternals.resolveCommandRoute([
        "withdraw",
        "quote",
        "0.1",
        "ETH",
      ]),
    ).toBe("withdraw quote");
  });

  test("writeVersionOutput renders human and structured payloads", async () => {
    const human = await captureAsyncOutput(() =>
      launcherTestInternals.writeVersionOutput(PKG, false),
    );
    const structured = await captureAsyncJsonOutput(() =>
      launcherTestInternals.writeVersionOutput(PKG, true),
    );

    expect(human.stdout).toBe("1.7.0\n");
    expect(human.stderr).toBe("");
    expect(structured.json).toMatchObject({
      success: true,
      mode: "version",
      version: "1.7.0",
    });
  });

  test("applyLauncherEnvironment only enables NO_COLOR when explicitly requested", () => {
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;

    try {
      launcherTestInternals.applyLauncherEnvironment(["guide"]);
      expect(process.env.NO_COLOR).toBeUndefined();

      launcherTestInternals.applyLauncherEnvironment(["guide", "--no-color"]);
      expect(process.env.NO_COLOR).toBe("1");
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
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
