import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import { SUPPORTED_NATIVE_DISTRIBUTIONS } from "../../src/native-distribution.js";

const releaseWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "release.yml"),
  "utf8",
);
const ciWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "ci.yml"),
  "utf8",
);
const crossPlatformWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "cross-platform.yml"),
  "utf8",
);
const nativeCoverageWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "native-coverage.yml"),
  "utf8",
);
const verifyReleaseInstallScript = readFileSync(
  join(CLI_ROOT, "scripts", "verify-release-install.mjs"),
  "utf8",
);
const verifyRegistryInstallScript = readFileSync(
  join(CLI_ROOT, "scripts", "verify-registry-install.mjs"),
  "utf8",
);
const verifyCliInstallAnvilScript = readFileSync(
  join(CLI_ROOT, "scripts", "verify-cli-install-anvil.mjs"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
) as {
  optionalDependencies?: Record<string, string>;
};

function extractTriplets(workflow: string): string[] {
  return Array.from(
    new Set(
      [...workflow.matchAll(/triplet:\s*([a-z0-9-]+)/g)].map((match) => match[1]!),
    ),
  ).sort();
}

function extractLabels(workflow: string): string[] {
  return [...workflow.matchAll(/label:\s*([a-z0-9-]+)/g)]
    .map((match) => match[1]!)
    .sort();
}

function expectedNativeTriplets(): string[] {
  return SUPPORTED_NATIVE_DISTRIBUTIONS.map((distribution) => distribution.triplet).sort();
}

function expectedNativePackageNames(): string[] {
  return SUPPORTED_NATIVE_DISTRIBUTIONS.map((distribution) => distribution.packageName).sort();
}

describe("release workflow conformance", () => {
  test("blocking CI keeps the expected test and verification lanes", () => {
    for (const requiredJob of [
      "linux-core:",
      "npm-test:",
      "packaged-smoke:",
      "root-install-smoke:",
      "native-smoke:",
      "native-unit:",
      "supported-native-smoke:",
      "anvil-e2e-smoke:",
      "coverage-guard:",
      "evals:",
      "conformance-core:",
    ]) {
      expect(ciWorkflow).toContain(requiredJob);
    }

    expect(ciWorkflow).toContain("run: npm test");
    expect(ciWorkflow).toContain("run: npm run test:coverage");
    expect(ciWorkflow).toContain("run: npm run test:native");
    expect(ciWorkflow).toContain("npm run test:smoke:native:package");
    expect(ciWorkflow).toContain("npm run test:e2e:anvil:smoke");
  });

  test("release workflow keeps the publish and verification contract", () => {
    for (const requiredJob of [
      "validate:",
      "package:",
      "publish-native:",
      "publish-root:",
      "verify-registry-install:",
      "release:",
    ]) {
      expect(releaseWorkflow).toContain(requiredJob);
    }

    expect(releaseWorkflow).toContain("npm run test:release");
    expect(releaseWorkflow).toContain("npm publish");
    expect(releaseWorkflow).toContain("node scripts/verify-release-install.mjs");
    expect(releaseWorkflow).toContain("node scripts/verify-registry-install.mjs");
    expect(releaseWorkflow).toContain("native-release-signoff");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.sig");
    expect(releaseWorkflow).toContain("name: github-release");
  });

  test("native triplets stay aligned across release, smoke workflows, and package metadata", () => {
    const expectedTriplets = expectedNativeTriplets();

    expect(extractTriplets(releaseWorkflow)).toEqual(expectedTriplets);
    expect(extractLabels(crossPlatformWorkflow)).toEqual(expectedTriplets);
    expect(
      Object.keys(packageJson.optionalDependencies ?? {}).sort(),
    ).toEqual(expectedNativePackageNames());
  });

  test("native coverage workflow keeps the repo's native coverage gate", () => {
    expect(nativeCoverageWorkflow).toContain("cargo-llvm-cov");
    expect(nativeCoverageWorkflow).toContain("npm run test:coverage:native");
    expect(nativeCoverageWorkflow).not.toContain("bun install --frozen-lockfile");
  });

  test("installed-artifact verifier scripts resolve native packages via module resolution", () => {
    for (const script of [
      verifyReleaseInstallScript,
      verifyRegistryInstallScript,
      verifyCliInstallAnvilScript,
    ]) {
      expect(script).toContain("resolveInstalledDependencyPackagePath");
    }

    expect(verifyCliInstallAnvilScript).toContain("PRIVACY_POOLS_CLI_DISABLE_NATIVE");
  });
});
