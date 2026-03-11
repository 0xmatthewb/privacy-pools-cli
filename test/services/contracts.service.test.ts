import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Address } from "viem";
import { CHAINS } from "../../src/config/chains.ts";

/**
 * contracts.ts relies on viem createPublicClient/createWalletClient and
 * on wallet.ts/sdk.ts helpers. We mock at the module level so the exported
 * functions (approveERC20, depositETH, depositERC20, ragequit, withdrawDirect)
 * exercise the internal submitContractWrite path without touching the network.
 */

// --- Mock state ---
let mockSimulateArgs: Record<string, unknown> | null = null;
let mockWriteArgs: Record<string, unknown> | null = null;
let mockSimulateResult = { request: {} };
let mockWriteHash = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
let simulateShouldThrow: Error | null = null;
let writeShouldThrow: Error | null = null;

const mockPublicClient = {
  simulateContract: mock(async (params: Record<string, unknown>) => {
    mockSimulateArgs = params;
    if (simulateShouldThrow) throw simulateShouldThrow;
    return mockSimulateResult;
  }),
};

const mockWalletClient = {
  writeContract: mock(async (params: Record<string, unknown>) => {
    mockWriteArgs = params;
    if (writeShouldThrow) throw writeShouldThrow;
    return mockWriteHash;
  }),
};

// We need the real parseAbi and http for the ABI definitions used transitively
const realViem = await import("viem");

// Mock viem — re-export everything real except the client factories
mock.module("viem", () => ({
  ...realViem,
  createPublicClient: mock(() => mockPublicClient),
  createWalletClient: mock(() => mockWalletClient),
  http: mock((url: string) => ({ url })),
}));

// Mock viem/accounts
mock.module("viem/accounts", () => ({
  privateKeyToAccount: mock((key: string) => ({
    address: "0x1111111111111111111111111111111111111111" as Address,
    privateKey: key,
  })),
}));

// Mock wallet service
mock.module("../../src/services/wallet.ts", () => ({
  loadPrivateKey: mock(
    () => "0x0000000000000000000000000000000000000000000000000000000000000001"
  ),
}));

// Mock sdk service
mock.module("../../src/services/sdk.ts", () => ({
  getHealthyRpcUrl: mock(async () => "https://mock-rpc.example.com"),
}));

// Mock mode util
mock.module("../../src/utils/mode.ts", () => ({
  getNetworkTimeoutMs: mock(() => 30000),
  resolveGlobalMode: mock(() => ({
    isJson: false,
    isQuiet: false,
    skipPrompts: false,
  })),
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
  beforeEach(() => {
    mockSimulateArgs = null;
    mockWriteArgs = null;
    mockSimulateResult = { request: {} };
    mockWriteHash =
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    simulateShouldThrow = null;
    writeShouldThrow = null;
    mockPublicClient.simulateContract.mockClear();
    mockWalletClient.writeContract.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  describe("approveERC20", () => {
    test("calls simulateContract and writeContract with correct approve params", async () => {
      const tokenAddress =
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
      const spenderAddress =
        "0x2222222222222222222222222222222222222222" as Address;
      const amount = 1000000n;

      const result = await approveERC20(
        chain,
        tokenAddress,
        spenderAddress,
        amount
      );

      expect(result).toHaveProperty("hash");
      expect(result.hash).toBe(mockWriteHash);

      // simulateContract should have been called with the approve function
      expect(mockPublicClient.simulateContract).toHaveBeenCalledTimes(1);
      expect(mockSimulateArgs).not.toBeNull();
      expect(mockSimulateArgs!.address).toBe(tokenAddress);
      expect(mockSimulateArgs!.functionName).toBe("approve");
      expect(mockSimulateArgs!.args).toEqual([spenderAddress, amount]);
      expect(mockSimulateArgs!.value).toBe(0n);
    });

    test("returns transaction hash from writeContract", async () => {
      const expectedHash =
        "0x9999999999999999999999999999999999999999999999999999999999999999";
      mockWriteHash = expectedHash;

      const result = await approveERC20(
        chain,
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
        "0x2222222222222222222222222222222222222222" as Address,
        500n
      );

      expect(result.hash).toBe(expectedHash);
    });
  });

  describe("depositETH", () => {
    test("sends native ETH deposit with value and precommitment", async () => {
      const amount = 1000000000000000000n; // 1 ETH
      const precommitment = 42n;

      const result = await depositETH(chain, amount, precommitment);

      expect(result.hash).toBe(mockWriteHash);
      expect(mockSimulateArgs).not.toBeNull();
      expect(mockSimulateArgs!.address).toBe(chain.entrypoint);
      expect(mockSimulateArgs!.functionName).toBe("deposit");
      expect(mockSimulateArgs!.args).toEqual([precommitment]);
      expect(mockSimulateArgs!.value).toBe(amount);
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
        precommitment
      );

      expect(result.hash).toBe(mockWriteHash);
      expect(mockSimulateArgs).not.toBeNull();
      expect(mockSimulateArgs!.address).toBe(chain.entrypoint);
      expect(mockSimulateArgs!.functionName).toBe("deposit");
      expect(mockSimulateArgs!.args).toEqual([
        assetAddress,
        amount,
        precommitment,
      ]);
      expect(mockSimulateArgs!.value).toBe(0n);
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

      const result = await ragequit(chain, poolAddress, proof);

      expect(result.hash).toBe(mockWriteHash);
      expect(mockSimulateArgs).not.toBeNull();
      expect(mockSimulateArgs!.address).toBe(poolAddress);
      expect(mockSimulateArgs!.functionName).toBe("ragequit");
      expect(mockSimulateArgs!.args).toEqual([proof]);
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
        proof
      );

      expect(result.hash).toBe(mockWriteHash);
      expect(mockSimulateArgs).not.toBeNull();
      expect(mockSimulateArgs!.address).toBe(poolAddress);
      expect(mockSimulateArgs!.functionName).toBe("withdraw");
      expect(mockSimulateArgs!.args).toEqual([withdrawal, proof]);
    });
  });

  describe("error handling", () => {
    test("propagates simulation errors", async () => {
      simulateShouldThrow = new Error("execution reverted: NullifierAlreadySpent");

      await expect(
        depositETH(chain, 1n, 1n)
      ).rejects.toThrow("execution reverted: NullifierAlreadySpent");
    });

    test("propagates writeContract errors", async () => {
      writeShouldThrow = new Error("insufficient funds for gas");

      await expect(
        depositETH(chain, 1n, 1n)
      ).rejects.toThrow("insufficient funds for gas");
    });

    test("passes rpcOverride and privateKeyOverride through", async () => {
      const customRpc = "https://custom-rpc.example.com";
      const customKey =
        "0x0000000000000000000000000000000000000000000000000000000000000002";

      await approveERC20(
        chain,
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
        "0x2222222222222222222222222222222222222222" as Address,
        100n,
        customRpc,
        customKey
      );

      // If we got here without errors, the overrides were passed to createWriteClients
      expect(mockPublicClient.simulateContract).toHaveBeenCalledTimes(1);
      expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(1);
    });
  });
});
