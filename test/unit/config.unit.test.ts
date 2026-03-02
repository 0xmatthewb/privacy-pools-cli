import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getConfigDir,
  getRpcUrl,
  getRpcUrls,
  resolveRpcEnvVar,
  loadConfig,
  saveConfig,
  loadSignerKey,
} from "../../src/services/config.ts";
import { CLIError } from "../../src/utils/errors.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

const SAVED_HOME = process.env.PRIVACY_POOLS_HOME;

function isolatedHome(): string {
  return mkdtempSync(join(tmpdir(), "pp-cfg-test-"));
}

function restoreHome(): void {
  if (SAVED_HOME === undefined) delete process.env.PRIVACY_POOLS_HOME;
  else process.env.PRIVACY_POOLS_HOME = SAVED_HOME;
}

/** Write a config.json into temp dir and invalidate the singleton cache. */
function writeTestConfig(home: string, content: string): void {
  // saveConfig clears the internal _cachedConfig
  process.env.PRIVACY_POOLS_HOME = home;
  saveConfig({ defaultChain: "__flush__", rpcOverrides: {} });
  writeFileSync(join(home, "config.json"), content, "utf-8");
}

// ── existing tests ───────────────────────────────────────────────────────────

describe("config service", () => {
  afterEach(restoreHome);

  // Contract-pinned: These assert the exact built-in defaults.
  // Update these assertions when DEFAULT_RPC_URLS changes in src/services/config.ts.
  test("returns built-in rpc defaults for supported chain ids", () => {
    expect(getRpcUrl(1)).toBe("https://eth.llamarpc.com");
    expect(getRpcUrl(42161)).toBe("https://arbitrum.drpc.org");
    expect(getRpcUrl(10)).toBe("https://optimism.drpc.org");
    expect(getRpcUrl(11155111)).toBe("https://sepolia.drpc.org");
    expect(getRpcUrl(11155420)).toBe("https://optimism-sepolia.drpc.org");
  });

  test("respects rpc override flag", () => {
    const override = "https://example.invalid/rpc";
    expect(getRpcUrl(1, override)).toBe(override);
  });

  test("flag override takes precedence over env var", () => {
    const prev = process.env.PP_RPC_URL;
    try {
      process.env.PP_RPC_URL = "https://env.invalid/rpc";
      expect(getRpcUrl(1, "https://flag.invalid/rpc")).toBe("https://flag.invalid/rpc");
    } finally {
      if (prev === undefined) delete process.env.PP_RPC_URL;
      else process.env.PP_RPC_URL = prev;
    }
  });

  test("respects PP_RPC_URL env var as global override", () => {
    const prev = process.env.PP_RPC_URL;
    try {
      process.env.PP_RPC_URL = "https://global-env.invalid/rpc";
      expect(getRpcUrl(1)).toBe("https://global-env.invalid/rpc");
      expect(getRpcUrl(42161)).toBe("https://global-env.invalid/rpc");
    } finally {
      if (prev === undefined) delete process.env.PP_RPC_URL;
      else process.env.PP_RPC_URL = prev;
    }
  });

  test("respects per-chain PP_RPC_URL_<CHAIN> env var", () => {
    const prevChain = process.env.PP_RPC_URL_SEPOLIA;
    const prevGlobal = process.env.PP_RPC_URL;
    try {
      process.env.PP_RPC_URL_SEPOLIA = "https://sepolia-env.invalid/rpc";
      process.env.PP_RPC_URL = "https://global-env.invalid/rpc";
      // Chain-scoped env takes precedence over global env
      expect(getRpcUrl(11155111)).toBe("https://sepolia-env.invalid/rpc");
      // Other chains fall through to global
      expect(getRpcUrl(1)).toBe("https://global-env.invalid/rpc");
    } finally {
      if (prevChain === undefined) delete process.env.PP_RPC_URL_SEPOLIA;
      else process.env.PP_RPC_URL_SEPOLIA = prevChain;
      if (prevGlobal === undefined) delete process.env.PP_RPC_URL;
      else process.env.PP_RPC_URL = prevGlobal;
    }
  });

  test("throws for unsupported chain id", () => {
    expect(() => getRpcUrl(999999)).toThrow("No RPC URL configured for chain 999999");
  });

  test("respects PRIVACY_POOLS_HOME override for config directory", () => {
    const prev = process.env.PRIVACY_POOLS_HOME;
    try {
      process.env.PRIVACY_POOLS_HOME = "/tmp/privacy-pools-home-test";
      expect(getConfigDir()).toBe("/tmp/privacy-pools-home-test");
    } finally {
      if (prev === undefined) {
        delete process.env.PRIVACY_POOLS_HOME;
      } else {
        process.env.PRIVACY_POOLS_HOME = prev;
      }
    }
  });
});

// ── PRIVACY_POOLS_RPC_URL_* longer prefix env vars ───────────────────────────

describe("PRIVACY_POOLS_RPC_URL_* env vars", () => {
  afterEach(restoreHome);

  test("PRIVACY_POOLS_RPC_URL_ETHEREUM takes precedence for chain 1", () => {
    const prev = process.env.PRIVACY_POOLS_RPC_URL_ETHEREUM;
    try {
      process.env.PRIVACY_POOLS_RPC_URL_ETHEREUM = "https://long-prefix-eth.invalid/rpc";
      expect(resolveRpcEnvVar(1)).toBe("https://long-prefix-eth.invalid/rpc");
    } finally {
      if (prev === undefined) delete process.env.PRIVACY_POOLS_RPC_URL_ETHEREUM;
      else process.env.PRIVACY_POOLS_RPC_URL_ETHEREUM = prev;
    }
  });

  test("PRIVACY_POOLS_RPC_URL global env var works", () => {
    const prev = process.env.PRIVACY_POOLS_RPC_URL;
    try {
      process.env.PRIVACY_POOLS_RPC_URL = "https://long-prefix-global.invalid/rpc";
      expect(resolveRpcEnvVar(1)).toBe("https://long-prefix-global.invalid/rpc");
    } finally {
      if (prev === undefined) delete process.env.PRIVACY_POOLS_RPC_URL;
      else process.env.PRIVACY_POOLS_RPC_URL = prev;
    }
  });

  test("chain-scoped PRIVACY_POOLS_RPC_URL_SEPOLIA overrides global", () => {
    const prevChain = process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA;
    const prevGlobal = process.env.PRIVACY_POOLS_RPC_URL;
    try {
      process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA = "https://chain-scoped.invalid/rpc";
      process.env.PRIVACY_POOLS_RPC_URL = "https://global.invalid/rpc";
      expect(resolveRpcEnvVar(11155111)).toBe("https://chain-scoped.invalid/rpc");
      expect(resolveRpcEnvVar(1)).toBe("https://global.invalid/rpc");
    } finally {
      if (prevChain === undefined) delete process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA;
      else process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA = prevChain;
      if (prevGlobal === undefined) delete process.env.PRIVACY_POOLS_RPC_URL;
      else process.env.PRIVACY_POOLS_RPC_URL = prevGlobal;
    }
  });
});

// ── loadConfig JSON validation errors ────────────────────────────────────────

describe("loadConfig JSON validation errors", () => {
  afterEach(restoreHome);

  test("throws CLIError for non-JSON content", () => {
    const home = isolatedHome();
    writeTestConfig(home, "not json");
    expect(() => loadConfig()).toThrow(CLIError);
    expect(() => loadConfig()).toThrow("not valid JSON");
  });

  test("throws CLIError for null config", () => {
    const home = isolatedHome();
    writeTestConfig(home, "null");
    expect(() => loadConfig()).toThrow("invalid structure");
  });

  test("throws CLIError for array config", () => {
    const home = isolatedHome();
    writeTestConfig(home, "[]");
    expect(() => loadConfig()).toThrow("missing a valid defaultChain");
  });

  test("throws CLIError for missing defaultChain", () => {
    const home = isolatedHome();
    writeTestConfig(home, JSON.stringify({ rpcOverrides: {} }));
    expect(() => loadConfig()).toThrow("missing a valid defaultChain");
  });

  test("throws CLIError for empty string defaultChain", () => {
    const home = isolatedHome();
    writeTestConfig(home, JSON.stringify({ defaultChain: "", rpcOverrides: {} }));
    expect(() => loadConfig()).toThrow("missing a valid defaultChain");
  });

  test("throws CLIError for non-object rpcOverrides", () => {
    const home = isolatedHome();
    writeTestConfig(home, JSON.stringify({ defaultChain: "mainnet", rpcOverrides: "bad" }));
    expect(() => loadConfig()).toThrow("rpcOverrides must be an object");
  });

  test("throws CLIError for empty string rpc value", () => {
    const home = isolatedHome();
    writeTestConfig(home, JSON.stringify({ defaultChain: "mainnet", rpcOverrides: { "1": "" } }));
    expect(() => loadConfig()).toThrow("invalid value for chain key");
  });

  test("throws CLIError for non-integer chain key", () => {
    const home = isolatedHome();
    writeTestConfig(home, JSON.stringify({ defaultChain: "mainnet", rpcOverrides: { abc: "http://x" } }));
    expect(() => loadConfig()).toThrow("invalid chain key");
  });
});

// ── loadSignerKey precedence ─────────────────────────────────────────────────

describe("loadSignerKey precedence", () => {
  afterEach(restoreHome);

  test("env var PRIVACY_POOLS_PRIVATE_KEY takes precedence over file", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    // Ensure config dir exists so we can write the signer file
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    writeFileSync(join(home, ".signer"), "file_key", "utf-8");

    const prev = process.env.PRIVACY_POOLS_PRIVATE_KEY;
    try {
      process.env.PRIVACY_POOLS_PRIVATE_KEY = "env_key";
      expect(loadSignerKey()).toBe("env_key");
    } finally {
      if (prev === undefined) delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
      else process.env.PRIVACY_POOLS_PRIVATE_KEY = prev;
    }
  });

  test("falls back to file when env var absent", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    writeFileSync(join(home, ".signer"), "file_key", "utf-8");

    const prev = process.env.PRIVACY_POOLS_PRIVATE_KEY;
    try {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
      expect(loadSignerKey()).toBe("file_key");
    } finally {
      if (prev === undefined) delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
      else process.env.PRIVACY_POOLS_PRIVATE_KEY = prev;
    }
  });

  test("returns null when neither env nor file exists", () => {
    const home = isolatedHome();
    process.env.PRIVACY_POOLS_HOME = home;
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });

    const prev = process.env.PRIVACY_POOLS_PRIVATE_KEY;
    try {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
      expect(loadSignerKey()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
      else process.env.PRIVACY_POOLS_PRIVATE_KEY = prev;
    }
  });
});

// ── getRpcUrls multi-URL fallback ────────────────────────────────────────────

describe("getRpcUrls multi-URL fallback", () => {
  afterEach(restoreHome);

  test("returns multiple fallback URLs for chain 1 with no overrides", () => {
    const urls = getRpcUrls(1);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) {
      expect(url).toMatch(/^https?:\/\//);
    }
  });

  test("returns single-element array when flag override provided", () => {
    expect(getRpcUrls(1, "http://custom.invalid")).toEqual(["http://custom.invalid"]);
  });

  test("returns single-element array when env override provided", () => {
    const prev = process.env.PP_RPC_URL;
    try {
      process.env.PP_RPC_URL = "https://env-single.invalid/rpc";
      const urls = getRpcUrls(1);
      expect(urls).toEqual(["https://env-single.invalid/rpc"]);
    } finally {
      if (prev === undefined) delete process.env.PP_RPC_URL;
      else process.env.PP_RPC_URL = prev;
    }
  });
});
