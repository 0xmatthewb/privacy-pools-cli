import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";
import { CHAINS, KNOWN_POOLS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import { lookupPoolDeploymentBlock } from "../../src/config/deployment-hints.ts";
import { overrideAspRetryWaitForTests } from "../../src/services/asp.ts";
import {
  listKnownPoolsFromRegistry,
  listPools,
  resetPoolsServiceCachesForTests,
  resolvePool,
  resolveTokenMetadata,
} from "../../src/services/pools.ts";
import {
  overrideSdkTransportRetryForTests,
  resetSdkServiceCachesForTests,
} from "../../src/services/sdk.ts";
import { CLIError } from "../../src/utils/errors.ts";

/* ------------------------------------------------------------------ */
/*  Mock server helpers                                                */
/* ------------------------------------------------------------------ */

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

const ENTRYPOINT = "0x00000000000000000000000000000000000000e1" as Address;
const POOL = "0x00000000000000000000000000000000000000a1" as Address;
const ASSET = "0x00000000000000000000000000000000000000b1" as Address;
const SCOPE = 123456789n;

/**
 * Starts a mock HTTP server that simulates both the ASP pools-stats
 * endpoint and an RPC node for onchain reads.
 */
function startMockServer(
  chainId: number,
  opts: {
    statsPayload?: unknown;
    rpcHandler?: (call: { to: string; data: string }, json: any) => string | null;
    rpcError?: boolean;
  } = {}
): Promise<MockServer> {
  const { statsPayload = { pools: [] }, rpcHandler, rpcError = false } = opts;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";

    // ASP stats endpoint
    if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statsPayload));
      return;
    }

    // RPC endpoint (JSON-RPC POST)
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const json = JSON.parse(body);

        if (rpcError) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: json.id,
            error: { code: -32000, message: "RPC unavailable" },
          }));
          return;
        }

        const call = json?.params?.[0] ?? {};
        const to = String(call.to ?? "").toLowerCase();
        const data = String(call.data ?? "").toLowerCase();

        // Allow custom handler to override
        if (rpcHandler) {
          const custom = rpcHandler({ to, data }, json);
          if (custom !== null) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result: custom }));
            return;
          }
        }

        let result = "0x";

        // assetConfig(address)
        if (to === ENTRYPOINT.toLowerCase() && data.startsWith("0xd6dbaf58")) {
          result = encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [POOL, 1000000000000000n, 50n, 250n]
          );
        // SCOPE()
        } else if (to === POOL.toLowerCase()) {
          result = encodeAbiParameters([{ type: "uint256" }], [SCOPE]);
        // symbol()
        } else if (data.startsWith("0x95d89b41")) {
          result = encodeAbiParameters([{ type: "string" }], ["ETHX"]);
        // decimals()
        } else if (data.startsWith("0x313ce567")) {
          result = encodeAbiParameters([{ type: "uint8" }], [18]);
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise<MockServer>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("bind failed");
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r, j) => server.close((e) => e ? j(e) : r())),
      });
    });
  });
}

function chainConfig(chainId: number, server: MockServer) {
  return {
    ...CHAINS.mainnet,
    id: chainId,
    entrypoint: ENTRYPOINT,
    aspHost: server.url,
  };
}

/* ------------------------------------------------------------------ */
/*  resolvePool tests                                                  */
/* ------------------------------------------------------------------ */

describe("resolvePool", () => {
  const toClose: MockServer[] = [];

  beforeEach(() => {
    overrideAspRetryWaitForTests(async () => {});
    overrideSdkTransportRetryForTests({ retryCount: 0 });
  });

  afterEach(async () => {
    overrideAspRetryWaitForTests();
    overrideSdkTransportRetryForTests();
    resetSdkServiceCachesForTests();
    resetPoolsServiceCachesForTests();
    while (toClose.length > 0) await toClose.pop()!.close();
  });

  test("resolves pool by address via onchain validation", async () => {
    const server = await startMockServer(31350);
    toClose.push(server);
    const cfg = chainConfig(31350, server);

    const pool = await resolvePool(cfg, ASSET, server.url);

    expect(pool.asset).toBe(ASSET);
    expect(pool.pool.toLowerCase()).toBe(POOL.toLowerCase());
    expect(pool.scope).toBe(SCOPE);
    expect(pool.symbol).toBe("ETHX");
    expect(pool.decimals).toBe(18);
    expect(pool.minimumDepositAmount).toBe(1000000000000000n);
    expect(pool.vettingFeeBPS).toBe(50n);
    expect(pool.maxRelayFeeBPS).toBe(250n);
  });

  test("resolves pool by symbol (case-insensitive) from listPools", async () => {
    const server = await startMockServer(31351, {
      statsPayload: { pools: [{ tokenAddress: ASSET }] },
    });
    toClose.push(server);
    const cfg = chainConfig(31351, server);

    const pool = await resolvePool(cfg, "ethx", server.url);

    expect(pool.symbol).toBe("ETHX");
    expect(pool.asset).toBe(ASSET);
  });

  test("resolves known symbols through the built-in fast path even with a custom rpc override", async () => {
    const asset = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Address;
    const poolAddress = "0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f" as Address;
    const server = await startMockServer(11155111, {
      statsPayload: { pools: [] },
      rpcHandler: ({ to, data }) => {
        if (to === CHAINS.sepolia.entrypoint.toLowerCase() && data.startsWith("0xd6dbaf58")) {
          return encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [poolAddress, 1000000n, 50n, 250n]
          );
        }
        if (to === poolAddress.toLowerCase()) {
          return encodeAbiParameters([{ type: "uint256" }], [SCOPE]);
        }
        if (to === asset.toLowerCase() && data.startsWith("0x95d89b41")) {
          return encodeAbiParameters([{ type: "string" }], ["USDC"]);
        }
        if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
          return encodeAbiParameters([{ type: "uint8" }], [6]);
        }
        return null;
      },
    });
    toClose.push(server);

    const cfg = {
      ...CHAINS.sepolia,
      aspHost: server.url,
    };

    const pool = await resolvePool(cfg, "USDC", server.url);

    expect(pool.asset.toLowerCase()).toBe(asset.toLowerCase());
    expect(pool.pool.toLowerCase()).toBe(poolAddress.toLowerCase());
    expect(pool.symbol).toBe("USDC");
  });

  test("keeps deployment hints for known pools on local rpc", async () => {
    const asset = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as Address;
    const poolAddress = "0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f" as Address;
    const server = await startMockServer(11155111, {
      rpcHandler: ({ to, data }) => {
        if (to === CHAINS.sepolia.entrypoint.toLowerCase() && data.startsWith("0xd6dbaf58")) {
          return encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [poolAddress, 1000000n, 50n, 250n]
          );
        }
        if (to === poolAddress.toLowerCase()) {
          return encodeAbiParameters([{ type: "uint256" }], [SCOPE]);
        }
        if (to === asset.toLowerCase() && data.startsWith("0x95d89b41")) {
          return encodeAbiParameters([{ type: "string" }], ["USDC"]);
        }
        if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
          return encodeAbiParameters([{ type: "uint8" }], [6]);
        }
        return null;
      },
    });
    toClose.push(server);

    const cfg = {
      ...CHAINS.sepolia,
      aspHost: server.url,
    };

    const pool = await resolvePool(cfg, asset, server.url);
    const deploymentHint = lookupPoolDeploymentBlock(
      cfg.id,
      asset,
      poolAddress,
    );

    expect(pool.asset.toLowerCase()).toBe(asset.toLowerCase());
    expect(pool.pool.toLowerCase()).toBe(poolAddress.toLowerCase());
    expect(pool.symbol).toBe("USDC");
    expect(typeof deploymentHint).toBe("bigint");
    expect(pool.deploymentBlock).toBe(deploymentHint);
  });

  test("throws INPUT CLIError with available assets when symbol not found", async () => {
    const server = await startMockServer(31352, {
      statsPayload: { pools: [{ tokenAddress: ASSET }] },
    });
    toClose.push(server);
    const cfg = chainConfig(31352, server);

    try {
      await resolvePool(cfg, "DOESNOTEXIST", server.url);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      expect(e.category).toBe("INPUT");
      expect(e.hint).toContain("ETHX");
    }
  });

  test("maps RPC failure on address resolution to RPC_POOL_RESOLUTION_FAILED retryable=true", async () => {
    // Mock globalThis.fetch to throw a network-level error that
    // isRpcLikeError recognizes (contains "fetch" keyword).
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("fetch failed: ECONNREFUSED"))) as typeof fetch;

    const cfg = {
      ...CHAINS.mainnet,
      id: 31353,
      entrypoint: ENTRYPOINT,
      aspHost: "http://127.0.0.1:1",
    };

    try {
      await resolvePool(cfg, ASSET, "http://127.0.0.1:1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      expect(e.category).toBe("RPC");
      expect(e.code).toBe("RPC_POOL_RESOLUTION_FAILED");
      expect(e.retryable).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps non-RPC failure on address resolution to INPUT error", async () => {
    // Return a zero pool address to simulate unregistered asset
    const server = await startMockServer(31354, {
      rpcHandler: ({ to, data }) => {
        if (to === ENTRYPOINT.toLowerCase() && data.startsWith("0xd6dbaf58")) {
          // Return zero pool address — will fail SCOPE() call
          return encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            ["0x0000000000000000000000000000000000000000", 0n, 0n, 0n]
          );
        }
        if (to === "0x0000000000000000000000000000000000000000") {
          // SCOPE() on zero address will revert
          return null; // fall through to default (returns 0x which will fail decode)
        }
        return null;
      },
    });
    toClose.push(server);
    const cfg = chainConfig(31354, server);

    try {
      await resolvePool(cfg, ASSET, server.url);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      expect(e.category).toBe("INPUT");
      expect(e.message).toContain("No pool found");
    }
  });
});

/* ------------------------------------------------------------------ */
/*  resolveTokenMetadata tests                                         */
/* ------------------------------------------------------------------ */

describe("resolveTokenMetadata", () => {
  const toClose: MockServer[] = [];

  beforeEach(() => {
    overrideAspRetryWaitForTests(async () => {});
    overrideSdkTransportRetryForTests({ retryCount: 0 });
  });

  afterEach(async () => {
    overrideAspRetryWaitForTests();
    overrideSdkTransportRetryForTests();
    resetSdkServiceCachesForTests();
    resetPoolsServiceCachesForTests();
    while (toClose.length > 0) await toClose.pop()!.close();
  });

  test("returns ETH/18 for native asset address", async () => {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    // No RPC calls needed for native asset — use a dummy server
    const server = await startMockServer(31360);
    toClose.push(server);

    const client = createPublicClient({
      chain: { ...mainnet, id: 31360 },
      transport: http(server.url),
    });

    const result = await resolveTokenMetadata(client, NATIVE_ASSET_ADDRESS);
    expect(result.symbol).toBe("ETH");
    expect(result.decimals).toBe(18);
  });

  test("returns ERC-20 symbol and decimals from onchain call", async () => {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    const server = await startMockServer(31361);
    toClose.push(server);

    const client = createPublicClient({
      chain: { ...mainnet, id: 31361 },
      transport: http(server.url),
    });

    const result = await resolveTokenMetadata(client, ASSET);
    expect(result.symbol).toBe("ETHX");
    expect(result.decimals).toBe(18);
  });

  test("rejects strict ERC-20 metadata resolution when symbol or decimals revert", async () => {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    // Return invalid data for symbol/decimals calls
    const server = await startMockServer(31362, {
      rpcHandler: ({ data }) => {
        if (data.startsWith("0x95d89b41") || data.startsWith("0x313ce567")) {
          // Return empty bytes to simulate revert
          return "0x";
        }
        return null;
      },
    });
    toClose.push(server);

    const nonStandardToken = "0x00000000000000000000000000000000000000cc" as Address;
    const client = createPublicClient({
      chain: { ...mainnet, id: 31362 },
      transport: http(server.url),
    });

    await expect(resolveTokenMetadata(client, nonStandardToken)).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_POOL_RESOLUTION_FAILED",
      retryable: true,
    });
  });

  test("can opt into ???/18 fallback for read-only listings", async () => {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    const server = await startMockServer(31362, {
      rpcHandler: ({ data }) => {
        if (data.startsWith("0x95d89b41") || data.startsWith("0x313ce567")) {
          return "0x";
        }
        return null;
      },
    });
    toClose.push(server);

    const nonStandardToken = "0x00000000000000000000000000000000000000cc" as Address;
    const client = createPublicClient({
      chain: { ...mainnet, id: 31362 },
      transport: http(server.url),
    });

    const result = await resolveTokenMetadata(client, nonStandardToken, undefined, {
      allowFallback: true,
    });
    expect(result.symbol).toBe("???");
    expect(result.decimals).toBe(18);
  });

  test("does not let fallback metadata poison later successful reads", async () => {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    const asset = "0x00000000000000000000000000000000000000dd" as Address;
    const chainId = 31363;
    const fallbackServer = await startMockServer(chainId, {
      rpcHandler: ({ to, data }) => {
        if (
          to === asset.toLowerCase()
          && (data.startsWith("0x95d89b41") || data.startsWith("0x313ce567"))
        ) {
          return "0x";
        }
        return null;
      },
    });
    toClose.push(fallbackServer);

    const fallbackClient = createPublicClient({
      chain: { ...mainnet, id: chainId },
      transport: http(fallbackServer.url),
    });

    const fallbackResult = await resolveTokenMetadata(
      fallbackClient,
      asset,
      undefined,
      { allowFallback: true },
    );
    expect(fallbackResult).toEqual({ symbol: "???", decimals: 18 });

    const successServer = await startMockServer(chainId, {
      rpcHandler: ({ to, data }) => {
        if (to === asset.toLowerCase() && data.startsWith("0x95d89b41")) {
          return encodeAbiParameters([{ type: "string" }], ["USDC"]);
        }
        if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
          return encodeAbiParameters([{ type: "uint8" }], [6]);
        }
        return null;
      },
    });
    toClose.push(successServer);

    const successClient = createPublicClient({
      chain: { ...mainnet, id: chainId },
      transport: http(successServer.url),
    });

    const successResult = await resolveTokenMetadata(successClient, asset);
    expect(successResult).toEqual({ symbol: "USDC", decimals: 6 });
  });

  test("does not reuse strict metadata across different rpc urls", async () => {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");

    const asset = "0x00000000000000000000000000000000000000ee" as Address;
    const chainId = 31365;
    const successServer = await startMockServer(chainId, {
      rpcHandler: ({ to, data }) => {
        if (to === asset.toLowerCase() && data.startsWith("0x95d89b41")) {
          return encodeAbiParameters([{ type: "string" }], ["USDC"]);
        }
        if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
          return encodeAbiParameters([{ type: "uint8" }], [6]);
        }
        return null;
      },
    });
    toClose.push(successServer);

    const successClient = createPublicClient({
      chain: { ...mainnet, id: chainId },
      transport: http(successServer.url),
    });

    await expect(
      resolveTokenMetadata(successClient, asset, undefined, {
        rpcCacheKey: successServer.url,
      }),
    ).resolves.toEqual({ symbol: "USDC", decimals: 6 });

    const failingServer = await startMockServer(chainId, {
      rpcHandler: ({ to, data }) => {
        if (
          to === asset.toLowerCase()
          && (data.startsWith("0x95d89b41") || data.startsWith("0x313ce567"))
        ) {
          return "0x";
        }
        return null;
      },
    });
    toClose.push(failingServer);

    const failingClient = createPublicClient({
      chain: { ...mainnet, id: chainId },
      transport: http(failingServer.url),
    });

    await expect(
      resolveTokenMetadata(failingClient, asset, undefined, {
        rpcCacheKey: failingServer.url,
      }),
    ).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_POOL_RESOLUTION_FAILED",
      retryable: true,
    });
  });

  test("registry fallback descriptors do not poison later strict pool resolution", async () => {
    let metadataReads = 0;
    const chainId = 31364;
    const server = await startMockServer(chainId, {
      statsPayload: { pools: [] },
      rpcHandler: ({ to, data }) => {
        if (to === ASSET.toLowerCase() && data.startsWith("0x95d89b41")) {
          metadataReads += 1;
          if (metadataReads === 1) {
            return "0x";
          }
          return encodeAbiParameters([{ type: "string" }], ["USDC"]);
        }
        if (to === ASSET.toLowerCase() && data.startsWith("0x313ce567")) {
          return metadataReads === 1
            ? "0x"
            : encodeAbiParameters([{ type: "uint8" }], [6]);
        }
        return null;
      },
    });
    toClose.push(server);

    const cfg = chainConfig(chainId, server);
    const previousKnownPools = KNOWN_POOLS[chainId];
    KNOWN_POOLS[chainId] = { USDC: ASSET };

    try {
      const listedPools = await listKnownPoolsFromRegistry(cfg, server.url);
      expect(listedPools).toHaveLength(1);
      expect(listedPools[0]).toMatchObject({
        symbol: "???",
        decimals: 18,
      });

      const resolvedPool = await resolvePool(cfg, ASSET, server.url);
      expect(resolvedPool).toMatchObject({
        symbol: "USDC",
        decimals: 6,
      });
    } finally {
      if (previousKnownPools) {
        KNOWN_POOLS[chainId] = previousKnownPools;
      } else {
        delete KNOWN_POOLS[chainId];
      }
    }
  });
});
