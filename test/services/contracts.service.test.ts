import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  decodeFunctionData,
  parseTransaction,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "../../src/config/chains.ts";
import {
  entrypointDepositErc20Abi,
  entrypointDepositNativeAbi,
  erc20ApproveAbi,
  privacyPoolRagequitAbi,
  privacyPoolWithdrawAbi,
} from "../../src/utils/unsigned-flows.ts";
import {
  installModuleMocks,
  restoreMockFunctions,
} from "../helpers/module-mocks.ts";

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
const TEST_OVERRIDE_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000002";

const realSdk = await import("../../src/services/sdk.ts");
const realWallet = await import("../../src/services/wallet.ts");
const realMode = await import("../../src/utils/mode.ts");
const getHealthyRpcUrlMock = mock(async (_chainId: number, _override?: string) => rpcServerUrl);
const loadPrivateKeyMock = mock(() => TEST_PRIVATE_KEY);

let approveERC20: typeof import("../../src/services/contracts.ts").approveERC20;
let depositETH: typeof import("../../src/services/contracts.ts").depositETH;
let depositERC20: typeof import("../../src/services/contracts.ts").depositERC20;
let ragequit: typeof import("../../src/services/contracts.ts").ragequit;
let withdrawDirect: typeof import("../../src/services/contracts.ts").withdrawDirect;

const chain = CHAINS.mainnet;

function getCapturedCall(method: string) {
  const call = capturedCalls.find((entry) => entry.method === method);
  expect(call).toBeDefined();
  return call!;
}

function asCallRequest(call: { params: unknown[] }) {
  return call.params[0] as {
    to?: Address;
    from?: Address;
    data?: Hex;
    value?: Hex;
  };
}

function decodeRawTransactionData(rawTx: Hex) {
  const parsed = parseTransaction(rawTx) as {
    to?: Address;
    value?: bigint;
    chainId?: number;
    data?: Hex;
    input?: Hex;
  };

  return {
    ...parsed,
    data: (parsed.data ?? parsed.input) as Hex,
  };
}

function expectSimulatedContractCall(params: {
  to: Address;
  from: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}) {
  const request = asCallRequest(getCapturedCall("eth_call"));
  expect(request.to).toBe(params.to);
  expect(request.from?.toLowerCase()).toBe(params.from.toLowerCase());
  expect(BigInt(request.value ?? "0x0")).toBe(params.value ?? 0n);

  const decoded = decodeFunctionData({
    abi: params.abi,
    data: request.data!,
  });
  expect(decoded.functionName).toBe(params.functionName);
  expect(decoded.args).toEqual(params.args);
}

function expectSubmittedContractWrite(params: {
  to: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}) {
  const rawTx = getCapturedCall("eth_sendRawTransaction").params[0] as Hex;
  const parsed = decodeRawTransactionData(rawTx);

  expect(parsed.to?.toLowerCase()).toBe(params.to.toLowerCase());
  expect(parsed.chainId).toBe(chain.id);
  expect(parsed.value ?? 0n).toBe(params.value ?? 0n);

  const decoded = decodeFunctionData({
    abi: params.abi,
    data: parsed.data,
  });
  expect(decoded.functionName).toBe(params.functionName);
  expect(decoded.args).toEqual(params.args);
}

describe("contracts service", () => {
  beforeAll(async () => {
    installModuleMocks([
      [
        "../../src/services/wallet.ts",
        () => ({
          ...realWallet,
          loadPrivateKey: loadPrivateKeyMock,
        }),
      ],
      [
        "../../src/services/sdk.ts",
        () => ({
          ...realSdk,
          getHealthyRpcUrl: getHealthyRpcUrlMock,
        }),
      ],
      [
        "../../src/utils/mode.ts",
        () => ({
          ...realMode,
        }),
      ],
    ]);

    ({
      approveERC20,
      depositETH,
      depositERC20,
      ragequit,
      withdrawDirect,
    } = await import("../../src/services/contracts.ts?contracts-service"));
  });

  beforeEach(async () => {
    capturedCalls = [];
    simulateShouldRevert = false;
    simulateRevertReason = "";
    mockTxHash =
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    getHealthyRpcUrlMock.mockClear();
    loadPrivateKeyMock.mockClear();
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
    restoreMockFunctions();
  });

  test("approveERC20 simulates and submits the transaction", async () => {
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

    expect(result.hash).toBe(mockTxHash);
    expectSimulatedContractCall({
      to: tokenAddress,
      from: privateKeyToAccount(TEST_PRIVATE_KEY).address,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [spenderAddress, amount],
    });
    expectSubmittedContractWrite({
      to: tokenAddress,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [spenderAddress, amount],
    });
  });

  test("depositETH simulates and submits the transaction", async () => {
    const amount = 1000000000000000000n;
    const precommitment = 42n;
    const result = await depositETH(
      chain,
      amount,
      precommitment,
      rpcServerUrl,
      TEST_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    expectSimulatedContractCall({
      to: chain.entrypoint,
      from: privateKeyToAccount(TEST_PRIVATE_KEY).address,
      abi: entrypointDepositNativeAbi,
      functionName: "deposit",
      args: [precommitment],
      value: amount,
    });
    expectSubmittedContractWrite({
      to: chain.entrypoint,
      abi: entrypointDepositNativeAbi,
      functionName: "deposit",
      args: [precommitment],
      value: amount,
    });
  });

  test("depositERC20 simulates and submits the transaction", async () => {
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
    expectSimulatedContractCall({
      to: chain.entrypoint,
      from: privateKeyToAccount(TEST_PRIVATE_KEY).address,
      abi: entrypointDepositErc20Abi,
      functionName: "deposit",
      args: [assetAddress, amount, precommitment],
    });
    expectSubmittedContractWrite({
      to: chain.entrypoint,
      abi: entrypointDepositErc20Abi,
      functionName: "deposit",
      args: [assetAddress, amount, precommitment],
    });
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
    expectSimulatedContractCall({
      to: "0x3333333333333333333333333333333333333333" as Address,
      from: privateKeyToAccount(TEST_PRIVATE_KEY).address,
      abi: privacyPoolRagequitAbi,
      functionName: "ragequit",
      args: [proof],
    });
    expectSubmittedContractWrite({
      to: "0x3333333333333333333333333333333333333333" as Address,
      abi: privacyPoolRagequitAbi,
      functionName: "ragequit",
      args: [proof],
    });
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
    expectSimulatedContractCall({
      to: "0x4444444444444444444444444444444444444444" as Address,
      from: privateKeyToAccount(TEST_PRIVATE_KEY).address,
      abi: privacyPoolWithdrawAbi,
      functionName: "withdraw",
      args: [withdrawal, proof],
    });
    expectSubmittedContractWrite({
      to: "0x4444444444444444444444444444444444444444" as Address,
      abi: privacyPoolWithdrawAbi,
      functionName: "withdraw",
      args: [withdrawal, proof],
    });
  });

  test("propagates simulation errors", async () => {
    simulateShouldRevert = true;
    simulateRevertReason = "NullifierAlreadySpent";

    await expect(
      depositETH(chain, 1n, 1n, rpcServerUrl, TEST_PRIVATE_KEY)
    ).rejects.toThrow("NullifierAlreadySpent");
    expect(capturedCalls.some((entry) => entry.method === "eth_sendRawTransaction")).toBe(false);
  });

  test("passes rpcOverride and privateKeyOverride through", async () => {
    const tokenAddress =
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
    const spenderAddress =
      "0x2222222222222222222222222222222222222222" as Address;
    const amount = 100n;
    const result = await approveERC20(
      chain,
      tokenAddress,
      spenderAddress,
      amount,
      rpcServerUrl,
      TEST_OVERRIDE_PRIVATE_KEY
    );

    expect(result.hash).toBe(mockTxHash);
    expect(getHealthyRpcUrlMock).toHaveBeenCalledWith(chain.id, rpcServerUrl);
    expect(loadPrivateKeyMock).not.toHaveBeenCalled();
    expectSimulatedContractCall({
      to: tokenAddress,
      from: privateKeyToAccount(TEST_OVERRIDE_PRIVATE_KEY).address,
      abi: erc20ApproveAbi,
      functionName: "approve",
      args: [spenderAddress, amount],
    });
  });
});
