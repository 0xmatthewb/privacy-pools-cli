import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundledCircuitsDir } from "../../src/services/circuit-assets.js";
import { CLI_ROOT } from "../helpers/paths.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

const require = createRequire(import.meta.url);
const ALL_FILES = [
  "commitment.wasm",
  "commitment.zkey",
  "commitment.vkey",
  "withdraw.wasm",
  "withdraw.zkey",
  "withdraw.vkey",
] as const;

function installedSdkVersion(): string {
  const sdkPackageJsonPath = require.resolve(
    "@0xbow/privacy-pools-core-sdk/package.json",
  );
  const sdkPkg = JSON.parse(
    readFileSync(sdkPackageJsonPath, "utf8"),
  ) as { version: string };
  return sdkPkg.version;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("circuits:provision", () => {
  test("materializes bundled circuit artifacts into the selected directory", () => {
    const circuitsDir = createTrackedTempDir("pp-circuits-provision-");
    const version = installedSdkVersion();
    const bundledDir = bundledCircuitsDir(CLI_ROOT, version);

    const result = spawnSync("node", ["scripts/provision-circuits.mjs"], {
      cwd: CLI_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PRIVACY_POOLS_CIRCUITS_DIR: circuitsDir,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`circuits ready in ${resolve(circuitsDir)}`);

    for (const filename of ALL_FILES) {
      expect(sha256File(join(circuitsDir, filename))).toBe(
        sha256File(join(bundledDir, filename)),
      );
    }
  });

  test("skips files that already match the bundled checksums", () => {
    const circuitsDir = createTrackedTempDir("pp-circuits-provision-skip-");

    const first = spawnSync("node", ["scripts/provision-circuits.mjs"], {
      cwd: CLI_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PRIVACY_POOLS_CIRCUITS_DIR: circuitsDir,
      },
    });
    expect(first.status).toBe(0);

    const second = spawnSync("node", ["scripts/provision-circuits.mjs"], {
      cwd: CLI_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PRIVACY_POOLS_CIRCUITS_DIR: circuitsDir,
      },
    });

    expect(second.status).toBe(0);
    expect(second.stderr).toBe("");
    for (const filename of ALL_FILES) {
      expect(second.stdout).toContain(`skip ${filename}`);
    }
    expect(second.stdout).toContain("copied=0");
    expect(second.stdout).toContain(`skipped=${ALL_FILES.length}`);
  });
});
