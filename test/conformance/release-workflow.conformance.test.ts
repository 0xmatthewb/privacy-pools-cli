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

describe("release workflow conformance", () => {
  test("blocking CI includes a packaged native smoke gate", () => {
    expect(ciWorkflow).toContain("native-smoke:");
    expect(ciWorkflow).toContain('node scripts/ci/select-jobs.mjs --job native-smoke');
    expect(ciWorkflow).toContain("npm run test:smoke:native");
  });

  test("release workflow signs and publishes the checksum manifest", () => {
    expect(releaseWorkflow).toContain("sigstore/cosign-installer");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.sig");
    expect(releaseWorkflow).toContain("SHA256SUMS.txt.pem");
    expect(releaseWorkflow).toContain("id-token: write");
  });

  test("release workflow keeps an explicit native release signoff gate", () => {
    expect(releaseWorkflow).toContain("environment:");
    expect(releaseWorkflow).toContain("native-release-signoff");
  });

  test("cross-platform smoke includes the windows arm64 native lane", () => {
    expect(crossPlatformWorkflow).toContain("windows-11-arm");
    expect(crossPlatformWorkflow).toContain("win32-arm64-msvc");
    expect(crossPlatformWorkflow).toContain("npm run test:smoke:native");
  });
});
