import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

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
const packageJson = JSON.parse(
  readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
) as {
  version: string;
  optionalDependencies?: Record<string, string>;
};

function extractTriplets(workflow: string): string[] {
  return [...workflow.matchAll(/triplet:\s*([a-z0-9-]+)/g)]
    .map((match) => match[1]!)
    .sort();
}

function extractCrossPlatformLabels(workflow: string): string[] {
  return [...workflow.matchAll(/label:\s*([a-z0-9-]+)/g)]
    .map((match) => match[1]!)
    .sort();
}

function expectedNativeTriplets(): string[] {
  return Object.keys(packageJson.optionalDependencies ?? {})
    .filter((name) => name.startsWith("@0xbow/privacy-pools-cli-native-"))
    .map((name) => name.replace("@0xbow/privacy-pools-cli-native-", ""))
    .sort();
}

describe("release workflow conformance", () => {
  test("blocking CI includes a packaged native smoke gate", () => {
    expect(ciWorkflow).toContain("native-smoke:");
    expect(ciWorkflow).toContain('node scripts/ci/select-jobs.mjs --job native-smoke');
    expect(ciWorkflow).toContain("npm run test:smoke:native");
    expect(ciWorkflow).toContain('- "22.x"');
    expect(ciWorkflow).toContain('- "25.x"');
  });

  test("blocking CI includes supported-target artifact install smoke", () => {
    expect(ciWorkflow).toContain("supported-native-smoke:");
    expect(ciWorkflow).toContain(
      'node scripts/ci/select-jobs.mjs --job supported-native-smoke',
    );
    expect(ciWorkflow).toContain("windows-11-arm");
    expect(ciWorkflow).toContain("macos-15-intel");
    expect(ciWorkflow).toContain("node scripts/verify-release-install.mjs");
  });

  test("release workflow signs and publishes the checksum manifest", () => {
    expect(releaseWorkflow).toContain("sigstore/cosign-installer");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.sig");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.pem");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain(
      "node scripts/verify-packed-native-package.mjs",
    );
    expect(releaseWorkflow).toContain("node scripts/verify-release-install.mjs");
  });

  test("release workflow keeps an explicit native release signoff gate", () => {
    expect(releaseWorkflow).toContain("environment:");
    expect(releaseWorkflow).toContain("native-release-signoff");
  });

  test("release workflow keeps the release and native smoke gates before packaging", () => {
    expect(releaseWorkflow).toContain("npm run test:release");
    expect(releaseWorkflow).toContain("npm run bench:gate");
    expect(releaseWorkflow).toContain("Run native smoke test");
    expect(releaseWorkflow).toContain("npm run test:smoke:native");
  });

  test("cross-platform smoke includes the windows arm64 native lane", () => {
    expect(crossPlatformWorkflow).toContain("windows-11-arm");
    expect(crossPlatformWorkflow).toContain("win32-arm64-msvc");
    expect(crossPlatformWorkflow).toContain("npm run test:smoke:native");
  });

  test("cross-platform smoke also runs on main pushes", () => {
    expect(crossPlatformWorkflow).toContain("push:");
    expect(crossPlatformWorkflow).toContain("- main");
  });

  test("release native triplets stay aligned with optional dependencies and cross-platform smoke", () => {
    const expectedTriplets = expectedNativeTriplets();
    expect(extractTriplets(releaseWorkflow)).toEqual(expectedTriplets);
    expect(extractCrossPlatformLabels(crossPlatformWorkflow)).toEqual(
      expectedTriplets,
    );
  });

  test("release workflow validates the tag against package.json version", () => {
    expect(releaseWorkflow).toContain("Validate release tag and native dependency versions");
    expect(releaseWorkflow).toContain('PKG_VERSION="$(node -p "require(\'./package.json\').version")"');
    expect(releaseWorkflow).toContain('EXPECTED_TAG="v${PKG_VERSION}"');
    expect(releaseWorkflow).toContain(
      `Release tag \${TAG} does not match package.json version \${PKG_VERSION}.`,
    );
  });
});
