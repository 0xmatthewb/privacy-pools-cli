import { describe, expect, test } from "bun:test";
import type { CliPackageInfo } from "../../src/package-info.ts";
import { detectNativeRuntimeAdvisory } from "../../src/native-runtime-advisory.ts";

const PKG: CliPackageInfo = {
  version: "1.7.0",
  optionalDependencies: {
    "@0xmatthewb/privacy-pools-cli-native-macos-arm64": "1.7.0",
  },
  packageRoot: "/tmp/privacy-pools-cli",
  packageJsonPath: "/tmp/privacy-pools-cli/package.json",
};

describe("detectNativeRuntimeAdvisory", () => {
  test("returns null when native is explicitly disabled", () => {
    const advisory = detectNativeRuntimeAdvisory(PKG, {
      env: { PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1" },
      nativePackageName: () => "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      resolveInstalledNativeBinary: () => null,
      isSourceCheckout: () => false,
    });

    expect(advisory).toBeNull();
  });

  test("returns null when an explicit binary override is set", () => {
    const advisory = detectNativeRuntimeAdvisory(PKG, {
      env: { PRIVACY_POOLS_CLI_BINARY: "/tmp/privacy-pools-native" },
      nativePackageName: () => "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      resolveInstalledNativeBinary: () => null,
      isSourceCheckout: () => false,
    });

    expect(advisory).toBeNull();
  });

  test("returns null on unsupported hosts", () => {
    const advisory = detectNativeRuntimeAdvisory(PKG, {
      nativePackageName: () => null,
      resolveInstalledNativeBinary: () => null,
      isSourceCheckout: () => false,
    });

    expect(advisory).toBeNull();
  });

  test("returns null for source checkouts", () => {
    const advisory = detectNativeRuntimeAdvisory(PKG, {
      nativePackageName: () => "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      resolveInstalledNativeBinary: () => null,
      isSourceCheckout: () => true,
    });

    expect(advisory).toBeNull();
  });

  test("returns null when the installed native binary is available", () => {
    const advisory = detectNativeRuntimeAdvisory(PKG, {
      nativePackageName: () => "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      resolveInstalledNativeBinary: () => "/tmp/privacy-pools-native",
      isSourceCheckout: () => false,
    });

    expect(advisory).toBeNull();
  });

  test("allows advisory checks to warm the native verification cache", () => {
    let recordVerificationCache: boolean | undefined;

    const advisory = detectNativeRuntimeAdvisory(PKG, {
      nativePackageName: () => "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      resolveInstalledNativeBinary: (_pkg, options) => {
        recordVerificationCache = options?.recordVerificationCache;
        return "/tmp/privacy-pools-native";
      },
      isSourceCheckout: () => false,
    });

    expect(advisory).toBeNull();
    expect(recordVerificationCache).toBeUndefined();
  });

  test("returns a discovery warning when a supported published install is missing native acceleration", () => {
    const advisory = detectNativeRuntimeAdvisory(PKG, {
      nativePackageName: () => "@0xmatthewb/privacy-pools-cli-native-macos-arm64",
      resolveInstalledNativeBinary: () => null,
      isSourceCheckout: () => false,
    });

    expect(advisory).toEqual({
      code: "native_acceleration_unavailable",
      message:
        "The optional native runtime for this supported host is unavailable or invalid, so the CLI is using the safe JS path. All commands remain available, but read-only discovery commands may be slower. Reinstall without --omit=optional and ensure optional dependencies are enabled.",
      affects: ["discovery"],
    });
  });
});
