import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

export interface AnvilRelayerConfig {
  chainId: number;
  rpcUrl: string;
  entrypoint: `0x${string}`;
  relayerPrivateKey: `0x${string}`;
  assets: Array<AnvilRelayerAssetConfig>;
}

export interface AnvilRelayerAssetConfig {
  assetAddress: `0x${string}`;
  feeReceiverAddress: `0x${string}`;
  feeBPS: string;
  minWithdrawAmount: string;
  maxGasPrice: string;
  quoteSequence?: Array<{
    feeBPS?: string;
    expirationOffsetMs?: number;
  }>;
}

export interface AnvilRelayerServer {
  proc: ChildProcess;
  port: number;
  url: string;
  cleanup?: () => void;
}

const entrypointRelayAbi = parseAbi([
  "function relay((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof, uint256 _scope)",
]);

function buildQuoteBody(
  assetConfig: AnvilRelayerAssetConfig,
  quoteRequestIndex: number,
  request: {
    amount: string;
    asset: string;
    extraGas: boolean;
    recipient?: `0x${string}`;
  }
) {
  const quoteStep =
    assetConfig.quoteSequence?.[
      Math.min(quoteRequestIndex, assetConfig.quoteSequence.length - 1)
    ] ?? null;
  const feeBPS = quoteStep?.feeBPS ?? assetConfig.feeBPS;
  const expirationOffsetMs = quoteStep?.expirationOffsetMs ?? 10 * 60 * 1000;

  return {
    baseFeeBPS: feeBPS,
    feeBPS,
    gasPrice: "1",
    detail: {
      relayTxCost: {
        gas: "0",
        eth: "0",
      },
    },
    feeCommitment: {
      expiration: Date.now() + expirationOffsetMs,
      withdrawalData: encodeRelayerWithdrawalData({
        recipient:
          request.recipient ??
          ("0x0000000000000000000000000000000000000001" as const),
        feeRecipient: assetConfig.feeReceiverAddress,
        relayFeeBPS: BigInt(feeBPS),
      }),
      asset: request.asset,
      amount: request.amount,
      extraGas: request.extraGas,
      signedRelayerCommitment: "0x01",
    },
  };
}

function toSolidityProof(body: {
  proof?: {
    pi_a?: [string, string];
    pi_b?: [[string, string], [string, string]];
    pi_c?: [string, string];
  };
  publicSignals?: string[];
}) {
  if (!body.proof?.pi_a || !body.proof.pi_b || !body.proof.pi_c || !body.publicSignals) {
    throw new Error("Malformed relayer proof payload");
  }

  return {
    pA: [
      BigInt(body.proof.pi_a[0]),
      BigInt(body.proof.pi_a[1]),
    ],
    pB: [
      [
        BigInt(body.proof.pi_b[0][1]),
        BigInt(body.proof.pi_b[0][0]),
      ],
      [
        BigInt(body.proof.pi_b[1][1]),
        BigInt(body.proof.pi_b[1][0]),
      ],
    ],
    pC: [
      BigInt(body.proof.pi_c[0]),
      BigInt(body.proof.pi_c[1]),
    ],
    pubSignals: body.publicSignals.map((signal) => BigInt(signal)),
  };
}

function isRelayRevertError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /reverted|execution reverted|contract function "relay" reverted/i.test(
    error.message,
  );
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  state: {
    quoteRequests: number;
    config: AnvilRelayerConfig;
    baselineConfig: AnvilRelayerConfig;
    lastQuoteRequest: Record<string, unknown> | null;
    lastRelayRequest: Record<string, unknown> | null;
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const findAssetConfig = (assetAddress: string | null | undefined) =>
    state.config.assets.find(
      (asset) =>
        asset.assetAddress.toLowerCase() === (assetAddress ?? "").toLowerCase(),
    ) ?? null;

  if (req.method === "GET" && url.pathname === "/__state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      quoteRequests: state.quoteRequests,
      lastQuoteRequest: state.lastQuoteRequest,
      lastRelayRequest: state.lastRelayRequest,
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/__reset") {
    state.quoteRequests = 0;
    state.config = JSON.parse(JSON.stringify(state.baselineConfig)) as AnvilRelayerConfig;
    state.lastQuoteRequest = null;
    state.lastRelayRequest = null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/__configure") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = bodyText ? JSON.parse(bodyText) as Partial<AnvilRelayerConfig> : {};
    state.quoteRequests = 0;
    state.config = {
      ...state.config,
      ...body,
      assets: body.assets ? body.assets : state.config.assets,
    };
    state.lastQuoteRequest = null;
    state.lastRelayRequest = null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/relayer/details") {
    const requestedChainId = url.searchParams.get("chainId");
    const requestedAssetAddress = url.searchParams.get("assetAddress");
    const assetConfig = findAssetConfig(requestedAssetAddress);
    if (
      requestedChainId !== String(state.config.chainId)
      || !assetConfig
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected chainId=${state.config.chainId} and a configured assetAddress`,
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      chainId: state.config.chainId,
      feeBPS: assetConfig.feeBPS,
      minWithdrawAmount: assetConfig.minWithdrawAmount,
      feeReceiverAddress: assetConfig.feeReceiverAddress,
      assetAddress: assetConfig.assetAddress,
      maxGasPrice: assetConfig.maxGasPrice,
    }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const bodyText = Buffer.concat(chunks).toString("utf8");
  const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : {};

  if (url.pathname === "/relayer/quote") {
    const assetConfig = findAssetConfig(String(body.asset));
    if (
      String(body.chainId) !== String(state.config.chainId)
      || !assetConfig
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected quote body chainId=${state.config.chainId} and a configured asset`,
      }));
      return;
    }

    state.lastQuoteRequest = {
      chainId: String(body.chainId),
      amount: String(body.amount),
      asset: String(body.asset),
      extraGas: Boolean(body.extraGas),
      recipient:
        typeof body.recipient === "string" ? body.recipient : null,
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    const quoteBody = buildQuoteBody(
      assetConfig,
      state.quoteRequests,
      {
        amount: String(body.amount),
        asset: String(body.asset),
        extraGas: Boolean(body.extraGas),
        recipient:
          typeof body.recipient === "string"
            ? (body.recipient as `0x${string}`)
            : undefined,
      },
    );
    state.quoteRequests += 1;
    res.end(JSON.stringify(quoteBody));
    return;
  }

  if (url.pathname === "/relayer/request") {
    if (String(body.chainId) !== String(state.config.chainId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected relay request chainId=${state.config.chainId}`,
      }));
      return;
    }

    state.lastRelayRequest = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    const account = privateKeyToAccount(state.config.relayerPrivateKey);
    const publicClient = createPublicClient({
      transport: http(state.config.rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      transport: http(state.config.rpcUrl),
    });

    let txHash: `0x${string}`;
    try {
      txHash = await walletClient.writeContract({
        address: state.config.entrypoint,
        abi: entrypointRelayAbi,
        functionName: "relay",
        args: [
          body.withdrawal as {
            processooor: `0x${string}`;
            data: `0x${string}`;
          },
          toSolidityProof({
            proof: body.proof as {
              pi_a?: [string, string];
              pi_b?: [[string, string], [string, string]];
              pi_c?: [string, string];
            },
            publicSignals: body.publicSignals as string[] | undefined,
          }),
          BigInt(String(body.scope)),
        ],
      });
    } catch (error) {
      if (isRelayRevertError(error)) {
        throw new Error("Relay transaction reverted");
      }
      throw error;
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`Relay transaction reverted: ${txHash}`);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      success: true,
      txHash,
      timestamp: Date.now(),
      requestId: `anvil-${Date.now()}`,
    }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
}

export function launchAnvilRelayerServer(
  config: AnvilRelayerConfig
): Promise<AnvilRelayerServer> {
  const script = resolve(import.meta.dir, "anvil-relayer-server.ts");

  return new Promise((resolveLaunch, reject) => {
    const proc = spawn(nodeExecutable(), tsxEntrypointArgs(script), {
      env: buildChildProcessEnv({
        PP_ANVIL_RELAYER_CONFIG: JSON.stringify(config),
      }),
      stdio: ["ignore", "pipe", "ignore"],
    });
    const cleanupProcessExit = registerProcessExitCleanup(proc);

    let output = "";
    const timeout = setTimeout(() => {
      cleanupProcessExit();
      proc.kill();
      reject(new Error("Anvil relayer server did not start within 10s"));
    }, 10_000);

    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/ANVIL_RELAYER_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
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

    proc.on("error", (error) => {
      clearTimeout(timeout);
      cleanupProcessExit();
      reject(error);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      cleanupProcessExit();
      reject(new Error(`Anvil relayer server exited early with code ${code}`));
    });
  });
}

export async function killAnvilRelayerServer(server: AnvilRelayerServer): Promise<void> {
  server.cleanup?.();
  await terminateChildProcess(server.proc);
}

if (isDirectEntrypoint(import.meta.url)) {
  const rawConfig = process.env.PP_ANVIL_RELAYER_CONFIG?.trim();
  if (!rawConfig) {
    throw new Error("PP_ANVIL_RELAYER_CONFIG is required");
  }

  const config = JSON.parse(rawConfig) as AnvilRelayerConfig;
  const state = {
    quoteRequests: 0,
    config,
    baselineConfig: JSON.parse(JSON.stringify(config)) as AnvilRelayerConfig,
    lastQuoteRequest: null,
    lastRelayRequest: null,
  };
  const server = createServer((req, res) => {
    route(req, res, state).catch((error) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
      }));
    });
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind Anvil relayer server");
    }
    process.stdout.write(`ANVIL_RELAYER_PORT=${address.port}\n`);
  });
}
