import { afterEach, describe, expect, test } from "bun:test";
import { buildChildProcessEnv } from "../helpers/child-env.ts";

const ORIGINAL_PRIVATE_KEY = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const ORIGINAL_PP_RPC_URL = process.env.PP_RPC_URL;
const ORIGINAL_FORCE_COLOR = process.env.FORCE_COLOR;
const ORIGINAL_CLICOLOR_FORCE = process.env.CLICOLOR_FORCE;

describe("child process test env", () => {
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

    if (ORIGINAL_FORCE_COLOR === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = ORIGINAL_FORCE_COLOR;
    }

    if (ORIGINAL_CLICOLOR_FORCE === undefined) {
      delete process.env.CLICOLOR_FORCE;
    } else {
      process.env.CLICOLOR_FORCE = ORIGINAL_CLICOLOR_FORCE;
    }
  });

  test("strips inherited privacy-pools env vars unless explicitly overridden", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.PP_RPC_URL = "https://poison.invalid/rpc";

    const env = buildChildProcessEnv({
      PRIVACY_POOLS_HOME: "/tmp/privacy-pools-test-home",
    });

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.PRIVACY_POOLS_HOME).toBe("/tmp/privacy-pools-test-home");
    if (process.env.PATH !== undefined) {
      expect(env.PATH).toBe(process.env.PATH);
    }
  });

  test("removes inherited forced-color env vars", () => {
    process.env.FORCE_COLOR = "3";
    process.env.CLICOLOR_FORCE = "1";

    const env = buildChildProcessEnv();

    expect(env.FORCE_COLOR).toBeUndefined();
    expect(env.CLICOLOR_FORCE).toBeUndefined();
    expect(env.NODE_NO_WARNINGS).toBe("1");
  });
});
