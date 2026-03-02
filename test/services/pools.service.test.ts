import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";
import { CHAINS } from "../../src/config/chains.ts";
import { listPools } from "../../src/services/pools.ts";

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

async function startMockServer(chainId: number, statsPayload: unknown): Promise<MockServer> {
  const entrypoint = "0x00000000000000000000000000000000000000e1" as Address;
  const pool = "0x00000000000000000000000000000000000000a1" as Address;
  const asset = "0x00000000000000000000000000000000000000b1" as Address;
  const scope = 123456789n;

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
          result = encodeAbiParameters([{ type: "string" }], ["ETHX"]);
        } else if (to === asset.toLowerCase() && data.startsWith("0x313ce567")) {
          result = encodeAbiParameters([{ type: "uint8" }], [18]);
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

  afterEach(async () => {
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

  test("listPools throws RPC_POOL_RESOLUTION_FAILED when ASP returns pools but all on-chain reads fail", async () => {
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
});
