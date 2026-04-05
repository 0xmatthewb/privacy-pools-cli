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
      [...workflow.matchAll(/triplet:\s*([a-z0-9-]+)/g)]
        .map((match) => match[1]!)
        .filter((triplet) => triplet !== "-"),
    ),
  ).sort();
}

function extractLabels(workflow: string): string[] {
  return [...workflow.matchAll(/label:\s*([a-z0-9-]+)/g)]
    .map((match) => match[1]!)
    .sort();
}

function extractRegistryInstallNodeVersions(workflow: string): string[] {
  const match = workflow.match(
    /verify-registry-install:[\s\S]*?node-version:\s*((?:\n\s*-\s*"[^"]+")+)/,
  );
  if (!match) {
    return [];
  }

  return [...match[1]!.matchAll(/-\s*"([^"]+)"/g)]
    .map((entry) => entry[1]!)
    .sort();
}

function extractValidateNodeVersions(workflow: string): string[] {
  const match = workflow.match(
    /validate:[\s\S]*?node-version:\s*((?:\n\s*-\s*"[^"]+")+)/,
  );
  if (!match) {
    return [];
  }

  return [...match[1]!.matchAll(/-\s*"([^"]+)"/g)]
    .map((entry) => entry[1]!)
    .sort();
}

function extractWorkflowJobNodeVersions(
  workflow: string,
  jobName: string,
): string[] {
  const escapedJobName = jobName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = workflow.match(
    new RegExp(
      `${escapedJobName}:[\\s\\S]*?node-version:\\s*((?:\\n\\s*-\\s*"[^"]+")+)`,
    ),
  );
  if (!match) {
    return [];
  }

  return [...match[1]!.matchAll(/-\s*"([^"]+)"/g)]
    .map((entry) => entry[1]!)
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

    expect(ciWorkflow).toContain("npm test");
    expect(ciWorkflow).toContain("npm run test:coverage");
    expect(ciWorkflow).toContain("npm run test:native");
    expect(ciWorkflow).toContain("npm run test:smoke:native:package");
    expect(ciWorkflow).toContain("npm run test:e2e:anvil:smoke");
  });

  test("release workflow keeps the publish and verification contract", () => {
    for (const requiredJob of [
      "validate:",
      "package:",
      "verify-package-install:",
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
    expect(releaseWorkflow).toContain("Release Artifact");
  });

  test("release validate job provisions the native toolchain required by test:release", () => {
    expect(releaseWorkflow).toMatch(
      /validate:[\s\S]*?uses:\s+dtolnay\/rust-toolchain@stable/m,
    );
    expect(releaseWorkflow).toMatch(
      /validate:[\s\S]*?uses:\s+Swatinem\/rust-cache@v2/m,
    );
    expect(releaseWorkflow).toMatch(
      /validate:[\s\S]*?uses:\s+taiki-e\/install-action@cargo-llvm-cov/m,
    );
  });

  test("release validate job exercises the full supported node range", () => {
    expect(extractValidateNodeVersions(releaseWorkflow)).toEqual([
      "22.x",
      "23.x",
      "24.x",
      "25.x",
    ]);
  });

  test("release workflow verifies packaged installs before publish", () => {
    expect(releaseWorkflow).toContain(
      "packaged-install-${{ matrix.triplet }}-node-${{ matrix.node-version }}",
    );
    expect(releaseWorkflow).toContain("name: native-package-${{ matrix.triplet }}");
    expect(releaseWorkflow).toContain(
      "node scripts/verify-release-install.mjs",
    );
    expect(releaseWorkflow).toMatch(
      /publish-native:[\s\S]*?needs:[\s\S]*?verify-package-install/m,
    );
  });

  test("release workflow verifies published installs across the supported node range", () => {
    expect(extractRegistryInstallNodeVersions(releaseWorkflow)).toEqual([
      "22.x",
      "23.x",
      "24.x",
      "25.x",
    ]);
  });

  test("release workflow verifies packaged installs across the supported node range", () => {
    expect(extractWorkflowJobNodeVersions(releaseWorkflow, "verify-package-install")).toEqual([
      "22.x",
      "23.x",
      "24.x",
      "25.x",
    ]);
  });

  test("blocking CI smoke lanes cover the full supported packaged-install range", () => {
    const expectedNodeVersions = ["22.x", "23.x", "24.x", "25.x"];
    expect(extractWorkflowJobNodeVersions(ciWorkflow, "packaged-smoke")).toEqual(
      expectedNodeVersions,
    );
    expect(extractWorkflowJobNodeVersions(ciWorkflow, "native-smoke")).toEqual(
      expectedNodeVersions,
    );
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
