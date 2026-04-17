/**
 * Lightweight ASP fixture HTTP server for integration tests.
 *
 * Returns canned responses for the ASP endpoints that read-only commands
 * (activity, stats, pools, status --check-asp) call, plus a lightweight
 * relayer fixture for withdraw quote integration tests.
 *
 * Because integration tests use spawnSync (which blocks the event loop),
 * the server MUST run in a separate process.  Use `launchFixtureServer()`
 * to start a detached server subprocess and `killFixtureServer()` to stop it.
 *
 * When this file is executed directly (`node --import tsx test/helpers/fixture-server.ts`),
 * it starts the server and prints `FIXTURE_PORT=<port>` to stdout.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { encodeAbiParameters, type Address } from "viem";
import { buildChildProcessEnv } from "./child-env.ts";
import {
  isDirectEntrypoint,
  nodeExecutable,
  tsxEntrypointArgs,
} from "./node-runtime.ts";
import { encodeRelayerWithdrawalData } from "./relayer-withdrawal-data.ts";
import {
  registerProcessExitCleanup,
  terminateChildProcess,
} from "./process.ts";

const FIXTURE_SERVER_START_TIMEOUT_MS = 20_000;
const FIXTURE_SERVER_READY_TIMEOUT_MS = 5_000;

// ── Canned response data ─────────────────────────────────────────────────────

interface ChainPoolFixture {
  chainId: number;
  entrypoint: Address;
  asset: Address;
  pool: Address;
  symbol: string;
  decimals: number;
  scope: bigint;
}

const FIXTURE_NATIVE_ASSET =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const MAINNET_ENTRYPOINT =
  "0x6818809eefce719e480a7526d76bd3e561526b46" as Address;
const MAINNET_POOL =
  "0x1111111111111111111111111111111111111111" as Address;
const ARBITRUM_ENTRYPOINT =
  "0x44192215fed782896be2ce24e0bfbf0bf825d15e" as Address;
const ARBITRUM_USDC =
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
const ARBITRUM_POOL =
  "0x2222222222222222222222222222222222222222" as Address;
const OPTIMISM_ENTRYPOINT =
  "0x44192215fed782896be2ce24e0bfbf0bf825d15e" as Address;
const OPTIMISM_USDC =
  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as Address;
const OPTIMISM_POOL =
  "0x3333333333333333333333333333333333333333" as Address;

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

const MT_ROOTS = {
  mtRoot: "0",
  createdAt: "2026-04-17T00:00:00.000Z",
  onchainMtRoot: "0",
};

const SEPOLIA_ENTRYPOINT =
  "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb" as Address;
const FIXTURE_POOL =
  "0x1234567890abcdef1234567890abcdef12345678" as Address;
const FIXTURE_ASSET =
  FIXTURE_NATIVE_ASSET;
const OP_SEPOLIA_ENTRYPOINT =
  "0x54aca0d27500669fa37867233e05423701f11ba1" as Address;
const OP_SEPOLIA_ASSET =
  "0x4200000000000000000000000000000000000006" as Address;
const OP_SEPOLIA_POOL =
  "0x4444444444444444444444444444444444444444" as Address;
const FIXTURE_FEE_RECEIVER =
  "0x00000000000000000000000000000000000000fe" as Address;
const RELAYER_SECONDS_RECIPIENT =
  "0x0000000000000000000000000000000000000001";
const RELAYER_MALFORMED_FEE_RECIPIENT =
  "0x0000000000000000000000000000000000000002";

const CHAIN_POOL_FIXTURES = new Map<number, ChainPoolFixture>([
  [1, {
    chainId: 1,
    entrypoint: MAINNET_ENTRYPOINT,
    asset: FIXTURE_NATIVE_ASSET,
    pool: MAINNET_POOL,
    symbol: "ETH",
    decimals: 18,
    scope: 12345n,
  }],
  [10, {
    chainId: 10,
    entrypoint: OPTIMISM_ENTRYPOINT,
    asset: OPTIMISM_USDC,
    pool: OPTIMISM_POOL,
    symbol: "USDC",
    decimals: 6,
    scope: 22345n,
  }],
  [42161, {
    chainId: 42161,
    entrypoint: ARBITRUM_ENTRYPOINT,
    asset: ARBITRUM_USDC,
    pool: ARBITRUM_POOL,
    symbol: "USDC",
    decimals: 6,
    scope: 32345n,
  }],
  [11155111, {
    chainId: 11155111,
    entrypoint: SEPOLIA_ENTRYPOINT,
    asset: FIXTURE_ASSET,
    pool: FIXTURE_POOL,
    symbol: "ETH",
    decimals: 18,
    scope: 12345n,
  }],
  [11155420, {
    chainId: 11155420,
    entrypoint: OP_SEPOLIA_ENTRYPOINT,
    asset: OP_SEPOLIA_ASSET,
    pool: OP_SEPOLIA_POOL,
    symbol: "WETH",
    decimals: 18,
    scope: 42345n,
  }],
]);

function poolStatsForChain(chainId: number): object[] {
  const fixture = CHAIN_POOL_FIXTURES.get(chainId);
  if (!fixture) {
    return [];
  }

  const sampleWholeUnits = fixture.decimals === 6 ? 5_000_000n : 5n;
  const sampleDepositsWholeUnits = fixture.decimals === 6 ? 10_000_000n : 10n;
  const sampleAcceptedWholeUnits = fixture.decimals === 6 ? 8_000_000n : 8n;
  const samplePendingWholeUnits = fixture.decimals === 6 ? 2_000_000n : 2n;
  const scaleAmount = (wholeUnits: bigint) =>
    (wholeUnits * 10n ** BigInt(fixture.decimals)).toString();

  return [{
    scope: fixture.scope.toString(),
    chainId: fixture.chainId,
    poolAddress: fixture.pool,
    tokenAddress: fixture.asset,
    tokenSymbol: fixture.symbol,
    totalInPoolValue: scaleAmount(sampleWholeUnits),
    totalDepositsValue: scaleAmount(sampleDepositsWholeUnits),
    acceptedDepositsValue: scaleAmount(sampleAcceptedWholeUnits),
    pendingDepositsValue: scaleAmount(samplePendingWholeUnits),
    totalDepositsCount: 42,
    acceptedDepositsCount: 35,
    pendingDepositsCount: 7,
    growth24h: 0.05,
  }];
}

function chainIdFromPublicPath(
  path: string,
  endpoint: "pools-stats" | "pool-statistics",
): number | null {
  const match = path.match(new RegExp(`^/(\\d+)/public/${endpoint}$`));
  if (!match) {
    return null;
  }

  const chainId = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(chainId) ? chainId : null;
}

function findFixtureByEntrypointAndAsset(
  entrypoint: string,
  assetAddress: string,
): ChainPoolFixture | undefined {
  const normalizedEntrypoint = entrypoint.toLowerCase();
  const normalizedAsset = assetAddress.toLowerCase();
  return [...CHAIN_POOL_FIXTURES.values()].find((fixture) =>
    fixture.entrypoint.toLowerCase() === normalizedEntrypoint
    && fixture.asset.toLowerCase() === normalizedAsset,
  );
}

function findFixtureByPoolAddress(poolAddress: string): ChainPoolFixture | undefined {
  const normalizedPool = poolAddress.toLowerCase();
  return [...CHAIN_POOL_FIXTURES.values()].find((fixture) =>
    fixture.pool.toLowerCase() === normalizedPool,
  );
}

function findFixtureByAssetAddress(assetAddress: string): ChainPoolFixture | undefined {
  const normalizedAsset = assetAddress.toLowerCase();
  return [...CHAIN_POOL_FIXTURES.values()].find((fixture) =>
    fixture.asset.toLowerCase() === normalizedAsset,
  );
}

function decodeAddressCallArgument(data: string): string | null {
  const normalized = data.startsWith("0x") ? data.slice(2) : data;
  if (normalized.length < 64) {
    return null;
  }

  return `0x${normalized.slice(-40)}`.toLowerCase();
}

function buildRelayerQuote(request: {
  amount: string;
  asset: string;
  extraGas: boolean;
  recipient?: string;
}) {
  const normalizedRecipient = request.recipient?.toLowerCase();
  if (normalizedRecipient === RELAYER_MALFORMED_FEE_RECIPIENT.toLowerCase()) {
    return {
      baseFeeBPS: "250",
      feeBPS: "oops",
      gasPrice: "1",
      detail: {
        relayTxCost: {
          gas: "0",
          eth: "0",
        },
      },
      feeCommitment: {
        expiration: 4_102_444_800_000,
        withdrawalData: encodeRelayerWithdrawalData({
          recipient:
            (request.recipient as Address | undefined) ??
            (RELAYER_MALFORMED_FEE_RECIPIENT as Address),
          feeRecipient: FIXTURE_FEE_RECEIVER,
          relayFeeBPS: 250n,
        }),
        asset: request.asset,
        amount: request.amount,
        extraGas: request.extraGas,
        signedRelayerCommitment: "0x01",
      },
    };
  }

  const expiration =
    normalizedRecipient === RELAYER_SECONDS_RECIPIENT.toLowerCase()
      ? 4_102_444_800
      : 4_102_444_800_000;

  return {
    baseFeeBPS: "250",
    feeBPS: "250",
    gasPrice: "1",
    detail: {
      relayTxCost: {
        gas: "0",
        eth: "0",
      },
    },
    feeCommitment: {
      expiration,
      withdrawalData: encodeRelayerWithdrawalData({
        recipient:
          (request.recipient as Address | undefined) ??
          (RELAYER_SECONDS_RECIPIENT as Address),
        feeRecipient: FIXTURE_FEE_RECEIVER,
        relayFeeBPS: 250n,
      }),
      asset: request.asset,
      amount: request.amount,
      extraGas: request.extraGas,
      signedRelayerCommitment: "0x01",
    },
  };
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// ── Routing ──────────────────────────────────────────────────────────────────

function route(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://localhost`);
  const path = url.pathname;

  let body: unknown;

  if (req.method === "GET" && path === "/relayer/details") {
    const chainId = url.searchParams.get("chainId");
    const assetAddress = url.searchParams.get("assetAddress");
    if (
      chainId !== "11155111"
      || assetAddress?.toLowerCase() !== FIXTURE_ASSET.toLowerCase()
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected chainId=11155111 and assetAddress=${FIXTURE_ASSET}`,
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      chainId: 11155111,
      feeBPS: "250",
      minWithdrawAmount: "1000000000000000",
      feeReceiverAddress: FIXTURE_FEE_RECEIVER,
      assetAddress: FIXTURE_ASSET,
      maxGasPrice: "1",
    }));
    return;
  }

  const poolsStatsChainId = chainIdFromPublicPath(path, "pools-stats");
  const poolStatisticsChainId = chainIdFromPublicPath(path, "pool-statistics");

  if (poolsStatsChainId !== null) {
    body = poolStatsForChain(poolsStatsChainId);
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
  } else if (poolStatisticsChainId === 11155111) {
    body = POOL_STATISTICS;
  } else if (path.match(/\/\d+\/public\/mt-roots$/)) {
    body = MT_ROOTS;
  } else if (path.match(/\/\d+\/public\/mt-leaves$/)) {
    body = MT_LEAVES;
  } else if (path.match(/\/\d+\/health\/liveness$/)) {
    body = LIVENESS;
  }

  if (body !== undefined) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  } else if (req.method === "POST" && path === "/relayer/quote") {
    let requestBody = "";
    req.on("data", (chunk) => {
      requestBody += chunk.toString();
    });
    req.on("end", () => {
      const json = JSON.parse(requestBody || "{}");
      if (
        String(json.chainId) !== "11155111"
        || String(json.asset).toLowerCase() !== FIXTURE_ASSET.toLowerCase()
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          message: `Expected quote body chainId=11155111 and asset=${FIXTURE_ASSET}`,
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(buildRelayerQuote({
        amount: String(json.amount),
        asset: String(json.asset),
        extraGas: Boolean(json.extraGas),
        recipient: typeof json.recipient === "string" ? json.recipient : undefined,
      })));
    });
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

      if (method === "eth_blockNumber") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: "0x1",
        }));
        return;
      }

      if (method === "eth_call") {
        const call = json?.params?.[0] ?? {};
        const to = String(call.to ?? "").toLowerCase();
        const data = String(call.data ?? "").toLowerCase();
        let result = "0x";
        const assetSelector = "0xd6dbaf58";
        const scopeSelector = "0x33d09200";
        const symbolSelector = "0x95d89b41";
        const decimalsSelector = "0x313ce567";

        // assetConfig(address)
        if (data.startsWith(assetSelector)) {
          const assetAddress = decodeAddressCallArgument(data);
          const fixture = assetAddress
            ? findFixtureByEntrypointAndAsset(to, assetAddress)
            : undefined;
          if (fixture) {
            result = encodeAbiParameters(
              [
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              [fixture.pool, 1000000000000000n, 50n, 250n],
            );
          }
        // SCOPE()
        } else if (data.startsWith(scopeSelector)) {
          const fixture = findFixtureByPoolAddress(to);
          if (fixture) {
            result = encodeAbiParameters([{ type: "uint256" }], [fixture.scope]);
          }
        } else if (data.startsWith(symbolSelector)) {
          const fixture = findFixtureByAssetAddress(to);
          if (fixture) {
            result = encodeAbiParameters([{ type: "string" }], [fixture.symbol]);
          }
        } else if (data.startsWith(decimalsSelector)) {
          const fixture = findFixtureByAssetAddress(to);
          if (fixture) {
            result = encodeAbiParameters([{ type: "uint8" }], [fixture.decimals]);
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result,
        }));
        return;
      }

      if (method === "eth_getLogs") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: [],
        }));
        return;
      }

      if (method === "eth_getBlockByNumber") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            number: "0x1",
            hash: "0x" + "11".repeat(32),
            parentHash: "0x" + "22".repeat(32),
            timestamp: "0x1",
            transactions: [],
          },
        }));
        return;
      }

      if (method === "eth_getTransactionReceipt" || method === "eth_getTransactionByHash") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: null,
        }));
        return;
      }

      if (method === "eth_getCode") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: "0x",
        }));
        return;
      }

      if (method === "net_version") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: "11155111",
        }));
        return;
      }

      if (method === "web3_clientVersion") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: "privacy-pools-fixture/1.0.0",
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
  cleanup?: () => void;
}

async function waitForFixtureReady(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The subprocess may have printed its port just before the listener is reachable.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Fixture server did not become reachable at ${url}`);
}

/**
 * Launch the fixture server in a separate background process.
 * Returns once the server prints its port to stdout.
 */
export function launchFixtureServer(): Promise<FixtureServer> {
  const script = resolve(import.meta.dir, "fixture-server.ts");

  return new Promise((resolve, reject) => {
    const proc = spawn(nodeExecutable(), tsxEntrypointArgs(script), {
      stdio: ["ignore", "pipe", "ignore"],
      detached: false,
      env: buildChildProcessEnv(),
    });
    const cleanupProcessExit = registerProcessExitCleanup(proc);

    let output = "";
    const rejectAfterTermination = (error: Error) => {
      void terminateChildProcess(proc)
        .catch(() => undefined)
        .finally(() => reject(error));
    };
    const timeout = setTimeout(() => {
      cleanupStartupListeners();
      cleanupProcessExit();
      rejectAfterTermination(new Error("Fixture server did not start within 20s"));
    }, FIXTURE_SERVER_START_TIMEOUT_MS);

    const handleError = (err: Error) => {
      clearTimeout(timeout);
      cleanupStartupListeners();
      cleanupProcessExit();
      reject(err);
    };

    const handleExit = (code: number | null) => {
      clearTimeout(timeout);
      cleanupStartupListeners();
      cleanupProcessExit();
      reject(new Error(`Fixture server exited early with code ${code}`));
    };

    const cleanupStartupListeners = () => {
      proc.off("error", handleError);
      proc.off("exit", handleExit);
    };

    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/FIXTURE_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        cleanupStartupListeners();
        const port = Number(match[1]);
        proc.stdout?.removeAllListeners("data");
        proc.stdout?.destroy();
        proc.unref();
        const url = `http://127.0.0.1:${port}`;
        void waitForFixtureReady(url, FIXTURE_SERVER_READY_TIMEOUT_MS)
          .then(() => {
            resolve({
              proc,
              port,
              url,
              cleanup: cleanupProcessExit,
            });
          })
          .catch((error) => {
            cleanupProcessExit();
            rejectAfterTermination(
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      }
    });

    proc.on("error", handleError);
    proc.on("exit", handleExit);
  });
}

/**
 * Stop a fixture server launched by `launchFixtureServer`.
 */
export async function killFixtureServer(fixture: FixtureServer): Promise<void> {
  fixture.cleanup?.();
  await terminateChildProcess(fixture.proc);
}

// ── Direct execution: start server and print port ────────────────────────────

// When executed directly, start the server
if (isDirectEntrypoint(import.meta.url)) {
  const server = createServer(route);
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    // This line is parsed by launchFixtureServer()
    process.stdout.write(`FIXTURE_PORT=${addr.port}\n`);
  });
}
