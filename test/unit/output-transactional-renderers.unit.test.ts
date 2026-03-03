/**
 * Unit tests for transactional output renderers: init, deposit, ragequit, withdraw.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderInitResult, type InitRenderResult } from "../../src/output/init.ts";
import { renderDepositDryRun, renderDepositSuccess, type DepositDryRunData, type DepositSuccessData } from "../../src/output/deposit.ts";
import { renderRagequitDryRun, renderRagequitSuccess, type RagequitDryRunData, type RagequitSuccessData } from "../../src/output/ragequit.ts";
import { renderWithdrawDryRun, renderWithdrawSuccess, renderWithdrawQuote, type WithdrawDryRunData, type WithdrawSuccessData, type WithdrawQuoteData } from "../../src/output/withdraw.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

// ── renderInitResult parity ─────────────────────────────────────────────────

describe("renderInitResult parity", () => {
  test("JSON mode: emits init envelope with generated mnemonic redacted", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showMnemonic: false,
        mnemonic: "test word one two three four five six seven eight nine ten eleven twelve",
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.mnemonicRedacted).toBe(true);
    expect(json.mnemonic).toBeUndefined();
    expect(stderr).toBe("");
  });

  test("JSON mode: includes mnemonic when showMnemonic is true", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const mnemonic = "test word one two three four five six seven eight nine ten eleven twelve";
    const { stdout } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: false,
        mnemonicImported: false,
        showMnemonic: true,
        mnemonic,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mnemonic).toBe(mnemonic);
    expect(json.mnemonicRedacted).toBeUndefined();
  });

  test("JSON mode: omits mnemonic fields when imported", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "mainnet",
        signerKeySet: true,
        mnemonicImported: true,
        showMnemonic: false,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mnemonic).toBeUndefined();
    expect(json.mnemonicRedacted).toBeUndefined();
    expect(json.defaultChain).toBe("mainnet");
  });

  test("human mode: emits success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showMnemonic: false,
      }),
    );

    expect(stdout).toBe("");
    // Init completion outputs next-step commands to stderr
    expect(stderr).toContain("privacy-pools pools");
    expect(stderr).toContain("privacy-pools deposit");
    expect(stderr).toContain("privacy-pools guide");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: false,
        mnemonicImported: false,
        showMnemonic: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderDepositDryRun parity ──────────────────────────────────────────────

const STUB_DEPOSIT_DRY_RUN: DepositDryRunData = {
  chain: "sepolia",
  asset: "ETH",
  amount: 100000000000000000n,
  decimals: 18,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  precommitment: 12345678901234567890n,
  balanceSufficient: true,
};

describe("renderDepositDryRun parity", () => {
  test("JSON mode: emits dry-run envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderDepositDryRun(ctx, STUB_DEPOSIT_DRY_RUN),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("100000000000000000");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.precommitment).toBe("12345678901234567890");
    expect(json.balanceSufficient).toBe(true);
    expect(stderr).toBe("");
  });

  test("JSON mode: balanceSufficient can be 'unknown'", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderDepositDryRun(ctx, { ...STUB_DEPOSIT_DRY_RUN, balanceSufficient: "unknown" }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.balanceSufficient).toBe("unknown");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderDepositDryRun(ctx, STUB_DEPOSIT_DRY_RUN),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run complete");
    expect(stderr).toContain("Chain: sepolia");
    expect(stderr).toContain("Asset: ETH");
    expect(stderr).toContain("Pool Account: PA-1");
    expect(stderr).toContain("Balance sufficient: yes");
  });
});

// ── renderDepositSuccess parity ─────────────────────────────────────────────

const STUB_DEPOSIT_SUCCESS: DepositSuccessData = {
  txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  amount: 100000000000000000n,
  committedValue: 99500000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  label: 789n,
  blockNumber: 12345n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0xaabb",
};

describe("renderDepositSuccess parity", () => {
  test("JSON mode: emits deposit success envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderDepositSuccess(ctx, STUB_DEPOSIT_SUCCESS),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.txHash).toBe(STUB_DEPOSIT_SUCCESS.txHash);
    expect(json.amount).toBe("100000000000000000");
    expect(json.committedValue).toBe("99500000000000000");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.label).toBe("789");
    expect(json.blockNumber).toBe("12345");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0xaabb");
    expect(stderr).toBe("");
  });

  test("JSON mode: handles undefined committedValue and label", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_DEPOSIT_SUCCESS, committedValue: undefined, label: undefined };
    const { stdout } = captureOutput(() => renderDepositSuccess(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.committedValue).toBeNull();
    expect(json.label).toBeNull();
  });

  test("human mode: emits deposit success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderDepositSuccess(ctx, STUB_DEPOSIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Deposit submitted:");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Net deposited");
    expect(stderr).toContain("after vetting fee");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).toContain("pending approval");
    expect(stderr).toContain("privacy-pools accounts --chain sepolia");
  });

  test("human mode: omits Net deposited when committedValue is undefined", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_DEPOSIT_SUCCESS, committedValue: undefined };
    const { stderr } = captureOutput(() => renderDepositSuccess(ctx, data));

    expect(stderr).not.toContain("Net deposited");
  });

  test("human mode: omits Explorer when explorerUrl is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_DEPOSIT_SUCCESS, explorerUrl: null };
    const { stderr } = captureOutput(() => renderDepositSuccess(ctx, data));

    expect(stderr).not.toContain("Explorer:");
  });
});

// ── renderRagequitDryRun parity ─────────────────────────────────────────────

const STUB_RAGEQUIT_DRY_RUN: RagequitDryRunData = {
  chain: "sepolia",
  asset: "ETH",
  amount: 500000000000000000n,
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  selectedCommitmentLabel: 456n,
  selectedCommitmentValue: 500000000000000000n,
  proofPublicSignals: 7,
};

describe("renderRagequitDryRun parity", () => {
  test("JSON mode: emits dry-run envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitDryRun(ctx, STUB_RAGEQUIT_DRY_RUN),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("500000000000000000");
    expect(json.poolAccountNumber).toBe(2);
    expect(json.poolAccountId).toBe("PA-2");
    expect(json.selectedCommitmentLabel).toBe("456");
    expect(json.selectedCommitmentValue).toBe("500000000000000000");
    expect(json.proofPublicSignals).toBe(7);
    expect(stderr).toBe("");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitDryRun(ctx, STUB_RAGEQUIT_DRY_RUN),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run complete");
    expect(stderr).toContain("Chain: sepolia");
    expect(stderr).toContain("Asset: ETH");
    expect(stderr).toContain("Pool Account: PA-2");
  });
});

// ── renderRagequitSuccess parity ────────────────────────────────────────────

const STUB_RAGEQUIT_SUCCESS: RagequitSuccessData = {
  txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  blockNumber: 67890n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0x1122",
};

describe("renderRagequitSuccess parity", () => {
  test("JSON mode: emits ragequit success envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.txHash).toBe(STUB_RAGEQUIT_SUCCESS.txHash);
    expect(json.amount).toBe("500000000000000000");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(2);
    expect(json.poolAccountId).toBe("PA-2");
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.blockNumber).toBe("67890");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0x1122");
    expect(json.nextStep).toContain("privacy-pools accounts");
    expect(stderr).toBe("");
  });

  test("human mode: emits exit success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Exit (ragequit) PA-2");
    expect(stderr).toContain("withdrew");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).toContain("privacy-pools accounts");
  });

  test("human mode: omits Explorer when explorerUrl is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_RAGEQUIT_SUCCESS, explorerUrl: null };
    const { stderr } = captureOutput(() => renderRagequitSuccess(ctx, data));

    expect(stderr).not.toContain("Explorer:");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderWithdrawDryRun parity ─────────────────────────────────────────────

const STUB_WITHDRAW_DRY_RUN_DIRECT: WithdrawDryRunData = {
  withdrawMode: "direct",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  recipient: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  selectedCommitmentLabel: 456n,
  selectedCommitmentValue: 500000000000000000n,
  proofPublicSignals: 7,
};

const STUB_WITHDRAW_DRY_RUN_RELAYED: WithdrawDryRunData = {
  withdrawMode: "relayed",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  selectedCommitmentLabel: 789n,
  selectedCommitmentValue: 500000000000000000n,
  proofPublicSignals: 7,
  feeBPS: "50",
  quoteExpiresAt: "2025-06-01T00:00:00.000Z",
};

describe("renderWithdrawDryRun parity", () => {
  test("JSON mode (direct): emits dry-run envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_DIRECT),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("direct");
    expect(json.dryRun).toBe(true);
    expect(json.amount).toBe("500000000000000000");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.recipient).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.selectedCommitmentLabel).toBe("456");
    expect(json.selectedCommitmentValue).toBe("500000000000000000");
    expect(json.proofPublicSignals).toBe(7);
    expect(json.feeBPS).toBeUndefined();
    expect(json.quoteExpiresAt).toBeUndefined();
    expect(stderr).toBe("");
  });

  test("JSON mode (relayed): includes feeBPS and quoteExpiresAt", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_RELAYED),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("relayed");
    expect(json.dryRun).toBe(true);
    expect(json.feeBPS).toBe("50");
    expect(json.quoteExpiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(stderr).toBe("");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run complete");
    expect(stderr).toContain("Mode: direct");
    expect(stderr).toContain("Pool Account: PA-1");
  });
});

// ── renderWithdrawSuccess parity ────────────────────────────────────────────

const STUB_WITHDRAW_SUCCESS_DIRECT: WithdrawSuccessData = {
  withdrawMode: "direct",
  txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  blockNumber: 12345n,
  amount: 500000000000000000n,
  recipient: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0xaabb",
};

const STUB_WITHDRAW_SUCCESS_RELAYED: WithdrawSuccessData = {
  withdrawMode: "relayed",
  txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
  blockNumber: 67890n,
  amount: 500000000000000000n,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0x1122",
  feeBPS: "50",
};

describe("renderWithdrawSuccess parity", () => {
  test("JSON mode (direct): emits success envelope with fee=null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.txHash).toBe(STUB_WITHDRAW_SUCCESS_DIRECT.txHash);
    expect(json.blockNumber).toBe("12345");
    expect(json.amount).toBe("500000000000000000");
    expect(json.recipient).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
    expect(json.fee).toBeNull();
    expect(json.feeBPS).toBeUndefined();
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0xaabb");
    expect(json.nextStep).toContain("privacy-pools accounts");
    expect(json.nextStep).toContain("direct withdrawal links");
    expect(stderr).toBe("");
  });

  test("JSON mode (relayed): includes feeBPS, no fee=null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("relayed");
    expect(json.feeBPS).toBe("50");
    expect(json.fee).toBeUndefined();
    expect(json.nextStep).toContain("privacy-pools accounts");
    expect(json.nextStep).not.toContain("direct withdrawal links");
    expect(stderr).toBe("");
  });

  test("human mode (direct): emits withdrawal messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrew");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).not.toContain("Relay fee:");
    expect(stderr).toContain("privacy-pools accounts");
  });

  test("human mode (relayed): includes relay fee", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrew");
    expect(stderr).toContain("Relay fee: 0.50%");
    expect(stderr).toContain("privacy-pools accounts");
  });

  test("human mode: omits Explorer when explorerUrl is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_SUCCESS_DIRECT, explorerUrl: null };
    const { stderr } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    expect(stderr).not.toContain("Explorer:");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderWithdrawQuote parity ──────────────────────────────────────────────

const STUB_WITHDRAW_QUOTE: WithdrawQuoteData = {
  chain: "sepolia",
  asset: "ETH",
  amount: 500000000000000000n,
  decimals: 18,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  minWithdrawAmount: "100000000000000000",
  maxRelayFeeBPS: 100n,
  quoteFeeBPS: "50",
  feeCommitmentPresent: true,
  quoteExpiresAt: "2025-06-01T00:00:00.000Z",
};

describe("renderWithdrawQuote parity", () => {
  test("JSON mode: emits quote envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("500000000000000000");
    expect(json.recipient).toBe("0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB");
    expect(json.minWithdrawAmount).toBe("100000000000000000");
    expect(typeof json.minWithdrawAmountFormatted).toBe("string");
    expect(json.maxRelayFeeBPS).toBe("100");
    expect(json.quoteFeeBPS).toBe("50");
    expect(json.feeCommitmentPresent).toBe(true);
    expect(json.quoteExpiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(stderr).toBe("");
  });

  test("JSON mode: handles null recipient and quoteExpiresAt", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_WITHDRAW_QUOTE, recipient: null, quoteExpiresAt: null };
    const { stdout } = captureOutput(() => renderWithdrawQuote(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.recipient).toBeNull();
    expect(json.quoteExpiresAt).toBeNull();
  });

  test("human mode: emits quote messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrawal quote");
    expect(stderr).toContain("Asset: ETH");
    expect(stderr).toContain("Quoted fee: 0.50%");
    expect(stderr).toContain("Onchain max fee: 1.00%");
    expect(stderr).toContain("Recipient:");
    expect(stderr).toContain("Quote expires:");
  });

  test("human mode: omits Recipient and Quote expires when null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_QUOTE, recipient: null, quoteExpiresAt: null };
    const { stderr } = captureOutput(() => renderWithdrawQuote(ctx, data));

    expect(stderr).not.toContain("Recipient:");
    expect(stderr).not.toContain("Quote expires:");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});
