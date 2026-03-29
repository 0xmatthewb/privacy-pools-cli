import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  ensureCircuitArtifacts,
  getCircuitArtifactPaths,
  overrideCircuitChecksumsForTests,
  resetCircuitArtifactsCacheForTests,
} from "../../src/services/circuits.ts";
import {
  bundledCircuitsDir,
  sdkTagFromVersion,
} from "../../src/services/circuit-assets.js";
import sharedChecksumManifest from "../../src/services/circuit-checksums.js";
import { createTrackedTempDir } from "../helpers/temp.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CIRCUITS_DIR = process.env.PRIVACY_POOLS_CIRCUITS_DIR;
const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_CONFIG_DIR = process.env.PRIVACY_POOLS_CONFIG_DIR;
const require = createRequire(import.meta.url);

const ALL_FILES = [
  "commitment.wasm",
  "commitment.zkey",
  "commitment.vkey",
  "withdraw.wasm",
  "withdraw.zkey",
  "withdraw.vkey",
] as const;

const TEMP_DIRS: string[] = [];
const TEST_BYTES = new Uint8Array([1, 2, 3]);
const TEST_HASH = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";

function installedSdkTag(): string {
  const sdkPackageJsonPath = require.resolve(
    "@0xbow/privacy-pools-core-sdk/package.json"
  );
  const sdkPkg = JSON.parse(
    require("node:fs").readFileSync(sdkPackageJsonPath, "utf8")
  ) as { version: string };
  return sdkTagFromVersion(sdkPkg.version);
}

function installTestChecksums(): void {
  overrideCircuitChecksumsForTests({
    [installedSdkTag()]: Object.fromEntries(
      ALL_FILES.map((filename) => [filename, TEST_HASH])
    ),
  });
}

function tempDir(): string {
  const dir = createTrackedTempDir("pp-circuits-");
  TEMP_DIRS.push(dir);
  return dir;
}

function bundledArtifactsDir(): string {
  return bundledCircuitsDir(CLI_ROOT, installedSdkTag());
}

describe("circuits service", () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    mock.restore();
    resetCircuitArtifactsCacheForTests();

    if (ORIGINAL_CIRCUITS_DIR === undefined) delete process.env.PRIVACY_POOLS_CIRCUITS_DIR;
    else process.env.PRIVACY_POOLS_CIRCUITS_DIR = ORIGINAL_CIRCUITS_DIR;

    if (ORIGINAL_HOME === undefined) delete process.env.PRIVACY_POOLS_HOME;
    else process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;

    if (ORIGINAL_CONFIG_DIR === undefined) delete process.env.PRIVACY_POOLS_CONFIG_DIR;
    else process.env.PRIVACY_POOLS_CONFIG_DIR = ORIGINAL_CONFIG_DIR;

    while (TEMP_DIRS.length > 0) {
      rmSync(TEMP_DIRS.pop()!, { recursive: true, force: true });
    }
  });

  test("uses bundled artifacts by default without fetching", async () => {
    delete process.env.PRIVACY_POOLS_CIRCUITS_DIR;
    delete process.env.PRIVACY_POOLS_HOME;
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;

    const fetchMock = mock(() => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const artifactsDir = await ensureCircuitArtifacts();
    expect(artifactsDir).toBe(resolve(bundledArtifactsDir()));
    expect(fetchMock).not.toHaveBeenCalled();

    for (const filename of ALL_FILES) {
      expect(existsSync(join(artifactsDir, filename))).toBe(true);
    }

    const commitmentPaths = await getCircuitArtifactPaths("commitment");
    expect(commitmentPaths.wasm).toBe(resolve(artifactsDir, "commitment.wasm"));
    expect(commitmentPaths.zkey).toBe(resolve(artifactsDir, "commitment.zkey"));
    expect(commitmentPaths.vkey).toBe(resolve(artifactsDir, "commitment.vkey"));
  });

  test("reuses a verified override directory ahead of bundled assets", async () => {
    const dir = tempDir();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = dir;
    delete process.env.PRIVACY_POOLS_HOME;
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
    installTestChecksums();

    for (const filename of ALL_FILES) {
      writeFileSync(join(dir, filename), TEST_BYTES);
    }

    const fetchMock = mock(() => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const artifactsDir = await ensureCircuitArtifacts();
    expect(artifactsDir).toBe(resolve(dir));
    expect(fetchMock).not.toHaveBeenCalled();

    for (const filename of ALL_FILES) {
      expect(existsSync(join(dir, filename))).toBe(true);
    }

    const commitmentPaths = await getCircuitArtifactPaths("commitment");
    expect(commitmentPaths.wasm).toBe(resolve(dir, "commitment.wasm"));
    expect(commitmentPaths.zkey).toBe(resolve(dir, "commitment.zkey"));
    expect(commitmentPaths.vkey).toBe(resolve(dir, "commitment.vkey"));
  });

  test("falls back to bundled artifacts when the override directory is invalid", async () => {
    const dir = tempDir();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = dir;

    const fetchMock = mock(() => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(ensureCircuitArtifacts()).resolves.toBe(resolve(bundledArtifactsDir()));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails closed when neither the override nor bundled assets verify", async () => {
    overrideCircuitChecksumsForTests({
      [installedSdkTag()]: Object.fromEntries(
        ALL_FILES.map((filename) => [filename, "0".repeat(64)])
      ),
    });

    delete process.env.PRIVACY_POOLS_CIRCUITS_DIR;
    delete process.env.PRIVACY_POOLS_HOME;
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;

    const fetchMock = mock(() => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(ensureCircuitArtifacts()).rejects.toMatchObject({
      name: "CLIError",
      category: "PROOF",
      code: "PROOF_GENERATION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("runtime circuit service no longer references raw github downloads", () => {
    const source = readFileSync(
      join(CLI_ROOT, "src", "services", "circuits.ts"),
      "utf8"
    );
    expect(source).not.toContain("raw.githubusercontent.com");
  });

  test("shared checksum manifest includes the installed SDK tag", () => {
    const manifest = sharedChecksumManifest as Record<string, Record<string, string>>;

    expect(manifest[installedSdkTag()]).toBeDefined();
    expect(Object.keys(manifest)).toEqual([installedSdkTag()]);
    expect(Object.keys(manifest[installedSdkTag()])).toEqual([...ALL_FILES]);
  });
});
