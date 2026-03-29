import { afterEach, describe, expect, test } from "bun:test";
import { buildTestRunnerEnv } from "../../scripts/test-runner-env.mjs";

const ORIGINAL_PRIVATE_KEY = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const ORIGINAL_PP_RPC_URL = process.env.PP_RPC_URL;
const ORIGINAL_PP_ANVIL_SHARED_ENV_FILE = process.env.PP_ANVIL_SHARED_ENV_FILE;
const ORIGINAL_PP_KEEP_COVERAGE_ROOT = process.env.PP_KEEP_COVERAGE_ROOT;
const ORIGINAL_PP_INSTALL_CLI_TARBALL = process.env.PP_INSTALL_CLI_TARBALL;

afterEach(() => {
  if (ORIGINAL_PRIVATE_KEY === undefined) {
    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
  } else {
    process.env.PRIVACY_POOLS_PRIVATE_KEY = ORIGINAL_PRIVATE_KEY;
  }

  if (ORIGINAL_PP_RPC_URL === undefined) {
    delete process.env.PP_RPC_URL;
  } else {
    process.env.PP_RPC_URL = ORIGINAL_PP_RPC_URL;
  }

  if (ORIGINAL_PP_ANVIL_SHARED_ENV_FILE === undefined) {
    delete process.env.PP_ANVIL_SHARED_ENV_FILE;
  } else {
    process.env.PP_ANVIL_SHARED_ENV_FILE = ORIGINAL_PP_ANVIL_SHARED_ENV_FILE;
  }

  if (ORIGINAL_PP_KEEP_COVERAGE_ROOT === undefined) {
    delete process.env.PP_KEEP_COVERAGE_ROOT;
  } else {
    process.env.PP_KEEP_COVERAGE_ROOT = ORIGINAL_PP_KEEP_COVERAGE_ROOT;
  }

  if (ORIGINAL_PP_INSTALL_CLI_TARBALL === undefined) {
    delete process.env.PP_INSTALL_CLI_TARBALL;
  } else {
    process.env.PP_INSTALL_CLI_TARBALL = ORIGINAL_PP_INSTALL_CLI_TARBALL;
  }
});

describe("test runner env", () => {
  test("strips ambient cli secrets while preserving harness variables", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    process.env.PP_RPC_URL = "https://poison.invalid/rpc";
    process.env.PP_ANVIL_SHARED_ENV_FILE = "/tmp/shared.env";
    process.env.PP_KEEP_COVERAGE_ROOT = "1";
    process.env.PP_INSTALL_CLI_TARBALL = "/tmp/stale-cli.tgz";

    const env = buildTestRunnerEnv();

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.PP_ANVIL_SHARED_ENV_FILE).toBe("/tmp/shared.env");
    expect(env.PP_KEEP_COVERAGE_ROOT).toBe("1");
    expect(env.PP_INSTALL_CLI_TARBALL).toBeUndefined();
  });

  test("overrides can restore or remove runner variables explicitly", () => {
    process.env.PP_KEEP_COVERAGE_ROOT = "1";

    const env = buildTestRunnerEnv({
      PP_TEST_RUN_ID: "abc123",
      PP_KEEP_COVERAGE_ROOT: undefined,
    });

    expect(env.PP_TEST_RUN_ID).toBe("abc123");
    expect(env.PP_KEEP_COVERAGE_ROOT).toBeUndefined();
  });
});
