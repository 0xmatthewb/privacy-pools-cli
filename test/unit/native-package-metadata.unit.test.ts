import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  hasCompatibleNativeMetadata,
  hasValidNativeChecksum,
  resolveNativeBinaryPath,
  resolveNativeBridgeVersion,
} from "../../src/native-package-metadata.js";
import { createTrackedTempDir } from "../helpers/temp.ts";

describe("native package metadata", () => {
  test("prefers bridgeVersion and falls back to legacy protocolVersion", () => {
    expect(
      resolveNativeBridgeVersion({
        bridgeVersion: " 2 ",
        protocolVersion: "1",
      }),
    ).toBe("2");
    expect(
      resolveNativeBridgeVersion({
        protocolVersion: " 1 ",
      }),
    ).toBe("1");
    expect(resolveNativeBridgeVersion({})).toBeNull();
  });

  test("resolves metadata binary paths before considering legacy bins", () => {
    const packageJsonPath = "/tmp/native/package.json";
    expect(
      resolveNativeBinaryPath(packageJsonPath, {
        privacyPoolsCliNative: {
          binaryPath: "bin/privacy-pools-cli-native-shell",
        },
        bin: {
          "privacy-pools": "bin/privacy-pools",
        },
      }),
    ).toBe("/tmp/native/bin/privacy-pools-cli-native-shell");

    expect(
      resolveNativeBinaryPath(
        packageJsonPath,
        {
          bin: {
            "privacy-pools": "bin/privacy-pools",
          },
        },
        { allowLegacyBin: false },
      ),
    ).toBeNull();
  });

  test("accepts legacy protocolVersion metadata when the active bridge matches", () => {
    expect(
      hasCompatibleNativeMetadata(
        {
          privacyPoolsCliNative: {
            protocolVersion: "1",
            runtimeVersion: "runtime-v1",
            protocolProfile: "privacy-pools-v1",
          },
        },
        {
          nativeBridgeVersion: "1",
          runtimeVersion: "runtime-v1",
          protocolProfile: "privacy-pools-v1",
        },
      ),
    ).toBe(true);

    expect(
      hasCompatibleNativeMetadata(
        {
          privacyPoolsCliNative: {
            bridgeVersion: "1",
            runtimeVersion: "runtime-v2",
            protocolProfile: "privacy-pools-v1",
          },
        },
        {
          nativeBridgeVersion: "1",
          runtimeVersion: "runtime-v1",
          protocolProfile: "privacy-pools-v1",
        },
      ),
    ).toBe(false);
  });

  test("verifies native checksums against the packaged binary path", () => {
    const tempDir = createTrackedTempDir("pp-native-metadata-");
    const binaryPath = join(tempDir, "bin", "privacy-pools-cli-native-shell");
    mkdirSync(join(tempDir, "bin"), { recursive: true });
    writeFileSync(binaryPath, "#!/usr/bin/env node\n", "utf8");
    const sha256 = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");

    try {
      expect(
        hasValidNativeChecksum(
          {
            privacyPoolsCliNative: {
              sha256,
            },
          },
          binaryPath,
        ),
      ).toBe(true);

      expect(
        hasValidNativeChecksum(
          {
            privacyPoolsCliNative: {
              sha256: "deadbeef",
            },
          },
          binaryPath,
        ),
      ).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
