import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";
import {
  CHAINS,
  KNOWN_POOLS,
  NATIVE_ASSET_ADDRESS,
} from "../../src/config/chains.ts";
import { lookupPoolDeploymentBlock } from "../../src/config/deployment-hints.ts";
import { overrideAspRetryWaitForTests } from "../../src/services/asp.ts";
import { DEFAULT_RPC_URLS } from "../../src/services/config.ts";
import {
  getReadOnlyRpcSession,
  overrideSdkTransportRetryForTests,
  resetSdkServiceCachesForTests,
} from "../../src/services/sdk.ts";
import {
  listKnownPoolsFromRegistry,
  listPools,
  resetPoolsServiceCachesForTests,
  resolvePool,
} from "../../src/services/pools.ts";

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

async function startMockServer(chainId: number, statsPayload: unknown): Promise<MockServer> {
  return startMockServerWithConfig(chainId, statsPayload, {});
}

async function startMockServerWithConfig(
  chainId: number,
  statsPayload: unknown,
  config: {
    entrypoint?: Address;
    pool?: Address;
    asset?: Address;
    scope?: bigint;
    symbol?: string;
    decimals?: number;
  }
): Promise<MockServer> {
  const entrypoint = config.entrypoint ?? "0x00000000000000000000000000000000000000e1" as Address;
  const pool = config.pool ?? "0x00000000000000000000000000000000000000a1" as Address;
  const asset = config.asset ?? "0x00000000000000000000000000000000000000b1" as Address;
  const scope = config.scope ?? 123456789n;
  const symbol = config.symbol ?? "ETHX";
  const decimals = config.decimals ?? 18;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";

    if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statsPayload));
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const json = JSON.parse(body);
        const call = json?.params?.[0] ?? {};
        const to = String(call.to ?? "").toLowerCase();
        const data = String(call.data ?? "").toLowerCase();

        let result = "0x";

        if (to === entrypoint.toLowerCase() && data.startsWith("0xd6dbaf58")) {
          result = encodeAbiParameters(
            [
              { type: "address" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint256" },
            ],
            [pool, 1000000000000000n, 50n, 250n]
          );
        } else if (to === pool.toLowerCase()) {
          result = encodeAbiParameters([{ type: "uint256" }], [scope]);
        } else if (to === asset.toLowerCase() && data.startsWith("0x95d89b41")) {
          result = encodeAbiParameters([{ type: "string" }], [symbol]);
        } else if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
          result = encodeAbiParameters([{ type: "uint8" }], [decimals]);
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: json.id,
            result,
          })
        );
      });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addressInfo = server.address();
  if (!addressInfo || typeof addressInfo === "string") {
    throw new Error("Failed to bind mock server");
  }

  return {
    url: `http://127.0.0.1:${addressInfo.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

describe("pools service", () => {
  const toClose: MockServer[] = [];
  const originalSepoliaRpc = process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA;

  beforeEach(() => {
    overrideAspRetryWaitForTests(async () => {});
    overrideSdkTransportRetryForTests({ retryCount: 0 });
    resetSdkServiceCachesForTests();
    resetPoolsServiceCachesForTests();
  });

  afterEach(async () => {
    overrideAspRetryWaitForTests();
    overrideSdkTransportRetryForTests();
    resetSdkServiceCachesForTests();
    resetPoolsServiceCachesForTests();
    if (originalSepoliaRpc === undefined) {
      delete process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA;
    } else {
      process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA = originalSepoliaRpc;
    }
    while (toClose.length > 0) {
      await toClose.pop()!.close();
    }
  });

  test("listPools parses object payload shape with tokenAddress", async () => {
    const chainId = 31337;
    const server = await startMockServer(chainId, {
      pools: [
        {
          tokenAddress: "0x00000000000000000000000000000000000000b1",
          totalInPoolValue: "90000000000000000000",
          acceptedDepositsValue: "88000000000000000000",
          pendingDepositsValue: "2000000000000000000",
          totalDepositsValue: "100000000000000000000",
          totalDepositsCount: 42,
          acceptedDepositsCount: 38,
          pendingDepositsCount: 4,
          growth24h: 2.5,
        },
      ],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools.length).toBe(1);
    expect(pools[0].symbol).toBe("ETHX");
    expect(pools[0].minimumDepositAmount).toBe(1000000000000000n);
    expect(pools[0].totalInPoolValue).toBe(90000000000000000000n);
    expect(pools[0].acceptedDepositsValue).toBe(88000000000000000000n);
    expect(pools[0].pendingDepositsValue).toBe(2000000000000000000n);
    expect(pools[0].totalDepositsValue).toBe(100000000000000000000n);
    expect(pools[0].totalDepositsCount).toBe(42);
    expect(pools[0].acceptedDepositsCount).toBe(38);
    expect(pools[0].pendingDepositsCount).toBe(4);
    expect(pools[0].growth24h).toBe(2.5);
  });

  test("listPools also supports legacy assetAddress payload shape", async () => {
    const chainId = 31338;
    const server = await startMockServer(chainId, [
      {
        assetAddress: "0x00000000000000000000000000000000000000b1",
      },
    ]);
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools.length).toBe(1);
    expect(pools[0].scope).toBe(123456789n);
  });

  test("listPools trims padded asset addresses before validating them", async () => {
    const chainId = 313381;
    const server = await startMockServer(chainId, {
      pools: [
        {
          tokenAddress: "  0x00000000000000000000000000000000000000b1  ",
        },
      ],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools).toHaveLength(1);
    expect(pools[0].asset).toBe("0x00000000000000000000000000000000000000b1");
  });

  test("listPools keeps deployment hints for known pools on local rpc", async () => {
    const chainId = CHAINS.sepolia.id;
    const asset = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Address;
    const pool = "0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f" as Address;
    const server = await startMockServerWithConfig(
      chainId,
      {
        pools: [{ tokenAddress: asset }],
      },
      {
        entrypoint: CHAINS.sepolia.entrypoint,
        asset,
        pool,
        scope: 987654321n,
        symbol: "USDC",
        decimals: 6,
      }
    );
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.sepolia,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    const deploymentHint = lookupPoolDeploymentBlock(chainId, asset, pool);
    expect(pools).toHaveLength(1);
    expect(pools[0].symbol).toBe("USDC");
    expect(deploymentHint).toBeDefined();
    expect(pools[0].deploymentBlock).toBe(deploymentHint);
  });

  test("listPools supports scope-keyed object payload shape", async () => {
    const chainId = 31339;
    const server = await startMockServer(chainId, {
      "123456789": {
        tokenAddress: "0x00000000000000000000000000000000000000b1",
        totalDepositsCount: 7,
      },
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools.length).toBe(1);
    expect(pools[0].totalDepositsCount).toBe(7);
  });

  test("listPools throws when ASP returns HTTP 500", async () => {
    const chainId = 31340;
    const server = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const url = `http://127.0.0.1:${addr.port}`;
    const closer: MockServer = { url, close: () => new Promise<void>((r, j) => server.close((e) => e ? j(e) : r())) };
    toClose.push(closer);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: url,
    };

    await expect(listPools(chainConfig, url)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("network connection"),
    });
  });

  test("listPools throws RPC_POOL_RESOLUTION_FAILED when ASP returns pools but all onchain reads fail", async () => {
    const chainId = 31342;
    const aspStatsUrl = `/${chainId}/public/pools-stats`;
    const statsPayload = { pools: [{ tokenAddress: "0x00000000000000000000000000000000000000b1" }] };
    const savedFetch = globalThis.fetch;

    // Mock fetch: serve ASP stats, reject all other (RPC) requests
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes(aspStatsUrl)) {
        return new Response(JSON.stringify(statsPayload), { status: 200 });
      }
      // RPC calls → network-level failure that isRpcLikeError recognizes
      throw new Error("fetch failed: ECONNREFUSED");
    }) as typeof fetch;

    try {
      const chainConfig = {
        ...CHAINS.mainnet,
        id: chainId,
        entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
        aspHost: "http://127.0.0.1:1",
      };

      await expect(listPools(chainConfig, "http://127.0.0.1:1")).rejects.toMatchObject({
        category: "RPC",
        code: "RPC_POOL_RESOLUTION_FAILED",
        retryable: true,
      });
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test("listPools returns empty array for empty pools payload", async () => {
    const chainId = 31341;
    const server = await startMockServer(chainId, { pools: [] });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools.length).toBe(0);
  });

  test("listPools deduplicates entries with the same pool address and keeps the first result", async () => {
    const chainId = 31343;
    const server = await startMockServer(chainId, {
      pools: [
        {
          tokenAddress: "0x00000000000000000000000000000000000000b1",
          totalDepositsCount: 10,
        },
        {
          tokenAddress: "0x00000000000000000000000000000000000000b1",
          totalDepositsCount: 20,
        },
      ],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools).toHaveLength(1);
    expect(pools[0]?.totalDepositsCount).toBe(10);
  });

  test("listPools ignores malformed asset addresses and parses numeric metric variants", async () => {
    const chainId = 31345;
    const server = await startMockServer(chainId, {
      pools: [
        {
          tokenAddress: "not-an-address",
          totalDepositsCount: "99",
        },
        {
          tokenAddress: "0x00000000000000000000000000000000000000b1",
          totalInPoolValue: 90000000000000000000,
          totalDepositsCount: "7",
          acceptedDepositsCount: 5,
          growth24h: "2.5",
          pendingGrowth24h: null,
        },
      ],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools).toHaveLength(1);
    expect(pools[0]?.totalInPoolValue).toBe(90000000000000000000n);
    expect(pools[0]?.totalDepositsCount).toBe(7);
    expect(pools[0]?.acceptedDepositsCount).toBe(5);
    expect(pools[0]?.growth24h).toBe(2.5);
    expect(pools[0]?.pendingGrowth24h).toBeUndefined();
  });

  test("listPools returns an empty list when the ASP payload is not an array or object", async () => {
    const chainId = 31346;
    const server = await startMockServer(chainId, 42);
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    await expect(listPools(chainConfig, server.url)).resolves.toEqual([]);
  });

  test("listPools reuses resolved onchain pool metadata across repeated reads", async () => {
    const chainId = 313390;
    let assetConfigCalls = 0;
    let scopeCalls = 0;
    let symbolCalls = 0;
    let decimalsCalls = 0;
    const server = await startMockServerWithConfig(
      chainId,
      { pools: [{ tokenAddress: "0x00000000000000000000000000000000000000b1" }] },
      {
        entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
        pool: "0x00000000000000000000000000000000000000a1" as Address,
        asset: "0x00000000000000000000000000000000000000b1" as Address,
      },
    );
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const requestUrl =
        input instanceof Request ? input.url : String(input);
      if (!requestUrl.startsWith(server.url) || init?.method !== "POST") {
        return originalFetch(input, init);
      }

      const body = JSON.parse(String(init.body)) as {
        params?: Array<{ data?: string }>;
      };
      const data = String(body.params?.[0]?.data ?? "").toLowerCase();
      if (data.startsWith("0xd6dbaf58")) assetConfigCalls++;
      if (data.startsWith("0x33d09200")) scopeCalls++;
      if (data.startsWith("0x95d89b41")) symbolCalls++;
      if (data.startsWith("0x313ce567")) decimalsCalls++;
      return originalFetch(input, init);
    };

    try {
      const first = await listPools(chainConfig, server.url);
      const second = await listPools(chainConfig, server.url);

      expect(first).toHaveLength(1);
      expect(second).toEqual(first);
      expect(assetConfigCalls).toBe(1);
      expect(scopeCalls).toBe(1);
      expect(symbolCalls).toBe(1);
      expect(decimalsCalls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("listPools uses multicall for supported read-only pool metadata", async () => {
    const chainId = 313391;
    const asset = "0x00000000000000000000000000000000000000b1" as Address;
    const pool = "0x00000000000000000000000000000000000000a1" as Address;
    const server = await startMockServer(chainId, {
      pools: [{ tokenAddress: asset }],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      multicall3Address: "0xca11bde05977b3631167028862be2a173976ca11" as Address,
      aspHost: server.url,
    };

    const rpcSession = await getReadOnlyRpcSession(chainConfig, server.url);
    const multicallMock = mock(async () => [
      [pool, 1000000000000000n, 50n, 250n],
      "ETHX",
      18,
    ]);
    const readContractMock = mock(async ({ functionName }: { functionName: string }) => {
      if (functionName === "SCOPE") {
        return 123456789n;
      }

      throw new Error(`unexpected direct read ${functionName}`);
    });
    (rpcSession.publicClient as any).multicall = multicallMock;
    (rpcSession.publicClient as any).readContract = readContractMock;

    const pools = await listPools(chainConfig, server.url);

    expect(pools).toHaveLength(1);
    expect(pools[0]?.pool).toBe(pool);
    expect(pools[0]?.symbol).toBe("ETHX");
    expect(multicallMock).toHaveBeenCalledTimes(1);
    expect(readContractMock).toHaveBeenCalledTimes(1);
  });

  test("listPools falls back to direct reads when multicall fails", async () => {
    const chainId = 313392;
    const asset = "0x00000000000000000000000000000000000000b1" as Address;
    const pool = "0x00000000000000000000000000000000000000a1" as Address;
    const server = await startMockServer(chainId, {
      pools: [{ tokenAddress: asset }],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      multicall3Address: "0xca11bde05977b3631167028862be2a173976ca11" as Address,
      aspHost: server.url,
    };

    const rpcSession = await getReadOnlyRpcSession(chainConfig, server.url);
    const multicallMock = mock(async () => {
      throw new Error("multicall unavailable");
    });
    const readContractMock = mock(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "assetConfig":
          return [pool, 1000000000000000n, 50n, 250n];
        case "symbol":
          return "ETHX";
        case "decimals":
          return 18;
        case "SCOPE":
          return 123456789n;
        default:
          throw new Error(`unexpected direct read ${functionName}`);
      }
    });
    (rpcSession.publicClient as any).multicall = multicallMock;
    (rpcSession.publicClient as any).readContract = readContractMock;

    const pools = await listPools(chainConfig, server.url);

    expect(pools).toHaveLength(1);
    expect(pools[0]?.pool).toBe(pool);
    expect(multicallMock).toHaveBeenCalledTimes(1);
    expect(readContractMock).toHaveBeenCalledTimes(4);
  });

  test("listPools disables multicall for later entries after the first failure", async () => {
    const chainId = 3133921;
    const assetOne = "0x00000000000000000000000000000000000000b1" as Address;
    const assetTwo = "0x00000000000000000000000000000000000000b2" as Address;
    const poolOne = "0x00000000000000000000000000000000000000a1" as Address;
    const poolTwo = "0x00000000000000000000000000000000000000a2" as Address;
    const server = await startMockServer(chainId, {
      pools: [{ tokenAddress: assetOne }, { tokenAddress: assetTwo }],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      multicall3Address: "0xca11bde05977b3631167028862be2a173976ca11" as Address,
      aspHost: server.url,
    };

    const rpcSession = await getReadOnlyRpcSession(chainConfig, server.url);
    const multicallMock = mock(async () => {
      throw new Error("multicall unavailable");
    });
    const readContractMock = mock(async (
      {
        functionName,
        address,
        args,
      }: {
        functionName: string;
        address: Address;
        args?: readonly unknown[];
      },
    ) => {
      switch (functionName) {
        case "assetConfig":
          if (args?.[0] === assetOne) return [poolOne, 1000000000000000n, 50n, 250n];
          if (args?.[0] === assetTwo) return [poolTwo, 1000000000000000n, 50n, 250n];
          break;
        case "symbol":
          if (address === assetOne) return "ETHX";
          if (address === assetTwo) return "USDX";
          break;
        case "decimals":
          if (address === assetOne) return 18;
          if (address === assetTwo) return 6;
          break;
        case "SCOPE":
          if (address === poolOne) return 123456789n;
          if (address === poolTwo) return 223456789n;
          break;
        default:
          break;
      }

      throw new Error(`unexpected direct read ${functionName} for ${address}`);
    });
    (rpcSession.publicClient as any).multicall = multicallMock;
    (rpcSession.publicClient as any).readContract = readContractMock;

    const pools = await listPools(chainConfig, server.url);

    expect(pools).toHaveLength(2);
    expect(pools[0]?.pool).toBe(poolOne);
    expect(pools[1]?.pool).toBe(poolTwo);
    expect(multicallMock).toHaveBeenCalledTimes(1);
    expect(readContractMock).toHaveBeenCalledTimes(8);
  });

  test("listPools fails closed when ERC-20 metadata cannot be resolved", async () => {
    const chainId = 313393;
    const asset = "0x00000000000000000000000000000000000000b1" as Address;
    const pool = "0x00000000000000000000000000000000000000a1" as Address;
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";

      if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ pools: [{ tokenAddress: asset }] }));
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk);
        });
        req.on("end", () => {
          const json = JSON.parse(body);
          const call = json?.params?.[0] ?? {};
          const to = String(call.to ?? "").toLowerCase();
          const data = String(call.data ?? "").toLowerCase();

          let result = "0x";
          if (
            to === "0x00000000000000000000000000000000000000e1"
            && data.startsWith("0xd6dbaf58")
          ) {
            result = encodeAbiParameters(
              [
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              [pool, 1000000000000000n, 50n, 250n],
            );
          } else if (to === pool.toLowerCase()) {
            result = encodeAbiParameters([{ type: "uint256" }], [123456789n]);
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
        });
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addressInfo = server.address();
    if (!addressInfo || typeof addressInfo === "string") {
      throw new Error("Failed to bind mock server");
    }
    const url = `http://127.0.0.1:${addressInfo.port}`;
    toClose.push({
      url,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: url,
    };

    await expect(listPools(chainConfig, url)).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_POOL_RESOLUTION_FAILED",
      retryable: true,
    });
  });

  test("listKnownPoolsFromRegistry returns an empty list when the registry has no entries for the chain", async () => {
    const chainConfig = {
      ...CHAINS.mainnet,
      id: 39999,
      aspHost: "http://127.0.0.1:1",
    };

    await expect(listKnownPoolsFromRegistry(chainConfig, "http://127.0.0.1:1")).resolves.toEqual([]);
  });

  test("listKnownPoolsFromRegistry resolves built-in pools and deduplicates repeated asset addresses", async () => {
    const chainId = 31344;
    const asset = "0x00000000000000000000000000000000000000c1" as Address;
    const pool = "0x00000000000000000000000000000000000000d1" as Address;
    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: "http://127.0.0.1:1",
    };
    const server = await startMockServerWithConfig(
      chainId,
      { pools: [] },
      {
        entrypoint: chainConfig.entrypoint,
        asset,
        pool,
        scope: 444n,
        symbol: "TEST",
        decimals: 6,
      },
    );
    toClose.push(server);

    const previousKnownPools = KNOWN_POOLS[chainId];
    KNOWN_POOLS[chainId] = {
      TEST: asset,
      TEST_DUP: asset,
    };

    try {
      const pools = await listKnownPoolsFromRegistry(chainConfig, server.url);
      expect(pools).toHaveLength(1);
      expect(pools[0]?.asset.toLowerCase()).toBe(asset.toLowerCase());
      expect(pools[0]?.pool.toLowerCase()).toBe(pool.toLowerCase());
      expect(pools[0]?.symbol).toBe("TEST");
      expect(pools[0]?.decimals).toBe(6);
      expect(pools[0]?.scope).toBe(444n);
      expect(pools[0]?.deploymentBlock).toBe(chainConfig.startBlock);
    } finally {
      if (previousKnownPools) {
        KNOWN_POOLS[chainId] = previousKnownPools;
      } else {
        delete KNOWN_POOLS[chainId];
      }
    }
  });

  test("listKnownPoolsFromRegistry settles multicall viability before parallel resolution", async () => {
    const chainId = 31346;
    const assetOne = "0x00000000000000000000000000000000000000c3" as Address;
    const assetTwo = "0x00000000000000000000000000000000000000c4" as Address;
    const poolOne = "0x00000000000000000000000000000000000000d3" as Address;
    const poolTwo = "0x00000000000000000000000000000000000000d4" as Address;
    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e3" as Address,
      multicall3Address: "0xca11bde05977b3631167028862be2a173976ca11" as Address,
      aspHost: "http://127.0.0.1:1",
    };

    const previousKnownPools = KNOWN_POOLS[chainId];
    KNOWN_POOLS[chainId] = {
      TEST_A: assetOne,
      TEST_B: assetTwo,
    };

    try {
      const rpcSession = await getReadOnlyRpcSession(chainConfig, "https://rpc.example.com");
      const multicallMock = mock(async () => {
        throw new Error("multicall unavailable");
      });
      const readContractMock = mock(async (
        {
          functionName,
          address,
          args,
        }: {
          functionName: string;
          address: Address;
          args?: readonly unknown[];
        },
      ) => {
        switch (functionName) {
          case "assetConfig":
            if (args?.[0] === assetOne) return [poolOne, 1000000n, 50n, 250n];
            if (args?.[0] === assetTwo) return [poolTwo, 2000000n, 75n, 300n];
            break;
          case "symbol":
            if (address === assetOne) return "TESTA";
            if (address === assetTwo) return "TESTB";
            break;
          case "decimals":
            if (address === assetOne) return 18;
            if (address === assetTwo) return 6;
            break;
          case "SCOPE":
            if (address === poolOne) return 333n;
            if (address === poolTwo) return 444n;
            break;
          default:
            break;
        }

        throw new Error(`unexpected direct read ${functionName} for ${address}`);
      });
      (rpcSession.publicClient as any).multicall = multicallMock;
      (rpcSession.publicClient as any).readContract = readContractMock;

      const pools = await listKnownPoolsFromRegistry(chainConfig, "https://rpc.example.com");

      expect(pools).toHaveLength(2);
      expect(pools[0]?.pool).toBe(poolOne);
      expect(pools[1]?.pool).toBe(poolTwo);
      expect(multicallMock).toHaveBeenCalledTimes(1);
      expect(readContractMock).toHaveBeenCalledTimes(8);
    } finally {
      if (previousKnownPools) {
        KNOWN_POOLS[chainId] = previousKnownPools;
      } else {
        delete KNOWN_POOLS[chainId];
      }
    }
  });

  test("listKnownPoolsFromRegistry tolerates missing token metadata for read-only migration discovery", async () => {
    const chainId = 31345;
    const asset = "0x00000000000000000000000000000000000000c2" as Address;
    const pool = "0x00000000000000000000000000000000000000d2" as Address;
    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e2" as Address,
      aspHost: "http://127.0.0.1:1",
    };
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk);
        });
        req.on("end", () => {
          const json = JSON.parse(body);
          const call = json?.params?.[0] ?? {};
          const to = String(call.to ?? "").toLowerCase();
          const data = String(call.data ?? "").toLowerCase();

          let result = "0x";
          if (
            to === chainConfig.entrypoint.toLowerCase()
            && data.startsWith("0xd6dbaf58")
          ) {
            result = encodeAbiParameters(
              [
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              [pool, 1000000n, 50n, 250n],
            );
          } else if (to === pool.toLowerCase()) {
            result = encodeAbiParameters([{ type: "uint256" }], [555n]);
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
        });
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const url = `http://127.0.0.1:${addr.port}`;
    toClose.push({
      url,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });

    const previousKnownPools = KNOWN_POOLS[chainId];
    KNOWN_POOLS[chainId] = { TEST: asset };

    try {
      const pools = await listKnownPoolsFromRegistry(chainConfig, url);
      expect(pools).toHaveLength(1);
      expect(pools[0]).toMatchObject({
        symbol: "???",
        decimals: 18,
      });
    } finally {
      if (previousKnownPools) {
        KNOWN_POOLS[chainId] = previousKnownPools;
      } else {
        delete KNOWN_POOLS[chainId];
      }
    }
  });

  test("resolvePool skips ASP listing for canonical known symbols on built-in default RPCs", async () => {
    const chainId = CHAINS.sepolia.id;
    const ethPool = "0x00000000000000000000000000000000000000a1" as Address;
    const scope = 123456789n;
    let statsRequests = 0;
    const originalDefaultRpcUrls = DEFAULT_RPC_URLS[chainId];

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";

      if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
        statsRequests += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ pools: [] }));
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk);
        });
        req.on("end", () => {
          const json = JSON.parse(body);
          const call = json?.params?.[0] ?? {};
          const to = String(call.to ?? "").toLowerCase();
          const data = String(call.data ?? "").toLowerCase();

          let result = "0x";
          if (
            to === CHAINS.sepolia.entrypoint.toLowerCase() &&
            data.startsWith("0xd6dbaf58")
          ) {
            result = encodeAbiParameters(
              [
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              [ethPool, 1000000000000000n, 50n, 250n],
            );
          } else if (to === ethPool.toLowerCase()) {
            result = encodeAbiParameters([{ type: "uint256" }], [scope]);
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: json.id,
              result,
            }),
          );
        });
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const url = `http://127.0.0.1:${addr.port}`;
    toClose.push({
      url,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });

    const chainConfig = {
      ...CHAINS.sepolia,
      aspHost: url,
    };

    DEFAULT_RPC_URLS[chainId] = [url];
    try {
      const pool = await resolvePool(chainConfig, "ETH");
      const deploymentHint = lookupPoolDeploymentBlock(
        chainConfig.id,
        NATIVE_ASSET_ADDRESS,
        ethPool,
      );
      expect(pool.symbol).toBe("ETH");
      expect(pool.asset.toLowerCase()).toBe(
        NATIVE_ASSET_ADDRESS.toLowerCase(),
      );
      expect(pool.pool.toLowerCase()).toBe(ethPool.toLowerCase());
      expect(pool.scope).toBe(scope);
      expect(deploymentHint).toBeDefined();
      expect(pool.deploymentBlock).toBe(chainConfig.startBlock);
      expect(statsRequests).toBe(0);
    } finally {
      DEFAULT_RPC_URLS[chainId] = originalDefaultRpcUrls;
    }
  });

  test("resolvePool uses the built-in fast path for canonical symbols on env-backed custom RPCs", async () => {
    const chainId = CHAINS.sepolia.id;
    const asset = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Address;
    const pool = "0x00000000000000000000000000000000000000a1" as Address;
    const scope = 987654321n;
    let statsRequests = 0;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "";

      if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
        statsRequests += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          pools: [
            {
              tokenAddress: asset,
              tokenSymbol: "USDC",
              totalInPoolValue: "0",
              totalDepositsValue: "0",
              acceptedDepositsValue: "0",
              pendingDepositsValue: "0",
              totalDepositsCount: 0,
              acceptedDepositsCount: 0,
              pendingDepositsCount: 0,
              growth24h: 0,
              pendingGrowth24h: 0,
            },
          ],
        }));
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk);
        });
        req.on("end", () => {
          const json = JSON.parse(body);
          const call = json?.params?.[0] ?? {};
          const to = String(call.to ?? "").toLowerCase();
          const data = String(call.data ?? "").toLowerCase();

          let result = "0x";
          if (
            to === CHAINS.sepolia.entrypoint.toLowerCase() &&
            data.startsWith("0xd6dbaf58")
          ) {
            result = encodeAbiParameters(
              [
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              [pool, 1000000n, 50n, 250n],
            );
          } else if (to === pool.toLowerCase()) {
            result = encodeAbiParameters([{ type: "uint256" }], [scope]);
          } else if (to === asset.toLowerCase() && data.startsWith("0x95d89b41")) {
            result = encodeAbiParameters([{ type: "string" }], ["USDC"]);
          } else if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
            result = encodeAbiParameters([{ type: "uint8" }], [6]);
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: json.id,
              result,
            }),
          );
        });
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const url = `http://127.0.0.1:${addr.port}`;
    toClose.push({
      url,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });

    const chainConfig = {
      ...CHAINS.sepolia,
      aspHost: url,
    };

    process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA = url;
    resetSdkServiceCachesForTests();

    const resolved = await resolvePool(chainConfig, "USDC");
    expect(statsRequests).toBe(0);
    expect(resolved.symbol).toBe("USDC");
    expect(resolved.asset.toLowerCase()).toBe(asset.toLowerCase());
    expect(resolved.pool.toLowerCase()).toBe(pool.toLowerCase());
    expect(resolved.scope).toBe(scope);
  });

  test("resolvePool surfaces the offline ASP hint when fallback registry has no match", async () => {
    const chainId = 39998;
    const server = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "offline" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const url = `http://127.0.0.1:${addr.port}`;
    toClose.push({
      url,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: url,
    };

    await expect(resolvePool(chainConfig, "UNKNOWN", url)).rejects.toMatchObject({
      category: "INPUT",
      message: `No pool found for asset "UNKNOWN" on ${chainConfig.name}.`,
      hint:
        "The ASP may be offline. Try using the token contract address as the positional asset (0x...).",
    });
  });

  test("resolvePool surfaces built-in fallback RPC failures with a targeted machine code", async () => {
    const chainId = 31347;
    const asset = "0x00000000000000000000000000000000000000c1" as Address;
    const previousKnownPools = KNOWN_POOLS[chainId];
    const originalDefaultRpcUrls = DEFAULT_RPC_URLS[chainId];
    KNOWN_POOLS[chainId] = {
      TEST: asset,
    };

    const server = createServer((req, res) => {
      const url = req.url ?? "";
      if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "offline" }));
        return;
      }

      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += String(chunk);
        });
        req.on("end", () => {
          const json = JSON.parse(body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: json.id,
              error: { code: -32000, message: "RPC unavailable" },
            }),
          );
        });
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bind failed");
    const url = `http://127.0.0.1:${addr.port}`;
    toClose.push({
      url,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    });

    const chainConfig = {
      ...CHAINS.mainnet,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: url,
    };

    try {
      DEFAULT_RPC_URLS[chainId] = [url];
      await expect(resolvePool(chainConfig, "TEST")).rejects.toMatchObject({
        category: "RPC",
        code: "RPC_POOL_RESOLUTION_FAILED",
        retryable: true,
        message: `Built-in pool fallback also failed for "TEST" on ${chainConfig.name}.`,
      });
    } finally {
      if (originalDefaultRpcUrls) {
        DEFAULT_RPC_URLS[chainId] = originalDefaultRpcUrls;
      } else {
        delete DEFAULT_RPC_URLS[chainId];
      }
      if (previousKnownPools) {
        KNOWN_POOLS[chainId] = previousKnownPools;
      } else {
        delete KNOWN_POOLS[chainId];
      }
    }
  });
});
