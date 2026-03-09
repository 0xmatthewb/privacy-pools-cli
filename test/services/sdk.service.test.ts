import { describe, expect, test } from "bun:test";
import { getPublicClient, getDataService } from "../../src/services/sdk.ts";
import { CHAINS } from "../../src/config/chains.ts";
import type { Address } from "viem";

describe("sdk service", () => {
  const poolAddress = "0x0000000000000000000000000000000000000001" as Address;
  const poolInfo = {
    address: poolAddress,
    chainId: CHAINS.sepolia.id,
    scope: 1n,
    deploymentBlock: 123n,
  } as const;

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
      const ds = await getDataService(
        CHAINS.mainnet,
        poolAddress,
        "https://rpc.example.com"
      );
      expect(ds).toBeDefined();
      expect((ds as any).chainConfigs[0].startBlock).toBe(CHAINS.mainnet.startBlock);
    });

    test("uses chain startBlock from config", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "https://rpc.example.com"
      );
      expect(ds).toBeDefined();
      expect((ds as any).chainConfigs[0].startBlock).toBe(CHAINS.sepolia.startBlock);
    });

    test("uses local compatibility data service for localhost RPCs", async () => {
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

    test("local compatibility data service normalizes local event logs", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      (ds as any).client = {
        getLogs: async ({ event }: { event: { name: string } }) => {
          switch (event.name) {
            case "Deposited":
              return [{
                args: {
                  _depositor: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
                  _commitment: 11n,
                  _label: 22n,
                  _value: 33n,
                  _merkleRoot: 44n,
                },
                blockNumber: 55n,
                transactionHash:
                  "0x1111111111111111111111111111111111111111111111111111111111111111",
              }];
            case "Withdrawn":
              return [{
                args: {
                  _value: 0n,
                  _spentNullifier: 66n,
                  _newCommitment: 77n,
                },
                blockNumber: 88n,
                transactionHash:
                  "0x2222222222222222222222222222222222222222222222222222222222222222",
              }];
            case "Ragequit":
              return [{
                args: {
                  _ragequitter: "0xBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbBB",
                  _commitment: 99n,
                  _label: 111n,
                  _value: 0n,
                },
                blockNumber: 122n,
                transactionHash:
                  "0x3333333333333333333333333333333333333333333333333333333333333333",
              }];
            default:
              return [];
          }
        },
      };

      await expect((ds as any).getDeposits(poolInfo)).resolves.toEqual([{
        depositor: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        commitment: 11n,
        label: 22n,
        value: 33n,
        precommitment: 44n,
        blockNumber: 55n,
        transactionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      }]);

      await expect((ds as any).getWithdrawals(poolInfo)).resolves.toEqual([{
        withdrawn: 0n,
        spentNullifier: 66n,
        newCommitment: 77n,
        blockNumber: 88n,
        transactionHash:
          "0x2222222222222222222222222222222222222222222222222222222222222222",
      }]);

      await expect((ds as any).getRagequits(poolInfo)).resolves.toEqual([{
        ragequitter: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        commitment: 99n,
        label: 111n,
        value: 0n,
        blockNumber: 122n,
        transactionHash:
          "0x3333333333333333333333333333333333333333333333333333333333333333",
      }]);
    });

    test("local compatibility data service rejects malformed logs", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      (ds as any).client = {
        getLogs: async ({ event }: { event: { name: string } }) => {
          switch (event.name) {
            case "Deposited":
              return [{
                args: {
                  _depositor: "0x1111111111111111111111111111111111111111",
                  _label: 22n,
                  _value: 33n,
                  _merkleRoot: 44n,
                },
                blockNumber: 55n,
                transactionHash:
                  "0x4444444444444444444444444444444444444444444444444444444444444444",
              }];
            case "Withdrawn":
              return [{
                args: {
                  _value: 0n,
                  _spentNullifier: 66n,
                },
                blockNumber: 88n,
                transactionHash:
                  "0x5555555555555555555555555555555555555555555555555555555555555555",
              }];
            case "Ragequit":
              return [{
                args: {
                  _ragequitter: "0x2222222222222222222222222222222222222222",
                  _commitment: 99n,
                },
                blockNumber: 122n,
                transactionHash:
                  "0x6666666666666666666666666666666666666666666666666666666666666666",
              }];
            default:
              return [];
          }
        },
      };

      await expect((ds as any).getDeposits(poolInfo)).rejects.toThrow(
        "Malformed deposit log"
      );
      await expect((ds as any).getWithdrawals(poolInfo)).rejects.toThrow(
        "Malformed withdrawal log"
      );
      await expect((ds as any).getRagequits(poolInfo)).rejects.toThrow(
        "Malformed ragequit log"
      );
    });
  });
});
