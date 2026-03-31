import { afterEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CLI_PROTOCOL_PROFILE } from "../../src/config/protocol-profile.js";
import {
  launcherTestInternals,
  runLauncher,
} from "../../src/launcher.ts";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import {
  CURRENT_RUNTIME_REQUEST_ENV,
  decodeCurrentWorkerRequest,
  decodeNativeJsBridgeDescriptor,
  NATIVE_JS_BRIDGE_ENV,
} from "../../src/runtime/current.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import { parseRootArgv } from "../../src/utils/root-argv.ts";

const PKG = { version: "1.7.0" };
const realStaticDiscovery = captureModuleExports(
  await import("../../src/static-discovery.ts"),
);
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;
const ORIGINAL_BINARY_OVERRIDE = process.env.PRIVACY_POOLS_CLI_BINARY;
const ORIGINAL_WORKER_OVERRIDE = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
const ORIGINAL_EXIT_CODE = process.exitCode;

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

describe("launcher routing", () => {
  afterEach(() => {
    restoreModuleImplementations([
      ["../../src/static-discovery.ts", realStaticDiscovery],
    ]);
    launcherTestInternals.resetSpawnImplementationForTests();
    process.exitCode = ORIGINAL_EXIT_CODE;
    if (ORIGINAL_NO_COLOR === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = ORIGINAL_NO_COLOR;
    }
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

  test("falls back to the js worker boundary when no native package is available and encodes argv", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["status", "--json"],
      {},
      {
        resolveInstalledNativeBinary: () => null,
      },
    );

    expect(target.kind).toBe("js-worker");
    expect(target.command).toBe(launcherTestInternals.resolveJsRuntimeCommand({}));
    expect(target.args.at(-1)).toContain("worker-main");
    expect(target.args).toEqual([launcherTestInternals.defaultJsWorkerPath()]);
    expect(
      decodeCurrentWorkerRequest(
        String(target.env[CURRENT_RUNTIME_REQUEST_ENV]),
      ),
    ).toEqual({
      protocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
      argv: ["status", "--json"],
    });
  });

  test("disable-native wins over an explicit binary override", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["status"],
      {
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("js-worker");
    expect(target.command).toBe(launcherTestInternals.resolveJsRuntimeCommand({
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
      PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
    }));
  });

  test("uses an explicit binary override when native is not disabled", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["flow", "--help"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
        npm_node_execpath: process.platform === "win32" ? "bun.exe" : "/tmp/bun",
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/privacy-pools-native");
    expect(target.args).toEqual(["flow", "--help"]);
    expect(target.env[NATIVE_JS_BRIDGE_ENV]).toBeTruthy();
    const bridge = decodeNativeJsBridgeDescriptor(
      String(target.env[NATIVE_JS_BRIDGE_ENV]),
    );
    expect(bridge.runtimeVersion).toBe(CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion);
    expect(bridge.workerProtocolVersion).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
    );
    expect(bridge.nativeBridgeVersion).toBe(
      CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
    );
    expect(bridge.workerRequestEnv).toBe(CURRENT_RUNTIME_REQUEST_ENV);
    expect(basename(bridge.workerCommand)).toMatch(/^node(?:\.exe)?$/i);
    expect(bridge.workerArgs).toEqual([launcherTestInternals.defaultJsWorkerPath()]);
  });

  test("explicit native overrides do not resolve package metadata before routing", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      () => {
        throw new Error("package metadata should stay lazy for explicit native overrides");
      },
      ["flow", "--help"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/privacy-pools-native");
  });

  test("js-owned routes stay on the js worker without probing installed native packages", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      () => {
        throw new Error("js-owned routes should not resolve package metadata before routing");
      },
      ["status", "--json", "--no-check"],
      {},
      {
        parsed: parseRootArgv(["status", "--json", "--no-check"]),
        resolveInstalledNativeBinary: () => {
          throw new Error("js-owned routes should not probe installed native binaries");
        },
      },
    );

    expect(target.kind).toBe("js-worker");
  });

  test("native forwarding keeps the public CLI env surface limited to documented keys", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["flow", "--help"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
        PRIVACY_POOLS_PRIVATE_KEY: "0x" + "11".repeat(32),
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();

    const cliEnvNames = Object.keys(target.env)
      .filter((name) => name.startsWith("PRIVACY_POOLS_CLI_"))
      .sort();
    expect(cliEnvNames).toEqual([
      "PRIVACY_POOLS_CLI_BINARY",
      "PRIVACY_POOLS_CLI_JS_WORKER",
    ]);
    expect(target.env.PRIVACY_POOLS_CLI_JS_WORKER_COMMAND).toBeUndefined();
    expect(target.env.PRIVACY_POOLS_CLI_JS_WORKER_ARGS_B64).toBeUndefined();
  });

  test("resolveCommandRoute strips help and expands aliases to the canonical route", () => {
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

  test("writeVersionOutput prints human and structured version payloads", async () => {
    const human = await captureAsyncOutput(() =>
      launcherTestInternals.writeVersionOutput(PKG, false),
    );
    expect(human.stdout).toBe("1.7.0\n");
    expect(human.stderr).toBe("");

    const structured = await captureAsyncJsonOutput(() =>
      launcherTestInternals.writeVersionOutput(PKG, true),
    );
    expect(structured.json).toMatchObject({
      success: true,
      mode: "version",
      version: "1.7.0",
    });
    expect(structured.stderr).toBe("");
  });

  test("runLauncher serves the root version fast path without spawning a child", async () => {
    const human = await captureAsyncOutputAllowExit(() =>
      runLauncher(PKG, ["--version"]),
    );
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toBe("1.7.0\n");
    expect(human.stderr).toBe("");

    const structured = await captureAsyncJsonOutputAllowExit(() =>
      runLauncher(PKG, ["--agent", "--version"]),
    );
    expect(structured.exitCode).toBe(0);
    expect(structured.json).toMatchObject({
      success: true,
      mode: "version",
      version: "1.7.0",
    });
    expect(structured.stderr).toBe("");
  });

  test("runLauncher serves static discovery without resolving package info", async () => {
    const pkgResolver = mock(() => PKG);

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runLauncher(pkgResolver, ["capabilities", "--agent"]),
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.commands)).toBe(true);
    expect(stderr).toBe("");
    expect(pkgResolver).not.toHaveBeenCalled();
  });

  test("runLauncher preserves non-zero exits from static discovery errors", async () => {
    const pkgResolver = mock(() => PKG);

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runLauncher(pkgResolver, ["--json", "describe", "not-a-command"]),
    );

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(String(json.errorMessage)).toContain("Unknown command path");
    expect(stderr).toBe("");
    expect(pkgResolver).not.toHaveBeenCalled();
  });

  test("runLauncher spawns a configured JS worker override without exiting on success", async () => {
    const tempDir = createTrackedTempDir("pp-worker-override-");
    const workerPath = join(tempDir, "worker.js");
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    const spawnMock = mock(
      (
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
          process.stdout.write(JSON.stringify({ success: true, mode: "help" }));
          child.emit("exit", 0, null);
        });
        return child;
      },
    );
    writeFileSync(workerPath, "// mocked worker path\n", "utf8");
    launcherTestInternals.setSpawnImplementationForTests(
      spawnMock as unknown as typeof import("node:child_process").spawn,
    );
    process.env.PRIVACY_POOLS_CLI_JS_WORKER = workerPath;

    try {
      const { json, stderr } = await captureAsyncJsonOutput(() =>
        runLauncher(PKG, ["guide", "--agent"]),
      );

      expect(json).toMatchObject({ success: true, mode: "help" });
      expect(stderr).toBe("");
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      launcherTestInternals.resetSpawnImplementationForTests();
      if (originalWorkerOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
      } else {
        process.env.PRIVACY_POOLS_CLI_JS_WORKER = originalWorkerOverride;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runLauncher spawns a native launch target without exiting on success", async () => {
    const originalBinaryOverride = process.env.PRIVACY_POOLS_CLI_BINARY;
    const spawnMock = mock(
      (
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
        queueMicrotask(() => child.emit("exit", 0, null));
        return child;
      },
    );
    launcherTestInternals.setSpawnImplementationForTests(
      spawnMock as unknown as typeof import("node:child_process").spawn,
    );
    process.env.PRIVACY_POOLS_CLI_BINARY = "/tmp/privacy-pools-native";

    try {
      await runLauncher(PKG, ["flow", "--help"]);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    } finally {
      launcherTestInternals.resetSpawnImplementationForTests();
      if (originalBinaryOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_BINARY;
      } else {
        process.env.PRIVACY_POOLS_CLI_BINARY = originalBinaryOverride;
      }
    }
  });

  test("tryRunLocalFastPath serves root help through the static discovery helper", async () => {
    const runStaticRootHelp = mock(async () => undefined);
    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp,
    }));

    try {
      const { exitCode, stdout, stderr } = await captureAsyncOutputAllowExit(() =>
        launcherTestInternals.tryRunLocalFastPath(
          PKG,
          ["--help"],
          parseRootArgv(["--help"]),
        ),
      );

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(runStaticRootHelp).toHaveBeenCalledWith(false);
    } finally {
      mock.restore();
    }
  });

  test("tryRunLocalFastPath exits once static completion accepts the argv", async () => {
    const runStaticCompletionQuery = mock(async () => true);
    mock.module("../../src/static-discovery.ts", () => ({
      runStaticCompletionQuery,
    }));

    try {
      const argv = ["completion", "query", "privacy-pools"];
      const { exitCode, stdout, stderr } = await captureAsyncOutputAllowExit(() =>
        launcherTestInternals.tryRunLocalFastPath(
          PKG,
          argv,
          parseRootArgv(argv),
        ),
      );

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(runStaticCompletionQuery).toHaveBeenCalledWith(argv);
    } finally {
      mock.restore();
    }
  });

  test("tryRunLocalFastPath keeps falling through when static completion declines the argv", async () => {
    const runStaticCompletionQuery = mock(async () => false);
    mock.module("../../src/static-discovery.ts", () => ({
      runStaticCompletionQuery,
    }));

    try {
      const argv = ["completion", "query", "privacy-pools"];
      const result = await launcherTestInternals.tryRunLocalFastPath(
        PKG,
        argv,
        parseRootArgv(argv),
      );

      expect(result).toBe(false);
      expect(runStaticCompletionQuery).toHaveBeenCalledWith(argv);
    } finally {
      mock.restore();
    }
  });

  test("tryRunLocalFastPath exits once static discovery accepts a local command", async () => {
    const runStaticDiscoveryCommand = mock(async () => true);
    mock.module("../../src/static-discovery.ts", () => ({
      runStaticDiscoveryCommand,
    }));

    try {
      const argv = ["guide"];
      const { exitCode, stdout, stderr } = await captureAsyncOutputAllowExit(() =>
        launcherTestInternals.tryRunLocalFastPath(
          PKG,
          argv,
          parseRootArgv(argv),
        ),
      );

      expect(exitCode).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(runStaticDiscoveryCommand).toHaveBeenCalledWith(
        argv,
        parseRootArgv(argv),
      );
    } finally {
      mock.restore();
    }
  });

  test("runLauncher spawns an explicit js worker override when one is configured", async () => {
    const tempDir = createTrackedTempDir("pp-worker-override-");
    const workerPath = join(tempDir, "worker.js");
    const originalWorkerOverride = process.env.PRIVACY_POOLS_CLI_JS_WORKER;
    const spawnMock = mock(
      (
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
          process.stdout.write(
            JSON.stringify({
              success: true,
              mode: "help",
              help: "worker override",
            }),
          );
          child.emit("exit", 0, null);
        });

        return child;
      },
    );
    writeFileSync(workerPath, "// mocked worker path\n", "utf8");
    launcherTestInternals.setSpawnImplementationForTests(
      spawnMock as unknown as typeof import("node:child_process").spawn,
    );
    process.env.PRIVACY_POOLS_CLI_JS_WORKER = workerPath;

    try {
      const { json, stderr } = await captureAsyncJsonOutput(() =>
        runLauncher(PKG, ["guide", "--agent"]),
      );

      expect(json).toMatchObject({
        success: true,
        mode: "help",
        help: "worker override",
      });
      expect(stderr).toBe("");
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBeTruthy();
      expect(args.at(-1)).toBe(workerPath);
    } finally {
      launcherTestInternals.resetSpawnImplementationForTests();
      if (originalWorkerOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_JS_WORKER;
      } else {
        process.env.PRIVACY_POOLS_CLI_JS_WORKER = originalWorkerOverride;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("runLauncher preserves non-zero exit codes from explicit native binaries", async () => {
    const originalBinaryOverride = process.env.PRIVACY_POOLS_CLI_BINARY;
    const spawnMock = mock(
      (
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
          child.emit("exit", 7, null);
        });

        return child;
      },
    );
    launcherTestInternals.setSpawnImplementationForTests(
      spawnMock as unknown as typeof import("node:child_process").spawn,
    );
    process.env.PRIVACY_POOLS_CLI_BINARY = "/tmp/privacy-pools-native";

    try {
      const { exitCode, stdout, stderr } = await captureAsyncOutputAllowExit(() =>
        runLauncher(PKG, ["flow", "--help"]),
      );

      expect(exitCode).toBe(7);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
      expect(command).toBe("/tmp/privacy-pools-native");
      expect(args).toEqual(["flow", "--help"]);
    } finally {
      launcherTestInternals.resetSpawnImplementationForTests();
      if (originalBinaryOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_BINARY;
      } else {
        process.env.PRIVACY_POOLS_CLI_BINARY = originalBinaryOverride;
      }
    }
  });

  test("prefers an installed same-version native package by default", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["--help"],
      {},
      {
        resolveInstalledNativeBinary: () => "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/privacy-pools-native");
    expect(target.args).toEqual(["--help"]);
  });

  test("keeps js-owned routes on the js worker even when native is available", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["--agent", "status", "--no-check"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
      {
        resolveInstalledNativeBinary: () => "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("js-worker");
    expect(target.command).toBe(launcherTestInternals.resolveJsRuntimeCommand({
      PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
    }));
  });

  test("knows which invocations still require the js worker under native launch", () => {
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
        parseRootArgv(["help", "flow"]),
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
      launcherTestInternals.invocationRequiresJsWorker(parseRootArgv([])),
    ).toBe(true);

    expect(
      launcherTestInternals.invocationRequiresJsWorker(
        parseRootArgv(["definitely-unknown-command"]),
      ),
    ).toBe(true);
  });

  test("validates broken js worker paths with a cli-friendly error", () => {
    expect(() =>
      launcherTestInternals.validateJsWorkerPath({
        PRIVACY_POOLS_CLI_JS_WORKER: "/tmp/pp-missing-worker.js",
      }),
    ).toThrow("The JS runtime worker is unavailable.");
  });

  test("blocks explicit js worker overrides for secret-bearing invocations", async () => {
    const tempDir = createTrackedTempDir("pp-worker-override-secret-");
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
          "--private-key",
          `0x${"44".repeat(32)}`,
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

  test("runLauncher sanitizes launcher spawn failures through the cli error path", async () => {
    const originalBinaryOverride = process.env.PRIVACY_POOLS_CLI_BINARY;
    const spawnMock = mock(
      (
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
          once: EventEmitter["once"];
        };
        child.exitCode = null;
        child.signalCode = null;
        child.kill = () => true;
        queueMicrotask(() => {
          child.emit("error", new Error("spawn /tmp/private/native-worker ENOENT"));
        });
        return child;
      },
    );
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
      expect(json.errorMessage).not.toContain("/tmp/private/native-worker");
      expect(json.errorMessage).toContain("<redacted-path>");
    } finally {
      launcherTestInternals.resetSpawnImplementationForTests();
      if (originalBinaryOverride === undefined) {
        delete process.env.PRIVACY_POOLS_CLI_BINARY;
      } else {
        process.env.PRIVACY_POOLS_CLI_BINARY = originalBinaryOverride;
      }
    }
  });

  test("resolves an installed native binary only on exact version match", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    writeNativePackageJson(packageJsonPath, sha256);

    try {
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
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects installed native binaries with a checksum mismatch", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-bad-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "privacy-pools-cli-native-shell"),
      "mismatch",
      "utf8",
    );
    writeNativePackageJson(packageJsonPath, "deadbeef");

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects installed native binaries with a bridge version mismatch", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-bridge-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    writeNativePackageJson(packageJsonPath, sha256, {
      bridgeVersion: "2",
    });

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects installed native binaries with a protocol profile mismatch", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-protocol-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    writeNativePackageJson(packageJsonPath, sha256, {
      protocolProfile: "privacy-pools-v999",
    });

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects installed native binaries when bridgeVersion is absent", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-legacy-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    writeNativePackageJson(packageJsonPath, sha256, {
      bridgeVersion: undefined,
    });

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("rejects installed native binaries when binaryPath is absent", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-legacy-bin-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools-cli-native-shell");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        version: "1.7.0",
        privacyPoolsCliNative: {
          binaryPath: undefined,
          bridgeVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
          protocolProfile: CLI_PROTOCOL_PROFILE.profile,
          runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
          triplet: "darwin-arm64",
          sha256,
        },
      }),
      "utf8",
    );

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
