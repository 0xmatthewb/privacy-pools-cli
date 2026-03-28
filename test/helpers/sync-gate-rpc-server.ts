import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
} from "viem";
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

const entrypointAbi = parseAbi([
  "function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)",
]);

const poolAbi = parseAbi([
  "function SCOPE() view returns (uint256)",
]);

const depositEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

const depositTopic0 = encodeEventTopics({
  abi: depositEventAbi,
  eventName: "Deposited",
})[0];

interface SyncGateRpcConfig {
  chainId: number;
  entrypoint: `0x${string}`;
  poolAddress: `0x${string}`;
  scope: bigint;
  assetAddress?: `0x${string}`;
  assetSymbol?: string;
  assetDecimals?: number;
  gasPrice?: bigint;
  nativeBalance?: bigint;
  tokenBalance?: bigint;
  blockNumber?: bigint;
  minimumDepositAmount?: bigint;
  vettingFeeBPS?: bigint;
  maxRelayFeeBPS?: bigint;
  minFromBlock?: bigint;
  validDepositLog?: boolean;
  depositCommitment?: bigint;
  depositLabel?: bigint;
  depositValue?: bigint;
  depositPrecommitment?: bigint;
}

export interface SyncGateRpcServer {
  proc: ChildProcess;
  port: number;
  url: string;
  cleanup?: () => void;
}

function parseConfigFromEnv(): SyncGateRpcConfig {
  const chainId = Number(process.env.PP_SYNC_RPC_CHAIN_ID ?? "");
  const entrypoint = process.env.PP_SYNC_RPC_ENTRYPOINT as `0x${string}` | undefined;
  const poolAddress = process.env.PP_SYNC_RPC_POOL as `0x${string}` | undefined;
  const scopeRaw = process.env.PP_SYNC_RPC_SCOPE;

  if (!Number.isInteger(chainId) || !entrypoint || !poolAddress || !scopeRaw) {
    throw new Error("Missing sync-gate RPC server configuration");
  }

  return {
    chainId,
    entrypoint,
    poolAddress,
    scope: BigInt(scopeRaw),
    assetAddress: process.env.PP_SYNC_RPC_ASSET as `0x${string}` | undefined,
    assetSymbol: process.env.PP_SYNC_RPC_SYMBOL ?? undefined,
    assetDecimals: Number(process.env.PP_SYNC_RPC_DECIMALS ?? "18"),
    gasPrice: BigInt(process.env.PP_SYNC_RPC_GAS_PRICE ?? "1"),
    nativeBalance: BigInt(process.env.PP_SYNC_RPC_NATIVE_BALANCE ?? "0"),
    tokenBalance: BigInt(process.env.PP_SYNC_RPC_TOKEN_BALANCE ?? "0"),
    blockNumber: BigInt(process.env.PP_SYNC_RPC_BLOCK_NUMBER ?? "10000000"),
    minimumDepositAmount: BigInt(process.env.PP_SYNC_RPC_MIN_DEPOSIT ?? "1"),
    vettingFeeBPS: BigInt(process.env.PP_SYNC_RPC_VETTING_FEE_BPS ?? "0"),
    maxRelayFeeBPS: BigInt(process.env.PP_SYNC_RPC_MAX_RELAY_FEE_BPS ?? "300"),
    minFromBlock: process.env.PP_SYNC_RPC_MIN_FROM_BLOCK
      ? BigInt(process.env.PP_SYNC_RPC_MIN_FROM_BLOCK)
      : undefined,
    validDepositLog: process.env.PP_SYNC_RPC_VALID_DEPOSIT_LOG === "true",
    depositCommitment: process.env.PP_SYNC_RPC_DEPOSIT_COMMITMENT
      ? BigInt(process.env.PP_SYNC_RPC_DEPOSIT_COMMITMENT)
      : undefined,
    depositLabel: process.env.PP_SYNC_RPC_DEPOSIT_LABEL
      ? BigInt(process.env.PP_SYNC_RPC_DEPOSIT_LABEL)
      : undefined,
    depositValue: process.env.PP_SYNC_RPC_DEPOSIT_VALUE
      ? BigInt(process.env.PP_SYNC_RPC_DEPOSIT_VALUE)
      : undefined,
    depositPrecommitment: process.env.PP_SYNC_RPC_DEPOSIT_PRECOMMITMENT
      ? BigInt(process.env.PP_SYNC_RPC_DEPOSIT_PRECOMMITMENT)
      : undefined,
  };
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function writeRpcResult(
  res: ServerResponse,
  id: unknown,
  result: unknown
): void {
  writeJson(res, 200, {
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeRpcError(
  res: ServerResponse,
  id: unknown,
  code: number,
  message: string
): void {
  writeJson(res, 200, {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: SyncGateRpcConfig
): Promise<void> {
  if (req.method !== "POST") {
    writeJson(res, 405, { message: "Method Not Allowed" });
    return;
  }

  const bodyText = await readBody(req);
  const payload = bodyText
    ? JSON.parse(bodyText) as {
      id?: unknown;
      method?: string;
      params?: unknown[];
    }
    : {};
  const id = payload.id ?? null;

  switch (payload.method) {
    case "eth_chainId":
      writeRpcResult(res, id, `0x${config.chainId.toString(16)}`);
      return;

    case "eth_blockNumber":
      writeRpcResult(
        res,
        id,
        `0x${(config.blockNumber ?? 10000000n).toString(16)}`
      );
      return;

    case "eth_gasPrice":
      writeRpcResult(res, id, `0x${(config.gasPrice ?? 1n).toString(16)}`);
      return;

    case "eth_getBalance":
      writeRpcResult(
        res,
        id,
        `0x${(config.nativeBalance ?? 0n).toString(16)}`
      );
      return;

    case "eth_call": {
      const call = Array.isArray(payload.params)
        ? payload.params[0] as { to?: string; data?: string } | undefined
        : undefined;
      const to = call?.to?.toLowerCase();
      const data = call?.data;

      if (!to || typeof data !== "string") {
        writeRpcError(res, id, -32602, "Invalid eth_call params");
        return;
      }

      if (to === config.entrypoint.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: entrypointAbi, data });
        if (decoded.functionName !== "assetConfig") {
          writeRpcError(res, id, -32601, "Unsupported entrypoint call");
          return;
        }
        writeRpcResult(
          res,
          id,
          encodeFunctionResult({
            abi: entrypointAbi,
            functionName: "assetConfig",
            result: [
              config.poolAddress,
              config.minimumDepositAmount ?? 1n,
              config.vettingFeeBPS ?? 0n,
              config.maxRelayFeeBPS ?? 300n,
            ],
          })
        );
        return;
      }

      if (to === config.poolAddress.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: poolAbi, data });
        if (decoded.functionName !== "SCOPE") {
          writeRpcError(res, id, -32601, "Unsupported pool call");
          return;
        }
        writeRpcResult(
          res,
          id,
          encodeFunctionResult({
            abi: poolAbi,
            functionName: "SCOPE",
            result: [config.scope],
          })
        );
        return;
      }

      if (config.assetAddress && to === config.assetAddress.toLowerCase()) {
        if (data.startsWith("0x70a08231")) {
          writeRpcResult(
            res,
            id,
            encodeAbiParameters([{ type: "uint256" }], [config.tokenBalance ?? 0n])
          );
          return;
        }

        if (data.startsWith("0x95d89b41")) {
          writeRpcResult(
            res,
            id,
            encodeAbiParameters([{ type: "string" }], [config.assetSymbol ?? "TOKEN"])
          );
          return;
        }

        if (data.startsWith("0x313ce567")) {
          writeRpcResult(
            res,
            id,
            encodeAbiParameters([{ type: "uint8" }], [config.assetDecimals ?? 18])
          );
          return;
        }
      }

      writeRpcError(res, id, -32601, `Unsupported eth_call target ${to}`);
      return;
    }

    case "eth_getLogs":
      {
        const request = Array.isArray(payload.params)
          ? payload.params[0] as { topics?: string[]; fromBlock?: string } | undefined
          : undefined;
        const topic0 = Array.isArray(request?.topics)
          ? request?.topics[0]?.toLowerCase()
          : undefined;
        const fromBlockRaw = request?.fromBlock;
        const fromBlock = typeof fromBlockRaw === "string"
          ? BigInt(fromBlockRaw)
          : undefined;

        if (
          config.minFromBlock !== undefined
          && (fromBlock === undefined || fromBlock < config.minFromBlock)
        ) {
          writeRpcError(
            res,
            id,
            -32000,
            `fromBlock below allowed minimum ${config.minFromBlock.toString()}`
          );
          return;
        }

        if (topic0 === depositTopic0?.toLowerCase()) {
          const depositData = config.depositCommitment !== undefined
            && config.depositLabel !== undefined
            && config.depositValue !== undefined
            && config.depositPrecommitment !== undefined
            ? [
              config.depositCommitment,
              config.depositLabel,
              config.depositValue,
              config.depositPrecommitment,
            ]
            : config.validDepositLog
              ? [1n, 2n, 3n, 4n]
              : [1n, 0n, 1n, 0n];
          writeRpcResult(res, id, [{
            address: config.poolAddress,
            blockHash: `0x${"11".repeat(32)}`,
            blockNumber: `0x${(config.blockNumber ?? 10000000n).toString(16)}`,
            data: encodeAbiParameters(
              [
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              depositData
            ),
            logIndex: "0x0",
            removed: false,
            topics: encodeEventTopics({
              abi: depositEventAbi,
              eventName: "Deposited",
              args: {
                _depositor: "0x1111111111111111111111111111111111111111",
              },
            }),
            transactionHash: `0x${"22".repeat(32)}`,
            transactionIndex: "0x0",
          }]);
          return;
        }

        writeRpcResult(res, id, []);
      }
      return;

    default:
      writeRpcError(
        res,
        id,
        -32601,
        `Unsupported JSON-RPC method ${payload.method ?? "<missing>"}`
      );
  }
}

export function launchSyncGateRpcServer(
  config: SyncGateRpcConfig
): Promise<SyncGateRpcServer> {
  const script = resolve(import.meta.dir, "sync-gate-rpc-server.ts");

  return new Promise((resolvePromise, reject) => {
    const proc = spawn(nodeExecutable(), tsxEntrypointArgs(script), {
      stdio: ["ignore", "pipe", "ignore"],
      detached: false,
      env: buildChildProcessEnv({
        PP_SYNC_RPC_CHAIN_ID: String(config.chainId),
        PP_SYNC_RPC_ENTRYPOINT: config.entrypoint,
        PP_SYNC_RPC_POOL: config.poolAddress,
        PP_SYNC_RPC_SCOPE: config.scope.toString(),
        PP_SYNC_RPC_ASSET: config.assetAddress,
        PP_SYNC_RPC_SYMBOL: config.assetSymbol,
        PP_SYNC_RPC_DECIMALS: config.assetDecimals === undefined
          ? undefined
          : String(config.assetDecimals),
        PP_SYNC_RPC_GAS_PRICE: config.gasPrice?.toString(),
        PP_SYNC_RPC_NATIVE_BALANCE: config.nativeBalance?.toString(),
        PP_SYNC_RPC_TOKEN_BALANCE: config.tokenBalance?.toString(),
        PP_SYNC_RPC_BLOCK_NUMBER: String(config.blockNumber ?? 10000000n),
        PP_SYNC_RPC_MIN_DEPOSIT: String(config.minimumDepositAmount ?? 1n),
        PP_SYNC_RPC_VETTING_FEE_BPS: String(config.vettingFeeBPS ?? 0n),
        PP_SYNC_RPC_MAX_RELAY_FEE_BPS: String(config.maxRelayFeeBPS ?? 300n),
        PP_SYNC_RPC_MIN_FROM_BLOCK: config.minFromBlock?.toString(),
        PP_SYNC_RPC_VALID_DEPOSIT_LOG: config.validDepositLog ? "true" : undefined,
        PP_SYNC_RPC_DEPOSIT_COMMITMENT: config.depositCommitment?.toString(),
        PP_SYNC_RPC_DEPOSIT_LABEL: config.depositLabel?.toString(),
        PP_SYNC_RPC_DEPOSIT_VALUE: config.depositValue?.toString(),
        PP_SYNC_RPC_DEPOSIT_PRECOMMITMENT: config.depositPrecommitment?.toString(),
      }),
    });
    const cleanupProcessExit = registerProcessExitCleanup(proc);

    let output = "";
    const timeout = setTimeout(() => {
      cleanupProcessExit();
      proc.kill();
      reject(new Error("Sync-gate RPC server did not start within 10s"));
    }, 10_000);

    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/SYNC_GATE_RPC_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        const port = Number(match[1]);
        proc.stdout?.removeAllListeners("data");
        proc.stdout?.destroy();
        proc.unref();
        resolvePromise({
          proc,
          port,
          url: `http://127.0.0.1:${port}`,
          cleanup: cleanupProcessExit,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      cleanupProcessExit();
      reject(err);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      cleanupProcessExit();
      reject(new Error(`Sync-gate RPC server exited early with code ${code}`));
    });
  });
}

export async function killSyncGateRpcServer(
  server: SyncGateRpcServer
): Promise<void> {
  server.cleanup?.();
  await terminateChildProcess(server.proc);
}

if (isDirectEntrypoint(import.meta.url)) {
  const config = parseConfigFromEnv();
  const server = createServer((req, res) => {
    route(req, res, config).catch((error) => {
      writeJson(res, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    process.stdout.write(`SYNC_GATE_RPC_PORT=${addr.port}\n`);
  });
}
