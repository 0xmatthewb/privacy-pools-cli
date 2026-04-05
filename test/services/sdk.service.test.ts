import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  getPublicClient,
  getDataService,
  getHealthyRpcUrl,
  getReadOnlyRpcSession,
  resetSdkServiceCachesForTests,
} from "../../src/services/sdk.ts";
import { CHAINS } from "../../src/config/chains.ts";
import { getRpcUrls } from "../../src/services/config.ts";
import type { Address } from "viem";

describe("sdk service", () => {
  const poolAddress = "0x0000000000000000000000000000000000000001" as Address;
  const originalFetch = globalThis.fetch;
  const poolInfo = {
    address: poolAddress,
    chainId: CHAINS.sepolia.id,
    scope: 1n,
    deploymentBlock: 123n,
  } as const;

  function rpcSuccess(result: unknown): Response {
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  function rpcError(message: string): Response {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSdkServiceCachesForTests();
    mock.restore();
  });

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
  /*  getReadOnlyRpcSession                                            */
  /* ---------------------------------------------------------------- */

  describe("getReadOnlyRpcSession", () => {
    test("reuses a read-only session for the same chain and healthy rpc url", async () => {
      const first = await getReadOnlyRpcSession(
        CHAINS.mainnet,
        "https://rpc.example.com",
      );
      const second = await getReadOnlyRpcSession(
        CHAINS.mainnet,
        "https://rpc.example.com",
      );

      expect(first).toBe(second);
      expect(first.rpcUrl).toBe("https://rpc.example.com");
      expect(first.publicClient.chain?.id).toBe(1);
    });

    test("dedupes latest block reads within the short-lived session window", async () => {
      const session = await getReadOnlyRpcSession(
        CHAINS.mainnet,
        "https://rpc.example.com",
      );
      const getBlockNumberMock = mock(async () => 123n);
      (session.publicClient as any).getBlockNumber = getBlockNumberMock;

      const [first, second] = await Promise.all([
        session.getLatestBlockNumber(),
        session.getLatestBlockNumber(),
      ]);

      expect(first).toBe(123n);
      expect(second).toBe(123n);
      expect(getBlockNumberMock).toHaveBeenCalledTimes(1);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  getHealthyRpcUrl                                                 */
  /* ---------------------------------------------------------------- */

  describe("getHealthyRpcUrl", () => {
    test("skips probes when a single rpc override is provided", async () => {
      const fetchMock = mock(async () => rpcSuccess("0x1"));
      globalThis.fetch = fetchMock as typeof fetch;

      const url = await getHealthyRpcUrl(CHAINS.mainnet.id, "https://custom-rpc.example.com");

      expect(url).toBe("https://custom-rpc.example.com");
      expect(fetchMock).toHaveBeenCalledTimes(0);
    });

    test("returns the first url when block and log probes both succeed", async () => {
      const urls = getRpcUrls(CHAINS.mainnet.id);
      const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") return rpcSuccess("0x1000");
        if (body.method === "eth_getLogs") return rpcSuccess([]);
        throw new Error(`unexpected method ${body.method}`);
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const url = await getHealthyRpcUrl(CHAINS.mainnet.id);

      expect(url).toBe(urls[0]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("skips urls that fail the log probe and picks the next healthy fallback", async () => {
      const urls = getRpcUrls(CHAINS.mainnet.id);
      const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as { method: string };

        if (url === urls[0] && body.method === "eth_blockNumber") {
          return rpcSuccess("0x1000");
        }
        if (url === urls[0] && body.method === "eth_getLogs") {
          return rpcError("rate limited");
        }
        if (url === urls[1] && body.method === "eth_blockNumber") {
          return rpcSuccess("0x1000");
        }
        if (url === urls[1] && body.method === "eth_getLogs") {
          return rpcSuccess([]);
        }

        throw new Error(`unexpected probe ${body.method} for ${url}`);
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const url = await getHealthyRpcUrl(CHAINS.mainnet.id);

      expect(url).toBe(urls[1]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    test("treats non-array eth_getLogs responses as unhealthy and skips to the next fallback", async () => {
      const urls = getRpcUrls(CHAINS.mainnet.id);
      const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as { method: string };

        if (url === urls[0] && body.method === "eth_blockNumber") {
          return rpcSuccess("0x1000");
        }
        if (url === urls[0] && body.method === "eth_getLogs") {
          return rpcSuccess(null);
        }
        if (url === urls[1] && body.method === "eth_blockNumber") {
          return rpcSuccess("0x1000");
        }
        if (url === urls[1] && body.method === "eth_getLogs") {
          return rpcSuccess([]);
        }

        throw new Error(`unexpected probe ${body.method} for ${url}`);
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const url = await getHealthyRpcUrl(CHAINS.mainnet.id);

      expect(url).toBe(urls[1]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    test("falls back to the first url when every probe fails", async () => {
      const urls = getRpcUrls(CHAINS.mainnet.id);
      const fetchMock = mock(async () => new Response(null, { status: 500 }));
      globalThis.fetch = fetchMock as typeof fetch;

      const url = await getHealthyRpcUrl(CHAINS.mainnet.id);

      expect(url).toBe(urls[0]);
      expect(fetchMock).toHaveBeenCalledTimes(urls.length);
    });

    test("memoizes successful probe results per chain and override", async () => {
      const urls = getRpcUrls(CHAINS.mainnet.id);
      const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") return rpcSuccess("0x1000");
        if (body.method === "eth_getLogs") return rpcSuccess([]);
        throw new Error(`unexpected method ${body.method}`);
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const first = await getHealthyRpcUrl(CHAINS.mainnet.id);
      const second = await getHealthyRpcUrl(CHAINS.mainnet.id);

      expect(first).toBe(urls[0]);
      expect(second).toBe(urls[0]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    test("does not share memoized healthy RPC results across override keys", async () => {
      const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method: string };
        if (body.method === "eth_blockNumber") return rpcSuccess("0x1000");
        if (body.method === "eth_getLogs") return rpcSuccess([]);
        throw new Error(`unexpected method ${body.method}`);
      });
      globalThis.fetch = fetchMock as typeof fetch;

      const base = await getHealthyRpcUrl(CHAINS.mainnet.id);
      const override = await getHealthyRpcUrl(CHAINS.mainnet.id, "https://rpc.example.com");

      expect(base).toBe(getRpcUrls(CHAINS.mainnet.id)[0]);
      expect(override).toBe("https://rpc.example.com");
      expect(fetchMock).toHaveBeenCalledTimes(2);
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

    test("prefers an internal event-scan RPC when no explicit override exists", async () => {
      const chainWithEventScan = {
        ...CHAINS.mainnet,
        eventScanRpcUrl: "https://events.example.com",
      };

      const ds = await getDataService(
        chainWithEventScan,
        poolAddress,
      );

      expect((ds as any).chainConfigs[0].rpcUrl).toBe("https://events.example.com");
    });

    test("explicit overrides beat the internal event-scan RPC path", async () => {
      const chainWithEventScan = {
        ...CHAINS.mainnet,
        eventScanRpcUrl: "https://events.example.com",
      };

      const ds = await getDataService(
        chainWithEventScan,
        poolAddress,
        "https://rpc.example.com",
      );

      expect((ds as any).chainConfigs[0].rpcUrl).toBe("https://rpc.example.com");
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

    test("reuses remote DataService instances for the same chain and RPC", async () => {
      const ds1 = await getDataService(
        CHAINS.mainnet,
        poolAddress,
        "https://rpc.example.com"
      );
      const ds2 = await getDataService(
        CHAINS.mainnet,
        poolAddress,
        "https://rpc.example.com"
      );

      expect(ds1).toBe(ds2);
    });

    test("reuses remote DataService instances across pool addresses on the same chain", async () => {
      const ds1 = await getDataService(
        CHAINS.mainnet,
        poolAddress,
        "https://rpc.example.com"
      );
      const ds2 = await getDataService(
        CHAINS.mainnet,
        "0x0000000000000000000000000000000000000002" as Address,
        "https://rpc.example.com"
      );

      expect(ds1).toBe(ds2);
    });

    test("reuses local compatibility data service instances for the same chain and RPC", async () => {
      const ds1 = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );
      const ds2 = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      expect(ds1).toBe(ds2);
    });

    test("reuses local compatibility data service instances across pool addresses on the same chain", async () => {
      const ds1 = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );
      const ds2 = await getDataService(
        CHAINS.sepolia,
        "0x0000000000000000000000000000000000000002" as Address,
        "http://127.0.0.1:8545"
      );

      expect(ds1).toBe(ds2);
    });

    test("applies website-aligned log fetch config for mainnet", async () => {
      const ds = await getDataService(
        CHAINS.mainnet,
        poolAddress,
        "https://rpc.example.com"
      );

      expect((ds as any).logFetchConfigs.get(1)).toMatchObject({
        blockChunkSize: 1_250_000,
        concurrency: 1,
        chunkDelayMs: 0,
        retryOnFailure: true,
        maxRetries: 3,
        retryBaseDelayMs: 500,
      });
    });

    test("applies website-aligned log fetch config for optimism and arbitrum only", async () => {
      const opDs = await getDataService(
        CHAINS.optimism,
        poolAddress,
        "https://rpc.example.com"
      );
      const arbDs = await getDataService(
        CHAINS.arbitrum,
        poolAddress,
        "https://arb-rpc.example.com"
      );
      const sepoliaDs = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "https://sepolia-rpc.example.com"
      );

      expect((opDs as any).logFetchConfigs.get(10)).toMatchObject({
        blockChunkSize: 12_000_000,
        concurrency: 1,
        retryBaseDelayMs: 500,
      });
      expect((arbDs as any).logFetchConfigs.get(42161)).toMatchObject({
        blockChunkSize: 48_000_000,
        concurrency: 1,
        retryBaseDelayMs: 500,
      });
      expect((sepoliaDs as any).logFetchConfigs.get(11155111)).toMatchObject({
        blockChunkSize: 10_000,
        concurrency: 3,
        retryBaseDelayMs: 1000,
      });
    });

    test("local compatibility data service normalizes local event logs", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      (ds as any).client = {
        getBlockNumber: async () => 1_000n,
        getLogs: async ({ event }: { event: { name: string } }) => {
          switch (event.name) {
            case "Deposited":
              return [{
                args: {
                  _depositor: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
                  _commitment: 11n,
                  _label: 22n,
                  _value: 33n,
                  _precommitmentHash: 44n,
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

    test("local compatibility data service returns no logs when deployment block is still in the future", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      let called = false;
      (ds as any).client = {
        getBlockNumber: async () => 12n,
        getLogs: async () => {
          called = true;
          return [];
        },
      };

      await expect((ds as any).getDeposits(poolInfo)).resolves.toEqual([]);

      expect(called).toBe(false);
    });

    test("local compatibility data service reuses the latest block height across adjacent reads", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545",
      );

      const getBlockNumberMock = mock(async () => 1_000n);
      (ds as any).client = {
        getBlockNumber: getBlockNumberMock,
        getLogs: async () => [],
      };

      await Promise.all([
        (ds as any).getDeposits(poolInfo),
        (ds as any).getWithdrawals(poolInfo),
        (ds as any).getRagequits(poolInfo),
      ]);

      expect(getBlockNumberMock).toHaveBeenCalledTimes(1);
    });

    test("local compatibility data service accepts zero-valued uint256 event fields", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      (ds as any).client = {
        getBlockNumber: async () => 1_000n,
        getLogs: async ({ event }: { event: { name: string } }) => {
          switch (event.name) {
            case "Deposited":
              return [{
                args: {
                  _depositor: "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa",
                  _commitment: 0n,
                  _label: 0n,
                  _value: 33n,
                  _precommitmentHash: 44n,
                },
                blockNumber: 55n,
                transactionHash:
                  "0x7777777777777777777777777777777777777777777777777777777777777777",
              }];
            case "Withdrawn":
              return [{
                args: {
                  _value: 12n,
                  _spentNullifier: 0n,
                  _newCommitment: 0n,
                },
                blockNumber: 88n,
                transactionHash:
                  "0x8888888888888888888888888888888888888888888888888888888888888888",
              }];
            case "Ragequit":
              return [{
                args: {
                  _ragequitter: "0xBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbBB",
                  _commitment: 0n,
                  _label: 0n,
                  _value: 0n,
                },
                blockNumber: 122n,
                transactionHash:
                  "0x9999999999999999999999999999999999999999999999999999999999999999",
              }];
            default:
              return [];
          }
        },
      };

      await expect((ds as any).getDeposits(poolInfo)).resolves.toEqual([
        expect.objectContaining({
          commitment: 0n,
          label: 0n,
        }),
      ]);
      await expect((ds as any).getWithdrawals(poolInfo)).resolves.toEqual([
        expect.objectContaining({
          spentNullifier: 0n,
          newCommitment: 0n,
        }),
      ]);
      await expect((ds as any).getRagequits(poolInfo)).resolves.toEqual([
        expect.objectContaining({
          commitment: 0n,
          label: 0n,
        }),
      ]);
    });

    test("local compatibility data service rejects malformed logs", async () => {
      const ds = await getDataService(
        CHAINS.sepolia,
        poolAddress,
        "http://127.0.0.1:8545"
      );

      (ds as any).client = {
        getBlockNumber: async () => 1_000n,
        getLogs: async ({ event }: { event: { name: string } }) => {
          switch (event.name) {
            case "Deposited":
              return [{
                args: {
                  _depositor: "0x1111111111111111111111111111111111111111",
                  _label: 22n,
                  _value: 33n,
                  _precommitmentHash: 44n,
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
