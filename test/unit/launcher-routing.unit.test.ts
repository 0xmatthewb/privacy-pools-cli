import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_PROTOCOL_PROFILE } from "../../src/config/protocol-profile.js";
import { launcherTestInternals } from "../../src/launcher.ts";
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

describe("launcher routing", () => {
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
    expect(target.command).toBe(process.execPath);
    expect(target.args.at(-1)).toContain("worker-main");
    if (process.versions.bun) {
      expect(target.args[0]).toBe("--no-env-file");
    }
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
    expect(target.command).toBe(process.execPath);
  });

  test("uses an explicit binary override when native is not disabled", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["status", "--json"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("native-binary");
    expect(target.command).toBe("/tmp/privacy-pools-native");
    expect(target.args).toEqual(["status", "--json"]);
    expect(target.env[NATIVE_JS_BRIDGE_ENV]).toBeTruthy();
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

  test("native forwarding keeps the public CLI env surface limited to documented keys", () => {
    const target = launcherTestInternals.resolveLaunchTarget(
      PKG,
      ["status", "--json"],
      {
        PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native",
      },
    );

    expect(target.kind).toBe("native-binary");

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

  test("accepts the legacy protocolVersion alias when bridgeVersion is absent", () => {
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
      protocolVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
    });

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBe(binPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts legacy native packages that still publish a public bin entry", () => {
    const tempDir = createTrackedTempDir("pp-native-pkg-legacy-bin-");
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    const binPath = join(binDir, "privacy-pools");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        version: "1.7.0",
        bin: {
          "privacy-pools": "bin/privacy-pools",
        },
        privacyPoolsCliNative: {
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
      ).toBe(binPath);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
