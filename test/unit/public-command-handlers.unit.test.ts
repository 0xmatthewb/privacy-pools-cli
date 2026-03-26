import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";
import type { Command } from "commander";
import { handleActivityCommand } from "../../src/commands/activity.ts";
import {
  handleGlobalStatsCommand,
  handlePoolStatsCommand,
} from "../../src/commands/stats.ts";
import { handlePoolsCommand } from "../../src/commands/pools.ts";
import { saveConfig } from "../../src/services/config.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_ASP_HOST = process.env.PRIVACY_POOLS_ASP_HOST;
const ORIGINAL_RPC_URL = process.env.PRIVACY_POOLS_RPC_URL;

const POOL = "0x00000000000000000000000000000000000000a1" as Address;
const ASSET = "0x00000000000000000000000000000000000000b1" as Address;
const SCOPE = 123456789n;

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
  args: string[] = [],
): Command {
  return {
    parent: fakeRoot(globalOpts),
    args,
  } as unknown as Command;
}

function fakeStatsSubcommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      parent: {
        opts: () => globalOpts,
      },
    },
  } as unknown as Command;
}

async function startPublicMockServer(chainIds: number[]): Promise<MockServer> {
  const chainIdSet = new Set(chainIds);
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "GET" && path === "/global/public/events") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          page: Number(url.searchParams.get("page") ?? "1"),
          perPage: Number(url.searchParams.get("perPage") ?? "12"),
          total: 2,
          totalPages: 1,
          events: [
            {
              type: "deposit",
              txHash: "0x" + "11".repeat(32),
              timestamp: 1_700_000_000,
              amount: "1000000000000000000",
              reviewStatus: "approved",
              pool: {
                chainId: 1,
                poolAddress: POOL,
                tokenSymbol: "ETHX",
                tokenAddress: ASSET,
              },
            },
            {
              type: "deposit",
              txHash: "0x" + "22".repeat(32),
              timestamp: 1_700_000_123,
              amount: "2000000000000000000",
              reviewStatus: "pending",
              pool: {
                chainId: 10,
                poolAddress: POOL,
                tokenSymbol: "ETHX",
                tokenAddress: ASSET,
              },
            },
          ],
        }),
      );
      return;
    }

    if (req.method === "GET" && path === "/global/public/statistics") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          cacheTimestamp: "2025-01-01T00:00:00.000Z",
          allTime: {
            tvlUsd: "5000000",
            avgDepositSizeUsd: "10000",
            totalDepositsCount: 500,
            totalWithdrawalsCount: 150,
          },
          last24h: {
            tvlUsd: "5000000",
            avgDepositSizeUsd: "10000",
            totalDepositsCount: 10,
            totalWithdrawalsCount: 3,
          },
        }),
      );
      return;
    }

    const poolStatsMatch = path.match(/^\/(\d+)\/public\/pools-stats$/);
    if (req.method === "GET" && poolStatsMatch) {
      const chainId = Number(poolStatsMatch[1]);
      if (!chainIdSet.has(chainId)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          pools: [
            {
              tokenAddress: ASSET,
              totalInPoolValue: "90000000000000000000",
              totalInPoolValueUsd: "180000",
              acceptedDepositsValue: "88000000000000000000",
              acceptedDepositsValueUsd: "176000",
              totalDepositsCount: 42,
              acceptedDepositsCount: 38,
              pendingDepositsCount: 4,
            },
          ],
        }),
      );
      return;
    }

    const poolEventsMatch = path.match(/^\/(\d+)\/public\/events$/);
    if (req.method === "GET" && poolEventsMatch) {
      const chainId = Number(poolEventsMatch[1]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          page: Number(url.searchParams.get("page") ?? "1"),
          perPage: Number(url.searchParams.get("perPage") ?? "12"),
          total: 1,
          totalPages: 1,
          events: [
            {
              type: "deposit",
              txHash: "0x" + "33".repeat(32),
              timestamp: 1_700_000_456,
              amount: "3000000000000000000",
              reviewStatus: "approved",
              pool: {
                chainId,
                poolAddress: POOL,
                tokenSymbol: "ETHX",
                tokenAddress: ASSET,
              },
            },
          ],
        }),
      );
      return;
    }

    const poolStatisticsMatch = path.match(/^\/(\d+)\/public\/pool-statistics$/);
    if (req.method === "GET" && poolStatisticsMatch) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          cacheTimestamp: "2025-01-02T00:00:00.000Z",
          pool: {
            allTime: {
              tvlUsd: "250000",
              avgDepositSizeUsd: "5000",
              totalDepositsCount: 20,
              totalWithdrawalsCount: 5,
            },
            last24h: {
              tvlUsd: "250000",
              avgDepositSizeUsd: "5000",
              totalDepositsCount: 2,
              totalWithdrawalsCount: 1,
            },
          },
        }),
      );
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
        const data = String(call.data ?? "").toLowerCase();

        let result = "0x";
        if (data.startsWith("0xd6dbaf58")) {
          result = encodeAbiParameters(
            [
              { type: "address" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint256" },
            ],
            [POOL, 1000000000000000n, 50n, 250n],
          );
        } else if (data.startsWith("0x95d89b41")) {
          result = encodeAbiParameters([{ type: "string" }], ["ETHX"]);
        } else if (data.startsWith("0x313ce567")) {
          result = encodeAbiParameters([{ type: "uint8" }], [18]);
        } else {
          result = encodeAbiParameters([{ type: "uint256" }], [SCOPE]);
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
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

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  if (ORIGINAL_ASP_HOST === undefined) {
    delete process.env.PRIVACY_POOLS_ASP_HOST;
  } else {
    process.env.PRIVACY_POOLS_ASP_HOST = ORIGINAL_ASP_HOST;
  }
  if (ORIGINAL_RPC_URL === undefined) {
    delete process.env.PRIVACY_POOLS_RPC_URL;
  } else {
    process.env.PRIVACY_POOLS_RPC_URL = ORIGINAL_RPC_URL;
  }
  cleanupTrackedTempDirs();
});

describe("public read-only command handlers", () => {
  test("pools lists CLI-visible pools across mainnet chains", async () => {
    const server = await startPublicMockServer([1, 10, 42161, 11155111]);
    try {
      process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-public-cmds-");
      process.env.PRIVACY_POOLS_ASP_HOST = server.url;
      process.env.PRIVACY_POOLS_RPC_URL = server.url;
      saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });

      const { json } = await captureAsyncJsonOutput(() =>
        handlePoolsCommand(
          undefined,
          { allChains: true, search: "ETHX", sort: "asset-asc" },
          fakeCommand({ json: true }),
        ),
      );

      expect(json.success).toBe(true);
      expect(json.allChains).toBe(true);
      expect(json.chains).toHaveLength(5);
      expect(json.pools.every((entry: { asset: string }) => entry.asset === "ETHX")).toBe(true);
    } finally {
      await server.close();
    }
  });

  test("pools detail renders recent activity even without a configured wallet", async () => {
    const server = await startPublicMockServer([11155111]);
    try {
      process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-public-cmds-");
      process.env.PRIVACY_POOLS_ASP_HOST = server.url;
      process.env.PRIVACY_POOLS_RPC_URL = server.url;
      saveConfig({ defaultChain: "sepolia", rpcOverrides: {} });

      const { json } = await captureAsyncJsonOutput(() =>
        handlePoolsCommand(
          "ETHX",
          {},
          fakeCommand({ json: true, chain: "sepolia" }),
        ),
      );

      expect(json.success).toBe(true);
      expect(json.asset).toBe("ETHX");
      expect(json.chain).toBe("sepolia");
      expect(json.myFunds).toBeNull();
      expect(json.recentActivity).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  test("activity returns global cross-chain events by default", async () => {
    const server = await startPublicMockServer([1, 10, 42161]);
    try {
      process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-public-cmds-");
      process.env.PRIVACY_POOLS_ASP_HOST = server.url;
      saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });

      const { json } = await captureAsyncJsonOutput(() =>
        handleActivityCommand({}, fakeCommand({ json: true })),
      );

      expect(json.success).toBe(true);
      expect(json.mode).toBe("global-activity");
      expect(json.chain).toBe("all-mainnets");
      expect(json.events).toHaveLength(2);
      expect(json.chains).toEqual(["mainnet", "arbitrum", "optimism"]);
    } finally {
      await server.close();
    }
  });

  test("activity resolves a single-pool feed when --asset is provided", async () => {
    const server = await startPublicMockServer([11155111]);
    try {
      process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-public-cmds-");
      process.env.PRIVACY_POOLS_ASP_HOST = server.url;
      process.env.PRIVACY_POOLS_RPC_URL = server.url;
      saveConfig({ defaultChain: "sepolia", rpcOverrides: {} });

      const { json } = await captureAsyncJsonOutput(() =>
        handleActivityCommand(
          { asset: "ETHX", page: "1", limit: "5" },
          fakeCommand({ json: true, chain: "sepolia" }),
        ),
      );

      expect(json.success).toBe(true);
      expect(json.mode).toBe("pool-activity");
      expect(json.asset).toBe("ETHX");
      expect(json.scope).toBe(SCOPE.toString());
      expect(json.events).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  test("stats global returns cross-chain protocol data", async () => {
    const server = await startPublicMockServer([1, 10, 42161]);
    try {
      process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-public-cmds-");
      process.env.PRIVACY_POOLS_ASP_HOST = server.url;
      saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });

      const { json } = await captureAsyncJsonOutput(() =>
        handleGlobalStatsCommand({}, fakeStatsSubcommand({ json: true })),
      );

      expect(json.success).toBe(true);
      expect(json.mode).toBe("global-stats");
      expect(json.chain).toBe("all-mainnets");
      expect(json.chains).toEqual(["mainnet", "arbitrum", "optimism"]);
      expect(json.allTime.totalDepositsCount).toBe(500);
    } finally {
      await server.close();
    }
  });

  test("stats pool returns per-pool statistics for a resolved asset", async () => {
    const server = await startPublicMockServer([11155111]);
    try {
      process.env.PRIVACY_POOLS_HOME = createTrackedTempDir("pp-public-cmds-");
      process.env.PRIVACY_POOLS_ASP_HOST = server.url;
      process.env.PRIVACY_POOLS_RPC_URL = server.url;
      saveConfig({ defaultChain: "sepolia", rpcOverrides: {} });

      const { json } = await captureAsyncJsonOutput(() =>
        handlePoolStatsCommand(
          { asset: "ETHX" },
          fakeStatsSubcommand({ json: true, chain: "sepolia" }),
        ),
      );

      expect(json.success).toBe(true);
      expect(json.mode).toBe("pool-stats");
      expect(json.asset).toBe("ETHX");
      expect(json.scope).toBe(SCOPE.toString());
      expect(json.last24h.totalDepositsCount).toBe(2);
    } finally {
      await server.close();
    }
  });

  test("stats global fails with a structured INPUT error when --chain is set", async () => {
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleGlobalStatsCommand({}, fakeStatsSubcommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("--chain flag is not supported");
    expect(exitCode).toBe(2);
  });
});
