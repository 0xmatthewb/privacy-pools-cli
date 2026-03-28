import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  SUPPORTED_NATIVE_DISTRIBUTIONS,
} from "../../src/native-distribution.js";

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
const conformanceWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "conformance.yml"),
  "utf8",
);
const frontendParityWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "frontend-parity.yml"),
  "utf8",
);
const fullAnvilWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "full-anvil.yml"),
  "utf8",
);
const nativePreviewWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "native-preview.yml"),
  "utf8",
);
const nativeCoverageWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "native-coverage.yml"),
  "utf8",
);
const packNativeTarballScript = readFileSync(
  join(CLI_ROOT, "scripts", "pack-native-tarball.mjs"),
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
  version: string;
  optionalDependencies?: Record<string, string>;
};

function extractTriplets(workflow: string): string[] {
  return Array.from(
    new Set(
      [...workflow.matchAll(/triplet:\s*([a-z0-9-]+)/g)].map(
        (match) => match[1]!,
      ),
    ),
  ).sort();
}

function extractCrossPlatformLabels(workflow: string): string[] {
  return [...workflow.matchAll(/label:\s*([a-z0-9-]+)/g)]
    .map((match) => match[1]!)
    .sort();
}

function expectedNativeTriplets(): string[] {
  return SUPPORTED_NATIVE_DISTRIBUTIONS.map((distribution) => distribution.triplet)
    .sort();
}

function expectedNativePackageNames(): string[] {
  return SUPPORTED_NATIVE_DISTRIBUTIONS.map((distribution) => distribution.packageName)
    .sort();
}

function extractJobSection(workflow: string, jobName: string): string {
  const sectionStart = workflow.indexOf(`${jobName}:`);
  expect(sectionStart).toBeGreaterThanOrEqual(0);

  const remaining = workflow.slice(sectionStart + jobName.length + 1);
  const nextJobMatch = remaining.match(/\n[a-z0-9-]+:\n/);
  const sectionEnd = nextJobMatch
    ? sectionStart + jobName.length + 1 + nextJobMatch.index!
    : workflow.length;

  return workflow.slice(sectionStart, sectionEnd);
}

describe("release workflow conformance", () => {
  test("blocking CI includes a packaged native smoke gate", () => {
    expect(ciWorkflow).toContain("npm-test:");
    expect(ciWorkflow).toContain("Run npm test");
    expect(ciWorkflow).toContain("run: npm test");
    expect(ciWorkflow).not.toContain("bun install --frozen-lockfile");
    expect(ciWorkflow).toContain("run: npm ci");
    expect(ciWorkflow).toContain("native-unit:");
    expect(ciWorkflow).toContain("Restore Rust cache");
    expect(ciWorkflow).toContain("Swatinem/rust-cache@v2");
    expect(ciWorkflow).toContain("Run native Rust lint checks");
    expect(ciWorkflow).toContain("npm run test:native:fmt && npm run test:native:lint");
    expect(ciWorkflow).toContain("Run native Rust unit tests");
    expect(ciWorkflow).toContain("run: npm run test:native");
    expect(ciWorkflow).toContain("native-smoke:");
    expect(ciWorkflow).toContain('node scripts/ci/select-jobs.mjs --job native-smoke');
    expect(ciWorkflow).toContain("npm run test:smoke:native:package");
    expect(ciWorkflow).toContain('- "22.x"');
    expect(ciWorkflow).toContain('- "24.x"');
    expect(ciWorkflow).toContain('- "25.x"');
  });

  test("blocking CI includes a root-only installed artifact gate", () => {
    const rootInstallSectionStart = ciWorkflow.indexOf("root-install-smoke:");
    expect(rootInstallSectionStart).toBeGreaterThanOrEqual(0);
    const rootInstallSectionEnd = ciWorkflow.indexOf(
      "native-smoke:",
      rootInstallSectionStart,
    );
    const rootInstallSection = ciWorkflow.slice(
      rootInstallSectionStart,
      rootInstallSectionEnd === -1 ? ciWorkflow.length : rootInstallSectionEnd,
    );

    expect(rootInstallSection).toContain("Select root-install-smoke");
    expect(rootInstallSection).toContain(
      'node scripts/ci/select-jobs.mjs --job root-install-smoke',
    );
    expect(rootInstallSection).toContain("Run root-only installed artifact gate");
    expect(rootInstallSection).toContain("run: npm run test:artifacts:root");
    expect(rootInstallSection).toContain('node-version: "25.x"');
  });

  test("blocking CI includes supported-target artifact install smoke", () => {
    const supportedSectionStart = ciWorkflow.indexOf("supported-native-smoke:");
    expect(supportedSectionStart).toBeGreaterThanOrEqual(0);
    const supportedSectionEnd = ciWorkflow.indexOf("anvil-e2e-smoke:", supportedSectionStart);
    const supportedSection = ciWorkflow.slice(
      supportedSectionStart,
      supportedSectionEnd === -1 ? ciWorkflow.length : supportedSectionEnd,
    );

    expect(ciWorkflow).toContain("supported-native-smoke:");
    expect(ciWorkflow).toContain(
      'node scripts/ci/select-jobs.mjs --job supported-native-smoke',
    );
    expect(supportedSection).toContain(
      'name: supported-native-smoke-${{ matrix.label }}-node-${{ matrix.node-version }}',
    );
    expect(supportedSection).toContain('- "25.x"');
    expect(supportedSection).not.toContain('- "22.x"');
    expect(supportedSection).not.toContain('- "24.x"');
    expect(supportedSection).toContain("windows-11-arm");
    expect(supportedSection).toContain("macos-15-intel");
    expect(supportedSection).toContain("node scripts/pack-native-tarball.mjs");
    expect(supportedSection).toContain("node scripts/verify-release-install.mjs");
    expect(extractCrossPlatformLabels(ciWorkflow)).toEqual(
      expectedNativeTriplets(),
    );
  });

  test("anvil smoke provisions rust for installed root-plus-native verification", () => {
    const anvilSectionStart = ciWorkflow.indexOf("anvil-e2e-smoke:");
    expect(anvilSectionStart).toBeGreaterThanOrEqual(0);
    const anvilSectionEnd = ciWorkflow.indexOf("coverage-guard:", anvilSectionStart);
    const anvilSection = ciWorkflow.slice(
      anvilSectionStart,
      anvilSectionEnd === -1 ? ciWorkflow.length : anvilSectionEnd,
    );

    expect(anvilSection).toContain("Setup Rust");
    expect(anvilSection).toContain("dtolnay/rust-toolchain@stable");
    expect(anvilSection).toContain("npm run test:e2e:anvil:smoke");
  });

  test("release workflow signs and publishes the checksum manifest", () => {
    expect(releaseWorkflow).toContain("sigstore/cosign-installer");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.sig");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.pem");
    expect(releaseWorkflow).toContain("id-token: write");
    expect(releaseWorkflow).toContain("node scripts/pack-native-tarball.mjs");
    expect(releaseWorkflow).toContain("node scripts/verify-release-install.mjs");
    expect(packNativeTarballScript).toContain("prepare-native-package.mjs");
    expect(packNativeTarballScript).toContain("verify-packed-native-package.mjs");
  });

  test("release workflow installs dependencies with npm ci and keeps Bun only on Bun-backed test lanes", () => {
    expect(releaseWorkflow).not.toContain("bun install --frozen-lockfile");
    expect(releaseWorkflow).toContain("run: npm ci");
    expect(releaseWorkflow).toContain("Stage 2: Create the distributable npm package");
    const packageSectionStart = releaseWorkflow.indexOf("package:");
    const packageSectionEnd = releaseWorkflow.indexOf("package-native:", packageSectionStart);
    const packageSection = releaseWorkflow.slice(packageSectionStart, packageSectionEnd);
    expect(packageSection).not.toContain("Setup Bun");
    expect(packageSection).toContain("run: npm ci");

    expect(extractJobSection(releaseWorkflow, "publish-root")).toContain("run: npm ci");
    expect(extractJobSection(releaseWorkflow, "publish-native")).toContain("run: npm ci");
    expect(extractJobSection(releaseWorkflow, "verify-registry-install")).toContain("run: npm ci");
  });

  test("workflow dependency setup matches the Bun-backed test runner boundary", () => {
    expect(conformanceWorkflow).toContain("Setup Bun");
    expect(conformanceWorkflow).toContain("run: npm ci");

    expect(frontendParityWorkflow).toContain("Setup Bun");
    expect(frontendParityWorkflow).toContain("run: npm ci");

    expect(fullAnvilWorkflow).toContain("Setup Bun");
    expect(fullAnvilWorkflow).toContain("run: npm ci");

    expect(nativePreviewWorkflow).not.toContain("Setup Bun");
    expect(nativePreviewWorkflow).toContain("run: npm ci");

    const nativeUnitSectionStart = ciWorkflow.indexOf("native-unit:");
    const nativeUnitSectionEnd = ciWorkflow.indexOf("supported-native-smoke:", nativeUnitSectionStart);
    const nativeUnitSection = ciWorkflow.slice(
      nativeUnitSectionStart,
      nativeUnitSectionEnd === -1 ? ciWorkflow.length : nativeUnitSectionEnd,
    );
    expect(nativeUnitSection).not.toContain("Setup Bun");
    expect(nativeUnitSection).not.toContain("run: npm ci");

    expect(nativeCoverageWorkflow).not.toContain("Setup Bun");
    expect(nativeCoverageWorkflow).not.toContain("run: npm ci");
  });

  test("release workflow publishes native optional packages to npm", () => {
    expect(releaseWorkflow).toContain("publish-native:");
    expect(releaseWorkflow).toContain("NPM_TOKEN");
    expect(releaseWorkflow).toContain('registry-url: "https://registry.npmjs.org"');
    expect(releaseWorkflow).toContain("npm publish");
    expect(releaseWorkflow).toContain("npm view");
    expect(releaseWorkflow).toContain("nativePackageNameForTriplet");
    expect(releaseWorkflow).toContain("Unsupported native triplet ${TRIPLET}.");
  });

  test("release workflow publishes the root launcher package to npm", () => {
    expect(releaseWorkflow).toContain("publish-root:");
    expect(releaseWorkflow).toContain(
      "NPM_TOKEN secret is required to publish the root npm package.",
    );
    expect(releaseWorkflow).toContain(
      'PACKAGE="$(node -p "require(\'./package.json\').name")"',
    );
    expect(releaseWorkflow).toContain(
      'CLI_TARBALL="$(echo release-artifacts/npm/*.tgz)"',
    );
    expect(releaseWorkflow).toContain('npm publish "${CLI_TARBALL}" --access public');
    expect(releaseWorkflow).toContain('npm view "${PACKAGE}@${VERSION}" version');
    expect(releaseWorkflow).toContain("- publish-native");
    expect(releaseWorkflow).toContain("- publish-root");
  });

  test("release workflow verifies the live npm registry install path", () => {
    expect(releaseWorkflow).toContain("verify-registry-install:");
    expect(releaseWorkflow).toContain("registry-install-${{ matrix.triplet }}");
    expect(releaseWorkflow).toContain("node scripts/verify-registry-install.mjs");
    expect(releaseWorkflow).toContain("--package");
    expect(releaseWorkflow).toContain("--version");
    expect(releaseWorkflow).toContain("- verify-registry-install");
  });

  test("registry install verifier checks exact native versions and the supported global npm path", () => {
    expect(verifyRegistryInstallScript).toContain("assertInstalledPackageVersion(");
    expect(verifyRegistryInstallScript).toContain('`Installed registry native package ${nativePackageName}`');
    expect(verifyRegistryInstallScript).toContain('`Global installed registry native package ${nativePackageName}`');
    expect(verifyRegistryInstallScript).toContain('"install"');
    expect(verifyRegistryInstallScript).toContain('"-g"');
    expect(verifyRegistryInstallScript).toContain('"--prefix"');
    expect(verifyRegistryInstallScript).toContain("assertGlobalLauncherBasics");
    expect(verifyRegistryInstallScript).toContain("assertGlobalNativeStatsSuccess");
  });

  test("release workflow keeps an explicit native release signoff gate", () => {
    expect(releaseWorkflow).toContain("environment:");
    expect(releaseWorkflow).toContain("native-release-signoff");
  });

  test("release workflow keeps the release and native smoke gates before packaging", () => {
    expect(releaseWorkflow).toContain("fetch-depth: 0");
    expect(releaseWorkflow).toContain("npm run test:release");
    expect(releaseWorkflow).not.toContain("Run benchmark gate against v1.7.0 baseline");
    expect(releaseWorkflow).not.toContain("run: npm run bench:gate:release");
    expect(releaseWorkflow).toContain("Run native smoke test");
    expect(releaseWorkflow).toContain("npm run test:smoke:native:package");
  });

  test("cross-platform smoke includes the windows arm64 native lane", () => {
    expect(crossPlatformWorkflow).toContain('name: smoke-${{ matrix.label }}-node-${{ matrix.node-version }}');
    expect(crossPlatformWorkflow).toContain('- "25.x"');
    expect(crossPlatformWorkflow).not.toContain('- "22.x"');
    expect(crossPlatformWorkflow).not.toContain('- "24.x"');
    expect(crossPlatformWorkflow).toContain("windows-11-arm");
    expect(crossPlatformWorkflow).toContain("win32-arm64-msvc");
    expect(crossPlatformWorkflow).toContain("npm run test:smoke:native:package");
  });

  test("cross-platform smoke also runs on main pushes", () => {
    expect(crossPlatformWorkflow).toContain("push:");
    expect(crossPlatformWorkflow).toContain("- main");
  });

  test("native coverage workflow enforces the repo's native coverage contract", () => {
    expect(nativeCoverageWorkflow).toContain("name: Native Coverage");
    expect(nativeCoverageWorkflow).toContain("Select native-coverage");
    expect(nativeCoverageWorkflow).toContain("Restore Rust cache");
    expect(nativeCoverageWorkflow).toContain("Swatinem/rust-cache@v2");
    expect(nativeCoverageWorkflow).toContain("taiki-e/install-action@cargo-llvm-cov");
    expect(nativeCoverageWorkflow).toContain("run: npm run test:coverage:native");
  });

  test("release native triplets stay aligned with optional dependencies and cross-platform smoke", () => {
    const expectedTriplets = expectedNativeTriplets();
    expect(extractTriplets(releaseWorkflow)).toEqual(expectedTriplets);
    expect(extractCrossPlatformLabels(crossPlatformWorkflow)).toEqual(
      expectedTriplets,
    );
    expect(
      Object.keys(packageJson.optionalDependencies ?? {}).sort(),
    ).toEqual(expectedNativePackageNames());
  });

  test("installed-artifact verifiers resolve optional native packages via module resolution", () => {
    for (const script of [
      verifyReleaseInstallScript,
      verifyRegistryInstallScript,
      verifyCliInstallAnvilScript,
    ]) {
      expect(script).toContain("resolveInstalledDependencyPackagePath");
      expect(script).not.toContain(
        'join(\n    installRoot,\n    "node_modules",\n    ...nativePackageName.split("/"),\n    "package.json",\n  )',
      );
    }
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
