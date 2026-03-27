import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launcherTestInternals } from "../../src/launcher.ts";
import { decodeWorkerRequestV1 } from "../../src/runtime/v1/request.ts";

const PKG = { version: "1.7.0" };

describe("launcher routing", () => {
  test("defaults to the js worker boundary and encodes argv", () => {
    const target = launcherTestInternals.resolveLaunchTarget(PKG, [
      "status",
      "--json",
    ]);

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
  });

  test("resolves an installed native binary only on exact version match", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pp-native-pkg-"));
    const packageJsonPath = join(tempDir, "package.json");
    const binDir = join(tempDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      packageJsonPath,
      JSON.stringify({
        version: "1.7.0",
        bin: {
          "privacy-pools": "bin/privacy-pools",
        },
      }),
      "utf8",
    );
    writeFileSync(join(binDir, "privacy-pools"), "", "utf8");

    try {
      expect(
        launcherTestInternals.resolveInstalledNativeBinary(PKG, {
          platform: "darwin",
          arch: "arm64",
          requireResolve: () => packageJsonPath,
        }),
      ).toBe(join(tempDir, "bin", "privacy-pools"));

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
});
