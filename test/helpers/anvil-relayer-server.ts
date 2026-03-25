import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildChildProcessEnv } from "./child-env.ts";
import { terminateChildProcess } from "./process.ts";

export interface AnvilRelayerConfig {
  chainId: number;
  rpcUrl: string;
  entrypoint: `0x${string}`;
  assetAddress: `0x${string}`;
  feeReceiverAddress: `0x${string}`;
  relayerPrivateKey: `0x${string}`;
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
}

const entrypointRelayAbi = parseAbi([
  "function relay((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof, uint256 _scope)",
]);

function buildQuoteBody(
  config: AnvilRelayerConfig,
  quoteRequestIndex: number,
  request: {
    amount: string;
    asset: string;
    extraGas: boolean;
  }
) {
  const quoteStep =
    config.quoteSequence?.[
      Math.min(quoteRequestIndex, config.quoteSequence.length - 1)
    ] ?? null;
  const feeBPS = quoteStep?.feeBPS ?? config.feeBPS;
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
      withdrawalData: "0x1234",
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

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  config: AnvilRelayerConfig,
  state: { quoteRequests: number },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (req.method === "GET" && url.pathname === "/__state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      quoteRequests: state.quoteRequests,
    }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/relayer/details") {
    const requestedChainId = url.searchParams.get("chainId");
    const requestedAssetAddress = url.searchParams.get("assetAddress");
    if (
      requestedChainId !== String(config.chainId)
      || requestedAssetAddress?.toLowerCase() !== config.assetAddress.toLowerCase()
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected chainId=${config.chainId} and assetAddress=${config.assetAddress}`,
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      chainId: config.chainId,
      feeBPS: config.feeBPS,
      minWithdrawAmount: config.minWithdrawAmount,
      feeReceiverAddress: config.feeReceiverAddress,
      assetAddress: config.assetAddress,
      maxGasPrice: config.maxGasPrice,
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
    if (
      String(body.chainId) !== String(config.chainId)
      || String(body.asset).toLowerCase() !== config.assetAddress.toLowerCase()
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected quote body chainId=${config.chainId} and asset=${config.assetAddress}`,
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    const quoteBody = buildQuoteBody(
      config,
      state.quoteRequests,
      {
        amount: String(body.amount),
        asset: String(body.asset),
        extraGas: Boolean(body.extraGas),
      },
    );
    state.quoteRequests += 1;
    res.end(JSON.stringify(quoteBody));
    return;
  }

  if (url.pathname === "/relayer/request") {
    if (String(body.chainId) !== String(config.chainId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: `Expected relay request chainId=${config.chainId}`,
      }));
      return;
    }

    const account = privateKeyToAccount(config.relayerPrivateKey);
    const publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      transport: http(config.rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: config.entrypoint,
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
    const proc = spawn("bun", ["run", script], {
      env: buildChildProcessEnv({
        PP_ANVIL_RELAYER_CONFIG: JSON.stringify(config),
      }),
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    const timeout = setTimeout(() => {
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
        process.once("exit", () => {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill();
          }
        });
        resolveLaunch({ proc, port, url: `http://127.0.0.1:${port}` });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Anvil relayer server exited early with code ${code}`));
    });
  });
}

export async function killAnvilRelayerServer(server: AnvilRelayerServer): Promise<void> {
  await terminateChildProcess(server.proc);
}

if (import.meta.main) {
  const rawConfig = process.env.PP_ANVIL_RELAYER_CONFIG?.trim();
  if (!rawConfig) {
    throw new Error("PP_ANVIL_RELAYER_CONFIG is required");
  }

  const config = JSON.parse(rawConfig) as AnvilRelayerConfig;
  const state = { quoteRequests: 0 };
  const server = createServer((req, res) => {
    route(req, res, config, state).catch((error) => {
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
