import { describe, expect, test } from "bun:test";
import {
  lookupPoolDeploymentBlock,
  resolvePoolDeploymentBlock,
} from "../../src/config/deployment-hints.ts";
import { poolToJson } from "../../src/output/pools.ts";

describe("deployment hints", () => {
  test("matches asset and pool addresses case-insensitively", () => {
    expect(
      lookupPoolDeploymentBlock(
        11155111,
        "0x1C7D4B196CB0C7B01D743FBC6116A902379C7238",
      ),
    ).toBe(8587064n);

    expect(
      lookupPoolDeploymentBlock(
        11155111,
        "0x0B062FE33C4F1592D8EA63F9A0177FCA44374C0F",
      ),
    ).toBe(8587064n);
  });

  test("falls back to the chain start block when no hint exists", () => {
    expect(
      resolvePoolDeploymentBlock(
        11155111,
        8461450n,
        "0x9999999999999999999999999999999999999999",
      ),
    ).toBe(8461450n);
  });

  test("pool JSON output omits internal deploymentBlock hints", () => {
    const payload = poolToJson({
      asset: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
      pool: "0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f",
      deploymentBlock: 8587064n,
      scope: 12345n,
      symbol: "USDC",
      decimals: 6,
      minimumDepositAmount: 1n,
      vettingFeeBPS: 50n,
      maxRelayFeeBPS: 250n,
    });

    expect(payload).not.toHaveProperty("deploymentBlock");
  });
});
