import { describe, expect, test } from "bun:test";
import type { PublicClient } from "viem";
import {
  checkNativeBalance,
  checkErc20Balance,
  checkHasGas,
} from "../../src/utils/preflight.ts";
import { CLIError } from "../../src/utils/errors.ts";

const SIGNER = "0x0000000000000000000000000000000000000001" as const;
const TOKEN = "0x0000000000000000000000000000000000000002" as const;

const GAS_LIMIT = 200_000n;
// Fallback buffer: 200_000 gas * 50 gwei = 10_000_000_000_000_000 wei (0.01 ETH)
const FALLBACK_GAS_BUFFER = GAS_LIMIT * 50_000_000_000n;

function mockPublicClient(
  nativeBalance: bigint,
  erc20Balance?: bigint,
  gasPrice?: bigint | "throw"
) {
  return {
    getBalance: async () => nativeBalance,
    readContract: async () => erc20Balance ?? 0n,
    ...(gasPrice === "throw"
      ? { getGasPrice: async () => { throw new Error("rpc down"); } }
      : gasPrice !== undefined
        ? { getGasPrice: async () => gasPrice }
        : {}),
  } as unknown as PublicClient;
}

describe("checkNativeBalance", () => {
  test("passes when balance >= required + gas buffer", async () => {
    const required = 1_000_000_000_000_000_000n; // 1 ETH
    const client = mockPublicClient(required + FALLBACK_GAS_BUFFER);
    await expect(
      checkNativeBalance(client, SIGNER, required, "ETH")
    ).resolves.toBeUndefined();
  });

  test("passes when balance exceeds required + gas buffer", async () => {
    const required = 1_000_000_000_000_000_000n;
    const client = mockPublicClient(required + FALLBACK_GAS_BUFFER + 1n);
    await expect(
      checkNativeBalance(client, SIGNER, required, "ETH")
    ).resolves.toBeUndefined();
  });

  test("throws CLIError with INPUT_INSUFFICIENT_BALANCE when below threshold", async () => {
    const required = 1_000_000_000_000_000_000n;
    const client = mockPublicClient(required + FALLBACK_GAS_BUFFER - 1n);
    try {
      await checkNativeBalance(client, SIGNER, required, "ETH");
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe("INPUT_INSUFFICIENT_BALANCE");
      expect(cliErr.category).toBe("INPUT");
      expect(cliErr.message).toContain("Insufficient ETH balance");
      expect(cliErr.message).toContain("gas buffer");
    }
  });

  test("accounts for FALLBACK_GAS_BUFFER of 10_000_000_000_000_000 wei", async () => {
    // With zero required, must still have the gas buffer
    const client = mockPublicClient(FALLBACK_GAS_BUFFER - 1n);
    try {
      await checkNativeBalance(client, SIGNER, 0n, "ETH");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("INPUT_INSUFFICIENT_BALANCE");
    }

    // Exactly at gas buffer with zero required should pass
    const clientOk = mockPublicClient(FALLBACK_GAS_BUFFER);
    await expect(
      checkNativeBalance(clientOk, SIGNER, 0n, "ETH")
    ).resolves.toBeUndefined();
  });
});

describe("checkNativeBalance — dynamic gas price", () => {
  test("uses live gas price with 20% margin when getGasPrice succeeds", async () => {
    const gasPrice = 25_000_000_000n; // 25 gwei
    const buffered = gasPrice + gasPrice / 5n; // 30 gwei
    const dynamicBuffer = GAS_LIMIT * buffered; // 200_000 * 30 gwei = 6_000_000_000_000_000

    // Exactly at threshold should pass
    const client = mockPublicClient(dynamicBuffer, undefined, gasPrice);
    await expect(
      checkNativeBalance(client, SIGNER, 0n, "ETH")
    ).resolves.toBeUndefined();

    // 1 wei below threshold should fail
    const clientLow = mockPublicClient(dynamicBuffer - 1n, undefined, gasPrice);
    try {
      await checkNativeBalance(clientLow, SIGNER, 0n, "ETH");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("INPUT_INSUFFICIENT_BALANCE");
    }
  });

  test("20% margin truncates for small gas prices (bigint division)", async () => {
    // gasPrice = 3n  →  3n / 5n = 0n (truncated)  →  buffered = 3n
    const gasPrice = 3n;
    const dynamicBuffer = GAS_LIMIT * 3n; // 600_000

    const client = mockPublicClient(dynamicBuffer, undefined, gasPrice);
    await expect(
      checkNativeBalance(client, SIGNER, 0n, "ETH")
    ).resolves.toBeUndefined();
  });

  test("falls back to 50 gwei when getGasPrice throws", async () => {
    const client = mockPublicClient(FALLBACK_GAS_BUFFER, undefined, "throw");
    await expect(
      checkNativeBalance(client, SIGNER, 0n, "ETH")
    ).resolves.toBeUndefined();

    const clientLow = mockPublicClient(FALLBACK_GAS_BUFFER - 1n, undefined, "throw");
    try {
      await checkNativeBalance(clientLow, SIGNER, 0n, "ETH");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("INPUT_INSUFFICIENT_BALANCE");
    }
  });

  test("dynamic buffer differs from fallback buffer", async () => {
    // With 25 gwei live price, buffer = 200_000 * 30 gwei = 6e15
    // Fallback buffer = 200_000 * 50 gwei = 1e16
    // A balance between the two should pass with live price but fail with fallback.
    const gasPrice = 25_000_000_000n;
    const dynamicBuffer = GAS_LIMIT * (gasPrice + gasPrice / 5n);
    const betweenBuffers = dynamicBuffer + 1n; // above dynamic, below fallback

    expect(betweenBuffers).toBeLessThan(FALLBACK_GAS_BUFFER);

    const clientLive = mockPublicClient(betweenBuffers, undefined, gasPrice);
    await expect(
      checkNativeBalance(clientLive, SIGNER, 0n, "ETH")
    ).resolves.toBeUndefined();
  });
});

describe("checkErc20Balance", () => {
  test("passes when token balance >= required amount", async () => {
    const required = 1_000_000n; // 1 USDC (6 decimals)
    const client = mockPublicClient(0n, required);
    await expect(
      checkErc20Balance(client, TOKEN, SIGNER, required, 6, "USDC")
    ).resolves.toBeUndefined();
  });

  test("passes when token balance exceeds required amount", async () => {
    const required = 1_000_000n;
    const client = mockPublicClient(0n, required + 1n);
    await expect(
      checkErc20Balance(client, TOKEN, SIGNER, required, 6, "USDC")
    ).resolves.toBeUndefined();
  });

  test("throws CLIError with INPUT_INSUFFICIENT_BALANCE when below required", async () => {
    const required = 1_000_000n;
    const client = mockPublicClient(0n, required - 1n);
    try {
      await checkErc20Balance(client, TOKEN, SIGNER, required, 6, "USDC");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe("INPUT_INSUFFICIENT_BALANCE");
      expect(cliErr.category).toBe("INPUT");
      expect(cliErr.message).toContain("Insufficient USDC balance");
      expect(cliErr.hint).toContain("USDC");
    }
  });

  test("throws when token balance is zero", async () => {
    const client = mockPublicClient(0n, 0n);
    try {
      await checkErc20Balance(client, TOKEN, SIGNER, 1n, 18, "DAI");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("INPUT_INSUFFICIENT_BALANCE");
      expect((err as CLIError).message).toContain("DAI");
    }
  });
});

describe("checkHasGas", () => {
  test("passes when balance > 0", async () => {
    const client = mockPublicClient(1n);
    await expect(
      checkHasGas(client, SIGNER)
    ).resolves.toBeUndefined();
  });

  test("passes with large balance", async () => {
    const client = mockPublicClient(10_000_000_000_000_000_000n);
    await expect(
      checkHasGas(client, SIGNER, "ETH")
    ).resolves.toBeUndefined();
  });

  test("throws CLIError with INPUT_NO_GAS when balance is exactly 0", async () => {
    const client = mockPublicClient(0n);
    try {
      await checkHasGas(client, SIGNER);
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const cliErr = err as CLIError;
      expect(cliErr.code).toBe("INPUT_NO_GAS");
      expect(cliErr.category).toBe("INPUT");
      expect(cliErr.message).toContain("zero");
      expect(cliErr.message).toContain("ETH");
    }
  });

  test("uses custom symbol in error message", async () => {
    const client = mockPublicClient(0n);
    try {
      await checkHasGas(client, SIGNER, "MATIC");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const cliErr = err as CLIError;
      expect(cliErr.message).toContain("MATIC");
      expect(cliErr.hint).toContain("MATIC");
    }
  });
});
