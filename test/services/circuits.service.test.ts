import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ensureCircuitArtifacts,
  getCircuitArtifactPaths,
  overrideCircuitChecksumsForTests,
  resetCircuitArtifactsCacheForTests,
} from "../../src/services/circuits.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CIRCUITS_DIR = process.env.PRIVACY_POOLS_CIRCUITS_DIR;
const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_CONFIG_DIR = process.env.PRIVACY_POOLS_CONFIG_DIR;

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

function installTestChecksums(): void {
  overrideCircuitChecksumsForTests({
    "v1.1.0": Object.fromEntries(
      ALL_FILES.map((filename) => [filename, TEST_HASH])
    ),
  });
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-circuits-"));
  TEMP_DIRS.push(dir);
  return dir;
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

  test("downloads missing artifacts into the configured directory", async () => {
    const dir = tempDir();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = dir;
    delete process.env.PRIVACY_POOLS_HOME;
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
    installTestChecksums();

    const fetchMock = mock((input: RequestInfo | URL) => {
      expect(String(input)).toContain("raw.githubusercontent.com/0xbow-io/privacy-pools-core/");
      return Promise.resolve(new Response(TEST_BYTES, { status: 200 }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const artifactsDir = await ensureCircuitArtifacts();
    expect(artifactsDir).toBe(resolve(dir));
    expect(fetchMock).toHaveBeenCalledTimes(ALL_FILES.length);

    for (const filename of ALL_FILES) {
      expect(existsSync(join(dir, filename))).toBe(true);
    }

    const commitmentPaths = await getCircuitArtifactPaths("commitment");
    expect(commitmentPaths.wasm).toBe(resolve(dir, "commitment.wasm"));
    expect(commitmentPaths.zkey).toBe(resolve(dir, "commitment.zkey"));
    expect(commitmentPaths.vkey).toBe(resolve(dir, "commitment.vkey"));
  });

  test("reuses a complete artifact directory without fetching", async () => {
    const dir = tempDir();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = dir;
    installTestChecksums();

    for (const filename of ALL_FILES) {
      writeFileSync(join(dir, filename), TEST_BYTES);
    }

    const fetchMock = mock(() => {
      throw new Error("fetch should not be called");
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(ensureCircuitArtifacts()).resolves.toBe(resolve(dir));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("surfaces download failures as proof errors", async () => {
    const dir = tempDir();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = dir;
    installTestChecksums();

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("unavailable", { status: 503 }))
    ) as typeof fetch;

    await expect(ensureCircuitArtifacts()).rejects.toMatchObject({
      name: "CLIError",
      category: "PROOF",
      code: "PROOF_GENERATION_FAILED",
    });
  });

  test("rejects checksum mismatches for downloaded artifacts", async () => {
    const dir = tempDir();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = dir;
    installTestChecksums();

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(new Uint8Array([9, 9, 9]), { status: 200 }))
    ) as typeof fetch;

    await expect(ensureCircuitArtifacts()).rejects.toMatchObject({
      name: "CLIError",
      category: "PROOF",
      code: "PROOF_GENERATION_FAILED",
    });
  });
});
