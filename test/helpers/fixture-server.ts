/**
 * Lightweight ASP fixture HTTP server for integration tests.
 *
 * Returns canned responses for the ASP endpoints that read-only commands
 * (activity, stats, pools, status --check-asp) call.
 *
 * Because integration tests use spawnSync (which blocks the event loop),
 * the server MUST run in a separate process.  Use `launchFixtureServer()`
 * to start a detached server subprocess and `killFixtureServer()` to stop it.
 *
 * When this file is executed directly (`bun test/helpers/fixture-server.ts`),
 * it starts the server and prints `FIXTURE_PORT=<port>` to stdout.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";
import { buildChildProcessEnv } from "./child-env.ts";

// ── Canned response data ─────────────────────────────────────────────────────

const POOLS_STATS: object[] = [1, 10, 42161, 11155111, 11155420].map((chainId) => ({
  scope: "12345",
  chainId,
  tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  tokenSymbol: "ETH",
  totalInPoolValue: "5000000000000000000",
  totalDepositsValue: "10000000000000000000",
  acceptedDepositsValue: "8000000000000000000",
  pendingDepositsValue: "2000000000000000000",
  totalDepositsCount: 42,
  acceptedDepositsCount: 35,
  pendingDepositsCount: 7,
  growth24h: 0.05,
}));

const GLOBAL_EVENTS = {
  events: [
    {
      type: "deposit",
      txHash: "0xabc1230000000000000000000000000000000000000000000000000000000001",
      timestamp: 1700000000,
      amount: "1000000000000000000",
      reviewStatus: "accepted",
      pool: {
        chainId: 11155111,
        poolAddress: "0x1234567890abcdef1234567890abcdef12345678",
        tokenSymbol: "ETH",
        denomination: "18",
      },
    },
  ],
  page: 1,
  perPage: 12,
  total: 1,
  totalPages: 1,
};

const GLOBAL_STATISTICS = {
  allTime: {
    tvl: "50000000000000000000",
    tvlUsd: "150000",
    totalDepositsCount: 100,
    totalDepositsValue: "200000000000000000000",
    totalDepositsValueUsd: "600000",
    totalWithdrawalsCount: 50,
    totalWithdrawalsValue: "100000000000000000000",
    totalWithdrawalsValueUsd: "300000",
  },
  last24h: {
    totalDepositsCount: 5,
    totalDepositsValue: "10000000000000000000",
    totalWithdrawalsCount: 2,
    totalWithdrawalsValue: "4000000000000000000",
  },
  cacheTimestamp: "2025-01-01T00:00:00.000Z",
};

const POOL_STATISTICS = {
  pool: {
    scope: "12345",
    chainId: "11155111",
    tokenSymbol: "ETH",
    tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    tokenDecimals: 18,
    allTime: GLOBAL_STATISTICS.allTime,
    last24h: GLOBAL_STATISTICS.last24h,
  },
  cacheTimestamp: GLOBAL_STATISTICS.cacheTimestamp,
};

const LIVENESS = { status: "ok" };

const MT_LEAVES = {
  aspLeaves: ["1"],
  stateTreeLeaves: [],
};

const SEPOLIA_ENTRYPOINT =
  "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb" as Address;
const FIXTURE_POOL =
  "0x1234567890abcdef1234567890abcdef12345678" as Address;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// ── Routing ──────────────────────────────────────────────────────────────────

function route(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;

  let body: unknown;

  if (path.match(/\/\d+\/public\/pools-stats$/)) {
    body = POOLS_STATS;
  } else if (path.match(/\/\d+\/public\/deposits-by-label$/)) {
    const labelsHeader = firstHeaderValue(req.headers["x-labels"]);
    const labels = labelsHeader?.split(",").map((label) => label.trim()).filter(Boolean) ?? [];
    body = labels.map((label) => ({
      label,
      reviewStatus: MT_LEAVES.aspLeaves.includes(label) ? "approved" : "pending",
    }));
  } else if (path.match(/\/global\/public\/events$/) || path.match(/\/\d+\/public\/events$/)) {
    const page = Number(url.searchParams.get("page") ?? 1);
    const perPage = Number(url.searchParams.get("perPage") ?? GLOBAL_EVENTS.perPage);
    body = { ...GLOBAL_EVENTS, page, perPage };
  } else if (path.match(/\/global\/public\/statistics$/)) {
    body = GLOBAL_STATISTICS;
  } else if (path.match(/\/\d+\/public\/pool-statistics$/)) {
    body = POOL_STATISTICS;
  } else if (path.match(/\/\d+\/public\/mt-leaves$/)) {
    body = MT_LEAVES;
  } else if (path.match(/\/\d+\/health\/liveness$/)) {
    body = LIVENESS;
  }

  if (body !== undefined) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  } else if (req.method === "POST") {
    let requestBody = "";
    req.on("data", (chunk) => {
      requestBody += chunk.toString();
    });
    req.on("end", () => {
      const json = JSON.parse(requestBody || "{}");
      const method = String(json.method ?? "");
      const id = json.id ?? 1;

      if (method === "eth_chainId") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: "0xaa36a7",
        }));
        return;
      }

      if (method === "eth_call") {
        const call = json?.params?.[0] ?? {};
        const to = String(call.to ?? "").toLowerCase();
        const data = String(call.data ?? "").toLowerCase();
        let result = "0x";

        // assetConfig(address)
        if (to === SEPOLIA_ENTRYPOINT.toLowerCase() && data.startsWith("0xd6dbaf58")) {
          result = encodeAbiParameters(
            [
              { type: "address" },
              { type: "uint256" },
              { type: "uint256" },
              { type: "uint256" },
            ],
            [FIXTURE_POOL, 1000000000000000n, 50n, 250n],
          );
        // SCOPE()
        } else if (to === FIXTURE_POOL.toLowerCase()) {
          result = encodeAbiParameters([{ type: "uint256" }], [12345n]);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result,
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      }));
    });
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
}

// ── Subprocess launcher (for use from test files) ────────────────────────────

export interface FixtureServer {
  proc: ChildProcess;
  port: number;
  url: string;
}

/**
 * Launch the fixture server in a separate background process.
 * Returns once the server prints its port to stdout.
 */
export function launchFixtureServer(): Promise<FixtureServer> {
  const script = resolve(import.meta.dir, "fixture-server.ts");

  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", script], {
      stdio: ["ignore", "pipe", "ignore"],
      detached: false,
      env: buildChildProcessEnv(),
    });

    let output = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Fixture server did not start within 10s"));
    }, 10_000);

    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/FIXTURE_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = Number(match[1]);
        resolve({ proc, port, url: `http://127.0.0.1:${port}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture server exited early with code ${code}`));
    });
  });
}

/**
 * Stop a fixture server launched by `launchFixtureServer`.
 */
export function killFixtureServer(fixture: FixtureServer): void {
  fixture.proc.kill();
}

// ── Direct execution: start server and print port ────────────────────────────

// When executed directly, start the server
if (import.meta.main) {
  const server = createServer(route);
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    // This line is parsed by launchFixtureServer()
    process.stdout.write(`FIXTURE_PORT=${addr.port}\n`);
  });
}
