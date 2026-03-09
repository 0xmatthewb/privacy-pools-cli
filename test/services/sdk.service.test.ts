import { describe, expect, test } from "bun:test";
import { getPublicClient, getDataService } from "../../src/services/sdk.ts";
import { CHAINS } from "../../src/config/chains.ts";
import type { Address } from "viem";

describe("sdk service", () => {
  /* ---------------------------------------------------------------- */
  /*  getPublicClient                                                  */
  /* ---------------------------------------------------------------- */

  describe("getPublicClient", () => {
    test("returns a PublicClient with the correct chain", () => {
      const client = getPublicClient(CHAINS.mainnet);
      expect(client).toBeDefined();
      expect(client.chain?.id).toBe(1);
    });

    test("respects rpcOverride as single transport", () => {
      const client = getPublicClient(CHAINS.mainnet, "https://custom-rpc.example.com");
      expect(client).toBeDefined();
      expect(client.chain?.id).toBe(1);
    });

    test("returns client for different chain configs", () => {
      const sepoliaClient = getPublicClient(CHAINS.sepolia);
      expect(sepoliaClient.chain?.id).toBe(11155111);

      const arbClient = getPublicClient(CHAINS.arbitrum);
      expect(arbClient.chain?.id).toBe(42161);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getDataService                                                   */
  /* ---------------------------------------------------------------- */

  describe("getDataService", () => {
    test("returns a DataService instance with correct config", async () => {
      const poolAddress = "0x0000000000000000000000000000000000000001" as Address;
      const ds = await getDataService(
        CHAINS.mainnet,
        poolAddress,
        "https://rpc.example.com"
      );
      expect(ds).toBeDefined();
      expect((ds as any).chainConfigs[0].startBlock).toBe(CHAINS.mainnet.startBlock);
    });

    test("uses chain startBlock from config", async () => {
      const poolAddress = "0x0000000000000000000000000000000000000001" as Address;
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "https://rpc.example.com"
      );
      expect(ds).toBeDefined();
      expect((ds as any).chainConfigs[0].startBlock).toBe(CHAINS.sepolia.startBlock);
    });

    test("uses local compatibility data service for localhost RPCs", async () => {
      const poolAddress = "0x0000000000000000000000000000000000000001" as Address;
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      expect(typeof (ds as any).getDeposits).toBe("function");
      expect(typeof (ds as any).getWithdrawals).toBe("function");
      expect(typeof (ds as any).getRagequits).toBe("function");
      expect((ds as any).logFetchConfigs).toBeUndefined();
    });
  });
});
