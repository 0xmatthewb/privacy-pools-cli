import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launcherTestInternals } from "../../src/launcher.ts";
import { decodeWorkerRequestV1 } from "../../src/runtime/v1/request.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

const PKG = { version: "1.7.0" };

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
      decodeWorkerRequestV1(
        String(target.env.PRIVACY_POOLS_WORKER_REQUEST_B64),
      ),
    ).toEqual({
      protocolVersion: "1",
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
    expect(target.env.PRIVACY_POOLS_INTERNAL_JS_WORKER_COMMAND).toBe(
      process.execPath,
    );
    expect(target.env.PRIVACY_POOLS_INTERNAL_JS_WORKER_ARGS_B64).toBeTruthy();
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
          sha256,
          protocolVersion: "1",
          triplet: "darwin-arm64",
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
    writeFileSync(join(binDir, "privacy-pools"), "mismatch", "utf8");
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        version: "1.7.0",
        bin: {
          "privacy-pools": "bin/privacy-pools",
        },
        privacyPoolsCliNative: {
          sha256: "deadbeef",
          protocolVersion: "1",
          triplet: "darwin-arm64",
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
