import { describe, expect, test } from "bun:test";
import { getConfigDir, getRpcUrl } from "../../src/services/config.ts";

describe("config service", () => {
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
