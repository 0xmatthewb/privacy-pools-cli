import { afterEach, describe, expect, test } from "bun:test";
import {
  buildInstallBaseEnv,
  installCliEnv,
  npmProcessEnv,
} from "../../scripts/lib/install-verification.mjs";

const ORIGINAL_PRIVATE_KEY = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const ORIGINAL_PP_RPC_URL = process.env.PP_RPC_URL;
const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_TERM_SESSION_ID = process.env.TERM_SESSION_ID;
const ORIGINAL_ITERM_SESSION_ID = process.env.ITERM_SESSION_ID;

describe("install verification env hygiene", () => {
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

    if (ORIGINAL_PATH === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = ORIGINAL_PATH;
    }

    if (ORIGINAL_TERM_SESSION_ID === undefined) {
      delete process.env.TERM_SESSION_ID;
    } else {
      process.env.TERM_SESSION_ID = ORIGINAL_TERM_SESSION_ID;
    }

    if (ORIGINAL_ITERM_SESSION_ID === undefined) {
      delete process.env.ITERM_SESSION_ID;
    } else {
      process.env.ITERM_SESSION_ID = ORIGINAL_ITERM_SESSION_ID;
    }
  });

  test("strips privacy-pools env vars unless they are explicitly re-added", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.PP_RPC_URL = "https://poison.invalid/rpc";
    process.env.PATH = "/usr/bin";

    const env = buildInstallBaseEnv(process.env, {
      PRIVACY_POOLS_HOME: "/tmp/privacy-pools-test-home",
    });

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.PRIVACY_POOLS_HOME).toBe("/tmp/privacy-pools-test-home");
    expect(env.PATH).toBe("/usr/bin");
  });

  test("npmProcessEnv uses the stripped install env as its base", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.PP_RPC_URL = "https://poison.invalid/rpc";

    const env = npmProcessEnv("/tmp/privacy-pools-test-state");

    expect(env.PRIVACY_POOLS_PRIVATE_KEY).toBeUndefined();
    expect(env.PP_RPC_URL).toBeUndefined();
    expect(env.npm_config_cache).toBe("/tmp/privacy-pools-test-state/.npm-cache");
    expect(env.npm_config_userconfig).toBe("/tmp/privacy-pools-test-state/.npmrc");
  });

  test("installCliEnv removes interactive session markers for deterministic bare welcome checks", () => {
    process.env.TERM_SESSION_ID = "interactive-term";
    process.env.ITERM_SESSION_ID = "interactive-iterm";

    const env = installCliEnv("/tmp/privacy-pools-test-home");

    expect(env.PP_NO_UPDATE_CHECK).toBe("1");
    expect(env.NO_COLOR).toBe("1");
    expect(env.PRIVACY_POOLS_HOME).toBe("/tmp/privacy-pools-test-home");
    expect(env.TERM_SESSION_ID).toBeUndefined();
    expect(env.ITERM_SESSION_ID).toBeUndefined();
  });
});
