import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearNativeChecksumCache,
  hasCompatibleNativeMetadata,
  hasValidNativeChecksum,
  resolveNativeBinaryPath,
  resolveNativeBridgeVersion,
} from "../../src/native-package-metadata.js";
import { createTrackedTempDir } from "../helpers/temp.ts";

describe("native package metadata", () => {
  test("caches native checksum results until the binary identity changes", () => {
    const tempDir = createTrackedTempDir("pp-native-metadata-cache-");
    const binaryPath = join(tempDir, "bin", "privacy-pools-cli-native-shell");
    mkdirSync(join(tempDir, "bin"), { recursive: true });
    writeFileSync(binaryPath, "#!/usr/bin/env node\n", "utf8");
    const originalSha = createHash("sha256")
      .update("#!/usr/bin/env node\n", "utf8")
      .digest("hex");

    try {
      clearNativeChecksumCache();

      expect(
        hasValidNativeChecksum(
          {
            privacyPoolsCliNative: {
              sha256: originalSha,
            },
          },
          binaryPath,
        ),
      ).toBe(true);
      expect(
        hasValidNativeChecksum(
          {
            privacyPoolsCliNative: {
              sha256: originalSha,
            },
          },
          binaryPath,
        ),
      ).toBe(true);

      writeFileSync(binaryPath, "#!/usr/bin/env bun!\n", "utf8");
      const nextTime = new Date(Date.now() + 1_000);
      utimesSync(binaryPath, nextTime, nextTime);

      expect(
        hasValidNativeChecksum(
          {
            privacyPoolsCliNative: {
              sha256: originalSha,
            },
          },
          binaryPath,
        ),
      ).toBe(false);
    } finally {
      clearNativeChecksumCache();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("reads only the explicit bridgeVersion field", () => {
    expect(
      resolveNativeBridgeVersion({
        bridgeVersion: " 2 ",
      }),
    ).toBe("2");
    expect(resolveNativeBridgeVersion({})).toBeNull();
  });

  test("requires the explicit metadata binary path", () => {
    const packageJsonPath = "/tmp/native/package.json";
    expect(
      resolveNativeBinaryPath(packageJsonPath, {
        privacyPoolsCliNative: {
          binaryPath: "bin/privacy-pools-cli-native-shell",
        },
      }),
    ).toBe("/tmp/native/bin/privacy-pools-cli-native-shell");

    expect(
      resolveNativeBinaryPath(packageJsonPath, {
        bin: {
          "privacy-pools": "bin/privacy-pools",
        },
      }),
    ).toBeNull();
  });

  test("requires current bridge and runtime metadata", () => {
    expect(
      hasCompatibleNativeMetadata(
        {
          privacyPoolsCliNative: {
            bridgeVersion: "1",
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
            bridgeVersion: undefined,
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
    ).toBe(false);

    expect(
      hasCompatibleNativeMetadata(
        {
          privacyPoolsCliNative: {
            bridgeVersion: "1",
            runtimeVersion: undefined,
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
