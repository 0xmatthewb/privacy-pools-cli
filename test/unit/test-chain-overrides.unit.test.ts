import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../../src/config/chains.ts";
import {
  resetSharedAnvilChainOverrideCacheForTests,
  resolveSharedAnvilChainOverride,
} from "../../src/config/test-chain-overrides.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_PP_ANVIL_E2E = process.env.PP_ANVIL_E2E;
const ORIGINAL_PP_ANVIL_SHARED_ENV_FILE = process.env.PP_ANVIL_SHARED_ENV_FILE;

function restoreEnv(): void {
  if (ORIGINAL_PP_ANVIL_E2E === undefined) {
    delete process.env.PP_ANVIL_E2E;
  } else {
    process.env.PP_ANVIL_E2E = ORIGINAL_PP_ANVIL_E2E;
  }

  if (ORIGINAL_PP_ANVIL_SHARED_ENV_FILE === undefined) {
    delete process.env.PP_ANVIL_SHARED_ENV_FILE;
  } else {
    process.env.PP_ANVIL_SHARED_ENV_FILE = ORIGINAL_PP_ANVIL_SHARED_ENV_FILE;
  }

  resetSharedAnvilChainOverrideCacheForTests();
  cleanupTrackedTempDirs();
}

function writeSharedEnvFile(): string {
  const dir = createTrackedTempDir("pp-test-chain-overrides-");
  const file = join(dir, "shared-anvil-env.json");
  writeFileSync(
    file,
    JSON.stringify({
      chainName: "sepolia",
      chainId: 11155111,
      entrypoint: "0x9999999999999999999999999999999999999999",
      startBlock: 123456,
    }),
    "utf8",
  );
  return file;
}

describe("shared Anvil test chain overrides", () => {
  afterEach(restoreEnv);

  test("returns null outside shared Anvil E2E mode", () => {
    process.env.PP_ANVIL_SHARED_ENV_FILE = writeSharedEnvFile();

    expect(resolveSharedAnvilChainOverride(CHAINS.sepolia)).toBeNull();
  });

  test("returns null when the shared env file targets another chain", () => {
    const dir = createTrackedTempDir("pp-test-chain-overrides-");
    const file = join(dir, "shared-anvil-env.json");
    writeFileSync(
      file,
      JSON.stringify({
        chainName: "mainnet",
        chainId: 1,
        entrypoint: "0x8888888888888888888888888888888888888888",
        startBlock: 222,
      }),
      "utf8",
    );

    process.env.PP_ANVIL_E2E = "1";
    process.env.PP_ANVIL_SHARED_ENV_FILE = file;

    expect(resolveSharedAnvilChainOverride(CHAINS.sepolia)).toBeNull();
  });

  test("loads entrypoint and startBlock overrides for the shared Anvil chain", () => {
    process.env.PP_ANVIL_E2E = "1";
    process.env.PP_ANVIL_SHARED_ENV_FILE = writeSharedEnvFile();

    expect(resolveSharedAnvilChainOverride(CHAINS.sepolia)).toEqual({
      entrypoint: "0x9999999999999999999999999999999999999999",
      startBlock: 123456n,
    });
  });
});
