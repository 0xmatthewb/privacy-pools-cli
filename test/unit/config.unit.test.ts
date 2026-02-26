import { describe, expect, test } from "bun:test";
import { getConfigDir, getRpcUrl } from "../../src/services/config.ts";

describe("config service", () => {
  test("returns built-in rpc defaults for supported chain ids", () => {
    expect(getRpcUrl(1)).toBe("https://eth.llamarpc.com");
    expect(getRpcUrl(42161)).toBe("https://arb1.arbitrum.io/rpc");
    expect(getRpcUrl(10)).toBe("https://mainnet.optimism.io");
    expect(getRpcUrl(11155111)).toBe("https://rpc.sepolia.org");
    expect(getRpcUrl(11155420)).toBe("https://sepolia.optimism.io");
  });

  test("respects rpc override flag", () => {
    const override = "https://example.invalid/rpc";
    expect(getRpcUrl(1, override)).toBe(override);
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
