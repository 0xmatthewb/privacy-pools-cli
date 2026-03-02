import { describe, expect, test } from "bun:test";
import type { Address } from "viem";
import { isHex } from "viem";
import {
  buildUnsignedDepositOutput,
  buildUnsignedDirectWithdrawOutput,
  buildUnsignedRelayedWithdrawOutput,
  buildUnsignedRagequitOutput,
} from "../../src/utils/unsigned-flows.ts";
import type { SolidityProof } from "../../src/utils/unsigned.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

/**
 * Protocol-aware fuzz tests for unsigned transaction builders.
 *
 * These exercise the ABI-encoding paths with randomized but structurally
 * valid inputs, asserting envelope invariants (field presence, hex-encoded
 * calldata, correct value propagation, transaction count).
 */

function randAddress(rng: ReturnType<typeof createSeededRng>): Address {
  let hex = "0x";
  const alphabet = "0123456789abcdef";
  for (let i = 0; i < 40; i++) {
    hex += alphabet[rng.nextInt(alphabet.length)];
  }
  return hex as Address;
}

function randBigInt(rng: ReturnType<typeof createSeededRng>): bigint {
  return BigInt(rng.nextUInt32()) * 1_000_000_000n + BigInt(rng.nextUInt32());
}

function randProof(rng: ReturnType<typeof createSeededRng>, pubSignalCount: number): SolidityProof {
  return {
    pA: [randBigInt(rng), randBigInt(rng)],
    pB: [
      [randBigInt(rng), randBigInt(rng)],
      [randBigInt(rng), randBigInt(rng)],
    ],
    pC: [randBigInt(rng), randBigInt(rng)],
    pubSignals: Array.from({ length: pubSignalCount }, () => randBigInt(rng)),
  };
}

function randHex(rng: ReturnType<typeof createSeededRng>, bytes: number): `0x${string}` {
  let hex = "0x";
  const alphabet = "0123456789abcdef";
  for (let i = 0; i < bytes * 2; i++) {
    hex += alphabet[rng.nextInt(alphabet.length)];
  }
  return hex as `0x${string}`;
}

describe("unsigned transaction flows fuzz", () => {
  test("buildUnsignedDepositOutput produces valid envelopes for native deposits", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x10101010);

    for (let i = 0; i < 100; i++) {
      const chainId = 1 + rng.nextInt(100_000);
      const amount = randBigInt(rng);
      const entrypoint = randAddress(rng);
      const from = rng.nextInt(3) === 0 ? null : randAddress(rng);

      const output = buildUnsignedDepositOutput({
        chainId,
        chainName: "testnet",
        assetSymbol: "ETH",
        amount,
        from,
        entrypoint,
        assetAddress: randAddress(rng),
        precommitment: randBigInt(rng),
        isNative: true,
      });

      // Envelope invariants
      expect(output.mode).toBe("unsigned");
      expect(output.operation).toBe("deposit");
      expect(output.chain).toBe("testnet");
      expect(output.asset).toBe("ETH");
      expect(output.amount).toBe(amount.toString());
      expect(typeof output.precommitment).toBe("string");

      // Native deposit = 1 transaction (no approve)
      expect(output.transactions.length).toBe(1);

      const tx = output.transactions[0];
      expect(tx.chainId).toBe(chainId);
      expect(tx.from).toBe(from);
      expect(tx.to).toBe(entrypoint);
      expect(tx.value).toBe(amount.toString());
      expect(isHex(tx.data)).toBe(true);
      expect(tx.data.length).toBeGreaterThan(10); // function selector + encoded args
      expect(typeof tx.description).toBe("string");
    }
  });

  test("buildUnsignedDepositOutput produces valid envelopes for ERC-20 deposits", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x20202020);

    for (let i = 0; i < 100; i++) {
      const chainId = 1 + rng.nextInt(100_000);
      const amount = randBigInt(rng);
      const entrypoint = randAddress(rng);
      const assetAddress = randAddress(rng);
      const from = rng.nextInt(3) === 0 ? null : randAddress(rng);

      const output = buildUnsignedDepositOutput({
        chainId,
        chainName: "mainnet",
        assetSymbol: "USDC",
        amount,
        from,
        entrypoint,
        assetAddress,
        precommitment: randBigInt(rng),
        isNative: false,
      });

      // ERC-20 deposit = 2 transactions (approve + deposit)
      expect(output.transactions.length).toBe(2);

      // First: approve
      const approve = output.transactions[0];
      expect(approve.to).toBe(assetAddress);
      expect(approve.value).toBe("0");
      expect(isHex(approve.data)).toBe(true);

      // Second: deposit
      const deposit = output.transactions[1];
      expect(deposit.to).toBe(entrypoint);
      expect(deposit.value).toBe("0"); // ERC-20 has zero value
      expect(isHex(deposit.data)).toBe(true);
    }
  });

  test("buildUnsignedDirectWithdrawOutput produces valid withdraw envelopes", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x30303030);

    for (let i = 0; i < 100; i++) {
      const chainId = 1 + rng.nextInt(100_000);
      const amount = randBigInt(rng);
      const poolAddress = randAddress(rng);
      const recipient = randAddress(rng);
      const from = rng.nextInt(3) === 0 ? null : randAddress(rng);
      const proof = randProof(rng, 8);

      const output = buildUnsignedDirectWithdrawOutput({
        chainId,
        chainName: "mainnet",
        assetSymbol: "ETH",
        amount,
        from,
        poolAddress,
        recipient,
        selectedCommitmentLabel: randBigInt(rng),
        selectedCommitmentValue: randBigInt(rng),
        withdrawal: {
          processooor: randAddress(rng),
          data: randHex(rng, 32 + rng.nextInt(64)),
        },
        proof,
      });

      // Envelope invariants
      expect(output.mode).toBe("unsigned");
      expect(output.operation).toBe("withdraw");
      expect(output.withdrawMode).toBe("direct");
      expect(output.recipient).toBe(recipient);
      expect(output.amount).toBe(amount.toString());

      // Direct withdraw = 1 transaction
      expect(output.transactions.length).toBe(1);
      const tx = output.transactions[0];
      expect(tx.to).toBe(poolAddress);
      expect(tx.value).toBe("0");
      expect(isHex(tx.data)).toBe(true);
      expect(tx.data.length).toBeGreaterThan(10);
      expect(tx.chainId).toBe(chainId);
      expect(tx.from).toBe(from);
    }
  });

  test("buildUnsignedRelayedWithdrawOutput produces valid relay envelopes", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x40404040);

    for (let i = 0; i < 100; i++) {
      const chainId = 1 + rng.nextInt(100_000);
      const amount = randBigInt(rng);
      const entrypoint = randAddress(rng);
      const recipient = randAddress(rng);
      const scope = randBigInt(rng);
      const feeBPS = String(rng.nextInt(10000));
      const from = rng.nextInt(3) === 0 ? null : randAddress(rng);
      const proof = randProof(rng, 8);

      const output = buildUnsignedRelayedWithdrawOutput({
        chainId,
        chainName: "arbitrum",
        assetSymbol: "USDC",
        amount,
        from,
        entrypoint,
        scope,
        recipient,
        selectedCommitmentLabel: randBigInt(rng),
        selectedCommitmentValue: randBigInt(rng),
        feeBPS,
        quoteExpiresAt: String(Date.now() + rng.nextInt(3600_000)),
        withdrawal: {
          processooor: randAddress(rng),
          data: randHex(rng, 32 + rng.nextInt(64)),
        },
        proof,
        relayerRequest: { nonce: rng.nextUInt32() },
      });

      // Envelope invariants
      expect(output.mode).toBe("unsigned");
      expect(output.operation).toBe("withdraw");
      expect(output.withdrawMode).toBe("relayed");
      expect(output.recipient).toBe(recipient);
      expect(output.feeBPS).toBe(feeBPS);

      // Relayed withdraw = 1 transaction
      expect(output.transactions.length).toBe(1);
      const tx = output.transactions[0];
      expect(tx.to).toBe(entrypoint);
      expect(tx.value).toBe("0");
      expect(isHex(tx.data)).toBe(true);
      expect(tx.data.length).toBeGreaterThan(10);
    }
  });

  test("buildUnsignedRagequitOutput produces valid ragequit envelopes", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x50505050);

    for (let i = 0; i < 100; i++) {
      const chainId = 1 + rng.nextInt(100_000);
      const poolAddress = randAddress(rng);
      const commitmentValue = randBigInt(rng);
      const from = rng.nextInt(3) === 0 ? null : randAddress(rng);
      // Ragequit proof has 4 public signals
      const proof = randProof(rng, 4);

      const output = buildUnsignedRagequitOutput({
        chainId,
        chainName: "mainnet",
        assetSymbol: "ETH",
        amount: commitmentValue,
        from,
        poolAddress,
        selectedCommitmentLabel: randBigInt(rng),
        selectedCommitmentValue: commitmentValue,
        proof,
      });

      // Envelope invariants
      expect(output.mode).toBe("unsigned");
      expect(output.operation).toBe("ragequit");
      expect(output.amount).toBe(commitmentValue.toString());
      expect(output.selectedCommitmentValue).toBe(commitmentValue.toString());

      // Ragequit = 1 transaction
      expect(output.transactions.length).toBe(1);
      const tx = output.transactions[0];
      expect(tx.to).toBe(poolAddress);
      expect(tx.value).toBe("0");
      expect(isHex(tx.data)).toBe(true);
      expect(tx.data.length).toBeGreaterThan(10);
      expect(tx.chainId).toBe(chainId);
      expect(tx.from).toBe(from);
    }
  });

});
