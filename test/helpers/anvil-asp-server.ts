import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http } from "viem";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { buildChildProcessEnv } from "./child-env.ts";
import {
  isDirectEntrypoint,
  nodeExecutable,
  tsxEntrypointArgs,
} from "./node-runtime.ts";
import {
  registerProcessExitCleanup,
  terminateChildProcess,
} from "./process.ts";

export interface AnvilAspState {
  chainId: number;
  rpcUrl: string;
  entrypoint: `0x${string}`;
  pools: AnvilAspPoolState[];
}

export interface AnvilAspPoolState {
  scope: string;
  poolAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  symbol: string;
  decimals?: number;
  baseStateTreeLeaves: string[];
  insertedStateTreeLeaves: string[];
  approvedLabels: string[];
  reviewStatuses: Record<string, string>;
}

export interface AnvilAspServer {
  proc: ChildProcess;
  port: number;
  url: string;
  cleanup?: () => void;
}

const entrypointLatestRootAbi = [
  {
    name: "latestRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function writeAnvilAspState(path: string, state: AnvilAspState): void {
  writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
}

function readAnvilAspState(path: string): AnvilAspState {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as
    | AnvilAspState
    | (Omit<AnvilAspState, "pools"> & AnvilAspPoolState);

  if ("pools" in parsed && Array.isArray(parsed.pools)) {
    return parsed;
  }

  return {
    chainId: parsed.chainId,
    rpcUrl: parsed.rpcUrl,
    entrypoint: parsed.entrypoint,
    pools: [
      {
        scope: parsed.scope,
        poolAddress: parsed.poolAddress,
        assetAddress: parsed.assetAddress,
        symbol: parsed.symbol,
        baseStateTreeLeaves: parsed.baseStateTreeLeaves,
        insertedStateTreeLeaves: parsed.insertedStateTreeLeaves,
        approvedLabels: parsed.approvedLabels,
        reviewStatuses: parsed.reviewStatuses,
      },
    ],
  };
}

function firstHeaderValue(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function allStateTreeLeaves(pool: AnvilAspPoolState): string[] {
  return [...pool.baseStateTreeLeaves, ...pool.insertedStateTreeLeaves];
}

function findPoolState(
  state: AnvilAspState,
  scopeHeader: string | undefined,
): AnvilAspPoolState | null {
  if (!scopeHeader) return null;
  return state.pools.find((pool) => pool.scope === scopeHeader) ?? null;
}

function computeMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    throw new Error("Cannot compute a Merkle root for an empty leaf set");
  }

  const normalized = leaves.map((leaf) => BigInt(leaf));
  const proof = generateMerkleProof(normalized, normalized[normalized.length - 1]);
  return BigInt((proof as { root: bigint | string }).root).toString();
}

async function latestRoot(state: AnvilAspState): Promise<string> {
  const client = createPublicClient({
    transport: http(state.rpcUrl),
  });

  const root = await client.readContract({
    address: state.entrypoint,
    abi: entrypointLatestRootAbi,
    functionName: "latestRoot",
  });

  return BigInt(root as bigint).toString();
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  stateFile: string
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const state = readAnvilAspState(stateFile);
  const path = url.pathname;

  let body: unknown;

  if (path === `/${state.chainId}/public/pools-stats`) {
    body = state.pools.map((pool) => ({
      scope: pool.scope,
      chainId: state.chainId,
      tokenAddress: pool.assetAddress,
      tokenSymbol: pool.symbol,
      totalInPoolValue: "0",
      totalDepositsValue: "0",
      acceptedDepositsValue: "0",
      pendingDepositsValue: "0",
      totalDepositsCount: allStateTreeLeaves(pool).length,
      acceptedDepositsCount: pool.approvedLabels.length,
      pendingDepositsCount: 0,
      growth24h: 0,
      pendingGrowth24h: 0,
    }));
  } else if (path === `/${state.chainId}/public/deposits-by-label`) {
    const labelsHeader = firstHeaderValue(req.headers["x-labels"]);
    const labels = labelsHeader?.split(",").map((label) => label.trim()).filter(Boolean) ?? [];
    body = labels.map((label) => ({
      label,
      reviewStatus: state.pools
        .map((pool) =>
          pool.reviewStatuses[label]
          ?? (pool.approvedLabels.includes(label) ? "approved" : null))
        .find((status) => status !== null)
        ?? "pending",
    }));
  } else if (path === `/${state.chainId}/public/mt-leaves`) {
    const scopeHeader = firstHeaderValue(req.headers["x-pool-scope"]);
    const pool = findPoolState(state, scopeHeader);
    if (!pool) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Unknown X-Pool-Scope=${scopeHeader ?? "<missing>"}`,
      }));
      return;
    }
    body = {
      aspLeaves: pool.approvedLabels,
      stateTreeLeaves: allStateTreeLeaves(pool),
    };
  } else if (path === `/${state.chainId}/public/mt-roots`) {
    const scopeHeader = firstHeaderValue(req.headers["x-pool-scope"]);
    const pool = findPoolState(state, scopeHeader);
    if (!pool) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Unknown X-Pool-Scope=${scopeHeader ?? "<missing>"}`,
      }));
      return;
    }
    const onchainMtRoot = await latestRoot(state);
    body = {
      mtRoot: pool.approvedLabels.length > 0
        ? computeMerkleRoot(pool.approvedLabels)
        : onchainMtRoot,
      onchainMtRoot,
      createdAt: new Date().toISOString(),
    };
  } else if (path === `/${state.chainId}/public/deposits-larger-than`) {
    const scopeHeader = firstHeaderValue(req.headers["x-pool-scope"]);
    const pool = findPoolState(state, scopeHeader);
    if (!pool) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Unknown X-Pool-Scope=${scopeHeader ?? "<missing>"}`,
      }));
      return;
    }
    const totalDeposits = allStateTreeLeaves(pool).length;
    body = {
      eligibleDeposits: totalDeposits,
      totalDeposits,
      percentage: totalDeposits === 0 ? 0 : 100,
    };
  } else if (path === `/${state.chainId}/health/liveness`) {
    body = { status: "ok" };
  }

  if (body === undefined) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function launchAnvilAspServer(
  stateFile: string
): Promise<AnvilAspServer> {
  const script = resolve(import.meta.dir, "anvil-asp-server.ts");

  return new Promise((resolveLaunch, reject) => {
    const proc = spawn(nodeExecutable(), tsxEntrypointArgs(script), {
      env: buildChildProcessEnv({
        PP_ANVIL_ASP_STATE_FILE: stateFile,
      }),
      stdio: ["ignore", "pipe", "ignore"],
    });
    const cleanupProcessExit = registerProcessExitCleanup(proc);

    let output = "";
    const timeout = setTimeout(() => {
      cleanupStartupListeners();
      void terminateChildProcess(proc)
        .catch(() => undefined)
        .finally(() => {
          cleanupProcessExit();
          reject(new Error("Anvil ASP server did not start within 10s"));
        });
    }, 10_000);

    const handleError = (error: Error) => {
      clearTimeout(timeout);
      cleanupStartupListeners();
      cleanupProcessExit();
      reject(error);
    };

    const handleExit = (code: number | null) => {
      clearTimeout(timeout);
      cleanupStartupListeners();
      cleanupProcessExit();
      reject(new Error(`Anvil ASP server exited early with code ${code}`));
    };

    const cleanupStartupListeners = () => {
      proc.off("error", handleError);
      proc.off("exit", handleExit);
    };

    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/ANVIL_ASP_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        cleanupStartupListeners();
        const port = Number(match[1]);
        proc.stdout?.removeAllListeners("data");
        proc.stdout?.destroy();
        proc.unref();
        resolveLaunch({
          proc,
          port,
          url: `http://127.0.0.1:${port}`,
          cleanup: cleanupProcessExit,
        });
      }
    });

    proc.on("error", handleError);
    proc.on("exit", handleExit);
  });
}

export async function killAnvilAspServer(server: AnvilAspServer): Promise<void> {
  server.cleanup?.();
  await terminateChildProcess(server.proc);
}

if (isDirectEntrypoint(import.meta.url)) {
  const stateFile = process.env.PP_ANVIL_ASP_STATE_FILE?.trim();

  if (!stateFile) {
    throw new Error("PP_ANVIL_ASP_STATE_FILE is required");
  }

  const server = createServer((req, res) => {
    route(req, res, stateFile).catch((error) => {
      res.writeHead(500);
      res.end(error instanceof Error ? error.message : String(error));
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind Anvil ASP server");
    }
    process.stdout.write(`ANVIL_ASP_PORT=${address.port}\n`);
  });
}
