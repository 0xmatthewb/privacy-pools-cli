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

  test("listPools parses object payload shape: { pools: [...] }", async () => {
    const chainId = 31337;
    const server = await startMockServer(chainId, {
      pools: [
        {
          assetAddress: "0x00000000000000000000000000000000000000b1",
        },
      ],
    });
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.ethereum,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools.length).toBe(1);
    expect(pools[0].symbol).toBe("ETHX");
    expect(pools[0].minimumDepositAmount).toBe(1000000000000000n);
  });

  test("listPools also supports legacy array payload shape", async () => {
    const chainId = 31338;
    const server = await startMockServer(chainId, [
      {
        assetAddress: "0x00000000000000000000000000000000000000b1",
      },
    ]);
    toClose.push(server);

    const chainConfig = {
      ...CHAINS.ethereum,
      id: chainId,
      entrypoint: "0x00000000000000000000000000000000000000e1" as Address,
      aspHost: server.url,
    };

    const pools = await listPools(chainConfig, server.url);
    expect(pools.length).toBe(1);
    expect(pools[0].scope).toBe(123456789n);
  });
});
