import {
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

/**
 * contracts.ts relies on viem createPublicClient/createWalletClient and
 * on wallet.ts/sdk.ts helpers. We mock only the project-level modules
 * (sdk, wallet, mode) and use a local HTTP mock server for viem RPC calls.
 * This avoids mocking "viem" itself, which leaks across Bun test files.
 */

// --- Mock RPC server state ---
let mockSimulateResult: unknown = { result: "0x" };
let simulateShouldRevert = false;
let simulateRevertReason = "";
let capturedCalls: Array<{ method: string; params: unknown[] }> = [];
let mockTxHash =
  "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

// Track server for cleanup
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
        result = "0x1"; // mainnet
      } else if (method === "eth_call") {
        // simulateContract uses eth_call
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

// Test private key (well-known test key, NOT a real key)
const TEST_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";

// Load real modules before mocking so we can delegate non-test calls
const realSdk = await import("../../src/services/sdk.ts");
const realWallet = await import("../../src/services/wallet.ts");
const realMode = await import("../../src/utils/mode.ts");

// Mock only project-level modules (NOT viem).
// Include ALL exports so Bun's leaked module mock doesn't break other tests.
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

// Import the functions under test AFTER mocking
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

  describe("approveERC20", () => {
    test("calls eth_call (simulate) and eth_sendRawTransaction with correct flow", async () => {
      const tokenAddress =
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
      const spenderAddress =
        "0x2222222222222222222222222222222222222222" as Address;
      const amount = 1000000n;

      const result = await approveERC20(
        chain,
        tokenAddress,
        spenderAddress,
        amount,
        rpcServerUrl,
        TEST_PRIVATE_KEY
      );

      expect(result).toHaveProperty("hash");
      expect(result.hash).toBe(mockTxHash);

      // Should have made eth_call (simulate) and eth_sendRawTransaction
      const methods = capturedCalls.map((c) => c.method);
      expect(methods).toContain("eth_call");
      expect(methods).toContain("eth_sendRawTransaction");
    });

    test("returns transaction hash from sendRawTransaction", async () => {
      const expectedHash =
        "0x9999999999999999999999999999999999999999999999999999999999999999";
      mockTxHash = expectedHash;

      const result = await approveERC20(
        chain,
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
        "0x2222222222222222222222222222222222222222" as Address,
        500n,
        rpcServerUrl,
        TEST_PRIVATE_KEY
      );

      expect(result.hash).toBe(expectedHash);
    });
  });

  describe("depositETH", () => {
    test("sends native ETH deposit with value and precommitment", async () => {
      const amount = 1000000000000000000n; // 1 ETH
      const precommitment = 42n;

      const result = await depositETH(
        chain,
        amount,
        precommitment,
        rpcServerUrl,
        TEST_PRIVATE_KEY
      );

      expect(result.hash).toBe(mockTxHash);
      const methods = capturedCalls.map((c) => c.method);
      expect(methods).toContain("eth_call");
      expect(methods).toContain("eth_sendRawTransaction");
    });
  });

  describe("depositERC20", () => {
    test("calls deposit with asset address, amount, and precommitment", async () => {
      const assetAddress =
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
      const amount = 500000n;
      const precommitment = 99n;

      const result = await depositERC20(
        chain,
        assetAddress,
        amount,
        precommitment,
        rpcServerUrl,
        TEST_PRIVATE_KEY
      );

      expect(result.hash).toBe(mockTxHash);
      const methods = capturedCalls.map((c) => c.method);
      expect(methods).toContain("eth_call");
      expect(methods).toContain("eth_sendRawTransaction");
    });
  });

  describe("ragequit", () => {
    test("calls ragequit with pool address and proof", async () => {
      const poolAddress =
        "0x3333333333333333333333333333333333333333" as Address;
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
        poolAddress,
        proof,
        rpcServerUrl,
        TEST_PRIVATE_KEY
      );

      expect(result.hash).toBe(mockTxHash);
      const methods = capturedCalls.map((c) => c.method);
      expect(methods).toContain("eth_call");
      expect(methods).toContain("eth_sendRawTransaction");
    });
  });

  describe("withdrawDirect", () => {
    test("calls withdraw with pool address, withdrawal call and proof", async () => {
      const poolAddress =
        "0x4444444444444444444444444444444444444444" as Address;
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
        poolAddress,
        withdrawal,
        proof,
        rpcServerUrl,
        TEST_PRIVATE_KEY
      );

      expect(result.hash).toBe(mockTxHash);
      const methods = capturedCalls.map((c) => c.method);
      expect(methods).toContain("eth_call");
      expect(methods).toContain("eth_sendRawTransaction");
    });
  });

  describe("error handling", () => {
    test("propagates simulation errors", async () => {
      simulateShouldRevert = true;
      simulateRevertReason = "NullifierAlreadySpent";

      await expect(
        depositETH(chain, 1n, 1n, rpcServerUrl, TEST_PRIVATE_KEY)
      ).rejects.toThrow();
    });

    test("passes rpcOverride and privateKeyOverride through", async () => {
      const customKey =
        "0x0000000000000000000000000000000000000000000000000000000000000002";

      const result = await approveERC20(
        chain,
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
        "0x2222222222222222222222222222222222222222" as Address,
        100n,
        rpcServerUrl,
        customKey
      );

      expect(result).toHaveProperty("hash");
      // Verify RPC calls were made to our mock server
      expect(capturedCalls.length).toBeGreaterThan(0);
    });
  });
});
