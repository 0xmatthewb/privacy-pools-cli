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

// 200_000 gas * 50 gwei = 10_000_000_000_000_000 wei (0.01 ETH)
const GAS_BUFFER_WEI = 200_000n * 50_000_000_000n;

function mockPublicClient(nativeBalance: bigint, erc20Balance?: bigint) {
  return {
    getBalance: async () => nativeBalance,
    readContract: async () => erc20Balance ?? 0n,
  } as unknown as PublicClient;
}

describe("checkNativeBalance", () => {
  test("passes when balance >= required + gas buffer", async () => {
    const required = 1_000_000_000_000_000_000n; // 1 ETH
    const client = mockPublicClient(required + GAS_BUFFER_WEI);
    await expect(
      checkNativeBalance(client, SIGNER, required, "ETH")
    ).resolves.toBeUndefined();
  });

  test("passes when balance exceeds required + gas buffer", async () => {
    const required = 1_000_000_000_000_000_000n;
    const client = mockPublicClient(required + GAS_BUFFER_WEI + 1n);
    await expect(
      checkNativeBalance(client, SIGNER, required, "ETH")
    ).resolves.toBeUndefined();
  });

  test("throws CLIError with INPUT_INSUFFICIENT_BALANCE when below threshold", async () => {
    const required = 1_000_000_000_000_000_000n;
    const client = mockPublicClient(required + GAS_BUFFER_WEI - 1n);
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

  test("accounts for GAS_BUFFER_WEI of 10_000_000_000_000_000 wei", async () => {
    // With zero required, must still have the gas buffer
    const client = mockPublicClient(GAS_BUFFER_WEI - 1n);
    try {
      await checkNativeBalance(client, SIGNER, 0n, "ETH");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).code).toBe("INPUT_INSUFFICIENT_BALANCE");
    }

    // Exactly at gas buffer with zero required should pass
    const clientOk = mockPublicClient(GAS_BUFFER_WEI);
    await expect(
      checkNativeBalance(clientOk, SIGNER, 0n, "ETH")
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
