/**
 * Unit tests for --extra-gas flag rendering in withdraw output.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import {
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  type WithdrawDryRunData,
  type WithdrawSuccessData,
} from "../../src/output/withdraw.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

// ── Stub data ─────────────────────────────────────────────────────────────────

const BASE_DRY_RUN: WithdrawDryRunData = {
  withdrawMode: "relayed",
  amount: 50000000000000000n, // 0.05 ETH
  asset: "USDC",
  chain: "sepolia",
  decimals: 6,
  recipient: "0x1111111111111111111111111111111111111111",
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  selectedCommitmentLabel: 123n,
  selectedCommitmentValue: 100000000000000000n,
  proofPublicSignals: 10,
  feeBPS: "50",
  quoteExpiresAt: "2025-06-15T13:00:00.000Z",
};

const BASE_SUCCESS: WithdrawSuccessData = {
  withdrawMode: "relayed",
  txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  blockNumber: 12345n,
  amount: 50000000000000000n,
  recipient: "0x1111111111111111111111111111111111111111",
  asset: "USDC",
  chain: "sepolia",
  decimals: 6,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  poolAddress: "0x2222222222222222222222222222222222222222",
  scope: 42n,
  explorerUrl: null,
  feeBPS: "50",
  remainingBalance: 50000000000000000n,
};

// ── Dry-run: extra-gas ─────────────────────────────────────────────────────────

describe("renderWithdrawDryRun extra-gas", () => {
  test("JSON: includes extraGas when true (relayed)", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...BASE_DRY_RUN, extraGas: true };
    const { stdout } = captureOutput(() => renderWithdrawDryRun(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBe(true);
  });

  test("JSON: includes extraGas when false (relayed)", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...BASE_DRY_RUN, extraGas: false };
    const { stdout } = captureOutput(() => renderWithdrawDryRun(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBe(false);
  });

  test("JSON: omits extraGas when undefined", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...BASE_DRY_RUN };
    delete (data as Record<string, unknown>).extraGas;
    const { stdout } = captureOutput(() => renderWithdrawDryRun(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBeUndefined();
  });

  test("JSON: omits extraGas for direct mode", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: WithdrawDryRunData = {
      ...BASE_DRY_RUN,
      withdrawMode: "direct",
      extraGas: true,
    };
    const { stdout } = captureOutput(() => renderWithdrawDryRun(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBeUndefined();
  });

  test("human mode: shows extra gas line when relayed + extraGas=true", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...BASE_DRY_RUN, extraGas: true };
    const { stderr } = captureOutput(() => renderWithdrawDryRun(ctx, data));

    expect(stderr).toContain("Gas token drop: enabled");
  });

  test("human mode: no extra gas line when extraGas=false", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...BASE_DRY_RUN, extraGas: false };
    const { stderr } = captureOutput(() => renderWithdrawDryRun(ctx, data));

    expect(stderr).not.toContain("Gas token drop");
  });
});

// ── Success: extra-gas ──────────────────────────────────────────────────────────

describe("renderWithdrawSuccess extra-gas", () => {
  test("JSON: includes extraGas when true (relayed)", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...BASE_SUCCESS, extraGas: true };
    const { stdout } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBe(true);
  });

  test("JSON: omits extraGas for direct mode even if set", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: WithdrawSuccessData = {
      ...BASE_SUCCESS,
      withdrawMode: "direct",
      extraGas: true,
    };
    const { stdout } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBeUndefined();
  });

  test("JSON: omits extraGas when undefined (relayed)", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...BASE_SUCCESS };
    delete (data as Record<string, unknown>).extraGas;
    const { stdout } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.extraGas).toBeUndefined();
  });
});
