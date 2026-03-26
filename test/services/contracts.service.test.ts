import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Address } from "viem";
import { CHAINS } from "../../src/config/chains.ts";

let simulateShouldRevert = false;
let simulateRevertReason = "";
let capturedCalls: Array<{ method: string; params: unknown[] }> = [];
let mockTxHash =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

let rpcServer: ReturnType<typeof createServer> | null = null;
let rpcServerUrl = "";

async function startRpcServer(): Promise<string> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      const json = JSON.parse(body);
      const method = json.method as string;
      capturedCalls.push({ method, params: json.params ?? [] });

      let result: unknown;
      if (method === "eth_chainId") {
        result = "0x1";
      } else if (method === "eth_call") {
        if (simulateShouldRevert) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: json.id,
              error: {
                code: 3,
                message: `execution reverted: ${simulateRevertReason}`,
                data: "0x",
              },
            })
          );
          return;
        }
        result = "0x";
      } else if (method === "eth_sendRawTransaction") {
        result = mockTxHash;
      } else if (method === "eth_getTransactionCount") {
        result = "0x0";
      } else if (method === "eth_estimateGas") {
        result = "0x5208";
      } else if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") {
        result = "0x3B9ACA00";
      } else if (method === "eth_getBlockByNumber") {
        result = {
          baseFeePerGas: "0x3B9ACA00",
          number: "0x1",
          timestamp: "0x60000000",
          gasLimit: "0x1C9C380",
          gasUsed: "0x0",
          hash: "0x" + "00".repeat(32),
        };
      } else {
        result = "0x";
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
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  rpcServer = server;
  rpcServerUrl = `http://127.0.0.1:${addr.port}`;
  return rpcServerUrl;
}

const TEST_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

const realSdk = await import("../../src/services/sdk.ts");
const realWallet = await import("../../src/services/wallet.ts");
const realMode = await import("../../src/utils/mode.ts");

mock.module("../../src/services/wallet.ts", () => ({
  ...realWallet,
  loadPrivateKey: mock(() => TEST_PRIVATE_KEY),
}));

mock.module("../../src/services/sdk.ts", () => ({
  ...realSdk,
  getHealthyRpcUrl: mock(async () => rpcServerUrl),
}));

mock.module("../../src/utils/mode.ts", () => ({
  ...realMode,
}));

const {
  approveERC20,
  depositETH,
  depositERC20,
  ragequit,
  withdrawDirect,
} = await import("../../src/services/contracts.ts");

const chain = CHAINS.mainnet;

describe("contracts service", () => {
  beforeEach(async () => {
    capturedCalls = [];
    simulateShouldRevert = false;
    simulateRevertReason = "";
    mockTxHash =
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    if (!rpcServer) {
      await startRpcServer();
    }
  });

  afterEach(async () => {
    if (rpcServer) {
      await new Promise<void>((resolve, reject) =>
        rpcServer!.close((err) => (err ? reject(err) : resolve()))
      );
      rpcServer = null;
    }
  });

  afterAll(() => {
    mock.restore();
  });

  test("approveERC20 simulates and submits the transaction", async () => {
    const result = await approveERC20(
      chain,
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      "0x2222222222222222222222222222222222222222" as Address,
      1000000n,
      rpcServerUrl,
      TEST_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    const methods = capturedCalls.map((call) => call.method);
    expect(methods).toContain("eth_call");
    expect(methods).toContain("eth_sendRawTransaction");
  });

  test("depositETH simulates and submits the transaction", async () => {
    const result = await depositETH(
      chain,
      1000000000000000000n,
      42n,
      rpcServerUrl,
      TEST_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    const methods = capturedCalls.map((call) => call.method);
    expect(methods).toContain("eth_call");
    expect(methods).toContain("eth_sendRawTransaction");
  });

  test("depositERC20 simulates and submits the transaction", async () => {
    const result = await depositERC20(
      chain,
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      500000n,
      99n,
      rpcServerUrl,
      TEST_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    const methods = capturedCalls.map((call) => call.method);
    expect(methods).toContain("eth_call");
    expect(methods).toContain("eth_sendRawTransaction");
  });

  test("ragequit simulates and submits the transaction", async () => {
    const proof = {
      pA: [1n, 2n] as [bigint, bigint],
      pB: [
        [3n, 4n],
        [5n, 6n],
      ] as [[bigint, bigint], [bigint, bigint]],
      pC: [7n, 8n] as [bigint, bigint],
      pubSignals: [9n, 10n, 11n, 12n],
    };

    const result = await ragequit(
      chain,
      "0x3333333333333333333333333333333333333333" as Address,
      proof,
      rpcServerUrl,
      TEST_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    const methods = capturedCalls.map((call) => call.method);
    expect(methods).toContain("eth_call");
    expect(methods).toContain("eth_sendRawTransaction");
  });

  test("withdrawDirect simulates and submits the transaction", async () => {
    const withdrawal = {
      processooor:
        "0x5555555555555555555555555555555555555555" as Address,
      data: "0xdeadbeef" as `0x${string}`,
    };
    const proof = {
      pA: [1n, 2n] as [bigint, bigint],
      pB: [
        [3n, 4n],
        [5n, 6n],
      ] as [[bigint, bigint], [bigint, bigint]],
      pC: [7n, 8n] as [bigint, bigint],
      pubSignals: [9n, 10n, 11n, 12n, 13n, 14n, 15n, 16n],
    };

    const result = await withdrawDirect(
      chain,
      "0x4444444444444444444444444444444444444444" as Address,
      withdrawal,
      proof,
      rpcServerUrl,
      TEST_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    const methods = capturedCalls.map((call) => call.method);
    expect(methods).toContain("eth_call");
    expect(methods).toContain("eth_sendRawTransaction");
  });

  test("propagates simulation errors", async () => {
    simulateShouldRevert = true;
    simulateRevertReason = "NullifierAlreadySpent";

    await expect(
      depositETH(chain, 1n, 1n, rpcServerUrl, TEST_PRIVATE_KEY)
    ).rejects.toThrow();
  });

  test("passes rpcOverride and privateKeyOverride through", async () => {
    const result = await approveERC20(
      chain,
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
      "0x2222222222222222222222222222222222222222" as Address,
      100n,
      rpcServerUrl,
      "0x0000000000000000000000000000000000000000000000000000000000000002"
    );

    expect(result).toHaveProperty("hash");
    expect(capturedCalls.length).toBeGreaterThan(0);
  });
});
