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
import { CLIError } from "../../src/utils/errors.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";

function expectNextAction(
  action: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  cliCommand: string,
): void {
  const { options, ...rest } = expected;
  const normalizedOptions =
    options && typeof options === "object"
      ? Object.fromEntries(
          Object.entries(options as Record<string, unknown>).filter(
            ([key]) => key !== "agent",
          ),
        )
      : undefined;
  expect(action).toMatchObject({
    ...rest,
    ...(normalizedOptions && Object.keys(normalizedOptions).length > 0
      ? { options: normalizedOptions }
      : {}),
  });
  expect((action?.options as Record<string, unknown> | undefined)?.agent).toBeUndefined();
  expect(action?.cliCommand).toBe(cliCommand);
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

// ── renderInitResult parity ─────────────────────────────────────────────────

describe("renderInitResult parity", () => {
  test("JSON mode: emits init envelope with generated recovery phrase redacted", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        setupMode: "create",
        readiness: "ready",
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showMnemonic: false,
        mnemonic: "test word one two three four five six seven eight nine ten eleven twelve",
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.recoveryPhraseRedacted).toBe(true);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "status",
        reason: "Verify wallet readiness and chain health before transacting.",
        when: "after_init",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools status --agent --chain sepolia",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: includes recovery phrase when showMnemonic is true", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const mnemonic = "test word one two three four five six seven eight nine ten eleven twelve";
    const { stdout } = captureOutput(() =>
      renderInitResult(ctx, {
        setupMode: "create",
        readiness: "read_only",
        defaultChain: "sepolia",
        signerKeySet: false,
        mnemonicImported: false,
        showMnemonic: true,
        mnemonic,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.recoveryPhrase).toBe(mnemonic);
    expect(json.recoveryPhraseRedacted).toBeUndefined();
  });

  test("JSON mode: omits recovery phrase fields when imported", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderInitResult(ctx, {
        setupMode: "restore",
        readiness: "ready",
        defaultChain: "mainnet",
        signerKeySet: true,
        mnemonicImported: true,
        showMnemonic: false,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBeUndefined();
    expect(json.defaultChain).toBe("mainnet");
  });

  test("human mode: emits success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        setupMode: "create",
        readiness: "ready",
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showCompletionTip: true,
        showMnemonic: false,
      }),
    );

    expect(stdout).toBe("");
    // Init completion outputs next-step commands to stderr via shared renderer.
    // Human path shows only "pools" (not "status" — that's a diagnostic, not a workflow step).
    expect(stderr).toContain("Setup complete!");
    expect(stderr).toContain("Next steps:");
    expect(stderr).not.toContain("privacy-pools status");
    expect(stderr).toContain("privacy-pools pools");
    expect(stderr).toContain("privacy-pools completion --help");
  });

  test("human mode: omits the completion tip after restore", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        setupMode: "restore",
        readiness: "ready",
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: true,
        showCompletionTip: false,
        showMnemonic: false,
      }),
    );

    expect(stderr).not.toContain("privacy-pools completion --help");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        setupMode: "create",
        readiness: "read_only",
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
  vettingFeeBPS: 50n,
  feeAmount: 500000000000000n,
  estimatedCommitted: 99500000000000000n,
  feesApply: true,
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

    const json = parseCapturedJson(stdout);
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
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "deposit",
        when: "after_dry_run",
        args: ["0.1", "ETH"],
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools deposit 0.1 ETH --agent --chain sepolia",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: balanceSufficient can be 'unknown'", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderDepositDryRun(ctx, { ...STUB_DEPOSIT_DRY_RUN, balanceSufficient: "unknown" }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.balanceSufficient).toBe("unknown");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderDepositDryRun(ctx, STUB_DEPOSIT_DRY_RUN),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run: validation succeeded. Re-run without --dry-run to submit.");
    expect(stderr).toContain("Deposit dry-run");
    expect(stderr).toMatch(/Chain:\s+sepolia/);
    expect(stderr).toMatch(/Asset:\s+ETH/);
    expect(stderr).toMatch(/Pool Account:\s+PA-1/);
    expect(stderr).toMatch(/Balance sufficient:\s+yes/);
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools deposit 0.1 ETH --chain sepolia");
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

    const json = parseCapturedJson(stdout);
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
    expect(json.nextActions).toBeArrayOfSize(2);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        reason: "Poll pending review for PA-1. When it disappears, re-run accounts --chain sepolia to confirm whether it was approved, declined, or needs Proof of Association.",
        when: "after_deposit",
        options: { agent: true, chain: "sepolia", pendingOnly: true },
      },
      "privacy-pools accounts --agent --chain sepolia --pending-only",
    );
    expectNextAction(
      json.nextActions[1],
      {
        command: "ragequit",
        reason: "If you decide not to wait for ASP review, ragequit remains available as a public recovery path for PA-1.",
        when: "after_deposit",
        args: ["ETH"],
        options: { agent: true, chain: "sepolia", poolAccount: "PA-1" },
      },
      "privacy-pools ragequit ETH --agent --chain sepolia --pool-account PA-1",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: handles undefined committedValue and label", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_DEPOSIT_SUCCESS, committedValue: undefined, label: undefined };
    const { stdout } = captureOutput(() => renderDepositSuccess(ctx, data));

    const json = parseCapturedJson(stdout);
    expect(json.committedValue).toBeNull();
    expect(json.label).toBeNull();
  });

  test("JSON mode: emits structured warnings alongside warningCode", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderDepositSuccess(ctx, {
        ...STUB_DEPOSIT_SUCCESS,
        warningCode: "LOCAL_STATE_RECONCILIATION_REQUIRED",
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.warningCode).toBe("LOCAL_STATE_RECONCILIATION_REQUIRED");
    expect(json.warnings).toEqual([
      expect.objectContaining({
        code: "LOCAL_STATE_RECONCILIATION_REQUIRED",
        category: "local_state",
      }),
    ]);
  });

  test("human mode: emits deposit success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderDepositSuccess(ctx, STUB_DEPOSIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Deposited");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Net deposited");
    expect(stderr).toContain("after ASP vetting fee");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).toContain("under Association Set Provider (ASP) review");
    expect(stderr).toContain("Association Set Provider (ASP)");
    expect(stderr).toContain("Deposited 0.1 ETH -> sepolia ETH pool");
    expect(countMatches(stderr, /Deposited 0\.1 ETH/g)).toBe(1);
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools accounts --chain sepolia --pending-only");
    expect(stderr).toContain(
      "When it disappears, re-run privacy-pools accounts --chain sepolia",
    );
    expect(stderr).toContain("privacy-pools ragequit ETH --chain sepolia --pool-account PA-1");
    expect(stderr).toContain("Welcome to the pool.");
  });

  test("human mode: omits first-deposit celebration when poolAccountNumber > 1", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_DEPOSIT_SUCCESS, poolAccountNumber: 3, poolAccountId: "PA-3" };
    const { stderr } = captureOutput(() => renderDepositSuccess(ctx, data));

    expect(stderr).not.toContain("Welcome to the pool");
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
  destinationAddress: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
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

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("500000000000000000");
    expect(json.destinationAddress).toBe("0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC");
    expect(json.poolAccountNumber).toBe(2);
    expect(json.poolAccountId).toBe("PA-2");
    expect(json.selectedCommitmentLabel).toBe("456");
    expect(json.selectedCommitmentValue).toBe("500000000000000000");
    expect(json.proofPublicSignals).toBe(7);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "ragequit",
        when: "after_dry_run",
        args: ["ETH"],
        options: { agent: true, chain: "sepolia", poolAccount: "PA-2" },
      },
      "privacy-pools ragequit ETH --agent --chain sepolia --pool-account PA-2 --confirm-ragequit",
    );
    expect(stderr).toBe("");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitDryRun(ctx, STUB_RAGEQUIT_DRY_RUN),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run: validation succeeded. Re-run without --dry-run to submit.");
    expect(stderr).toContain("Ragequit dry-run");
    expect(stderr).toMatch(/Chain:\s+sepolia/);
    expect(stderr).toMatch(/Asset:\s+ETH/);
    expect(stderr).toMatch(/Pool Account:\s+PA-2/);
    expect(stderr).toContain("Destination:");
    expect(stderr).toContain("Next steps:");
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
  destinationAddress: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
};

describe("renderRagequitSuccess parity", () => {
  test("JSON mode: emits ragequit success envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    const json = parseCapturedJson(stdout);
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
    expect(json.destinationAddress).toBe("0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC");
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        when: "after_ragequit",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools accounts --agent --chain sepolia",
    );
    expect(stderr).toBe("");
  });

  test("human mode: emits exit success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Ragequit 0.5 ETH");
    expect(countMatches(stderr, /Ragequit 0\.5 ETH/g)).toBe(1);
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("Destination:");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).toContain("Next steps:");
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

  test("JSON mode: emits structured warnings alongside warningCode for ragequit", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderRagequitSuccess(ctx, {
        ...STUB_RAGEQUIT_SUCCESS,
        warningCode: "LOCAL_STATE_RECONCILIATION_REQUIRED",
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.warningCode).toBe("LOCAL_STATE_RECONCILIATION_REQUIRED");
    expect(json.warnings).toEqual([
      expect.objectContaining({
        code: "LOCAL_STATE_RECONCILIATION_REQUIRED",
        category: "local_state",
      }),
    ]);
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

    const json = parseCapturedJson(stdout);
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
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "withdraw",
        when: "after_dry_run",
        args: ["0.5", "ETH"],
        options: {
          agent: true,
          chain: "sepolia",
          to: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
          poolAccount: "PA-1",
          direct: true,
          confirmDirectWithdraw: true,
        },
      },
      "privacy-pools withdraw 0.5 ETH --agent --chain sepolia --to 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa --pool-account PA-1 --direct --confirm-direct-withdraw",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode (relayed): includes feeBPS and quoteExpiresAt", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, {
        ...STUB_WITHDRAW_DRY_RUN_RELAYED,
        relayerHost: "https://relayer.example",
        quoteRefreshCount: 2,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.mode).toBe("relayed");
    expect(json.dryRun).toBe(true);
    expect(json.feeBPS).toBe("50");
    expect(json.quoteExpiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(json.relayerHost).toBe("https://relayer.example");
    expect(json.quoteRefreshCount).toBe(2);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "withdraw",
        when: "after_dry_run",
        args: ["0.5", "ETH"],
        options: {
          agent: true,
          chain: "sepolia",
          to: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
          poolAccount: "PA-2",
        },
      },
      "privacy-pools withdraw 0.5 ETH --agent --chain sepolia --to 0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB --pool-account PA-2",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: includes anonymitySet when available", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawDryRun(ctx, {
        ...STUB_WITHDRAW_DRY_RUN_RELAYED,
        anonymitySet: { eligible: 42, total: 128, percentage: 32.81 },
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.anonymitySet).toEqual({ eligible: 42, total: 128, percentage: 32.81 });
  });

  test("JSON mode: omits anonymitySet when not provided", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_DIRECT),
    );

    const json = parseCapturedJson(stdout);
    expect(json.anonymitySet).toBeUndefined();
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run: validation succeeded. Re-run without --dry-run to submit.");
    expect(stderr).toMatch(/Mode:\s+direct/);
    expect(stderr).toMatch(/Pool Account:\s+PA-1/);
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain(
      "privacy-pools withdraw 0.5 ETH --chain sepolia --to 0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa --pool-account PA-1 --direct --confirm-direct-withdraw",
    );
  });

  test("human mode: explains anonymity set without eligible jargon", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, {
        ...STUB_WITHDRAW_DRY_RUN_RELAYED,
        anonymitySet: { eligible: 42, total: 128, percentage: 32.81 },
      }),
    );

    expect(stderr).toContain("Anonymity set:");
    expect(stderr).toContain("42 of 128 deposits (32.8%; larger is more private)");
    expect(stderr).not.toContain("eligible");
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
  remainingBalance: 500000000000000000n,
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
  remainingBalance: 500000000000000000n,
};

describe("renderWithdrawSuccess parity", () => {
  test("JSON mode (direct): emits success envelope with fee=null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.txHash).toBe(STUB_WITHDRAW_SUCCESS_DIRECT.txHash);
    expect(json.blockNumber).toBe("12345");
    expect(json.amount).toBe("500000000000000000");
    expect(json.recipient).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
    expect(json.feeBPS).toBeNull();
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0xaabb");
    expect(json.remainingBalance).toBe("500000000000000000");
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        when: "after_withdraw",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools accounts --agent --chain sepolia",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode (relayed): includes feeBPS and remainingBalance, no fee=null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, {
        ...STUB_WITHDRAW_SUCCESS_RELAYED,
        relayerHost: "https://relayer.example",
        quoteRefreshCount: 1,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.mode).toBe("relayed");
    expect(json.feeBPS).toBe("50");
    expect(json.fee).toBeUndefined();
    expect(json.remainingBalance).toBe("500000000000000000");
    expect(json.relayerHost).toBe("https://relayer.example");
    expect(json.quoteRefreshCount).toBe(1);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        when: "after_withdraw",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools accounts --agent --chain sepolia",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: includes anonymitySet when available", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawSuccess(ctx, {
        ...STUB_WITHDRAW_SUCCESS_RELAYED,
        anonymitySet: { eligible: 42, total: 128, percentage: 32.81 },
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.anonymitySet).toEqual({ eligible: 42, total: 128, percentage: 32.81 });
  });

  test("JSON mode: emits structured warnings alongside warningCode for withdraw", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawSuccess(ctx, {
        ...STUB_WITHDRAW_SUCCESS_RELAYED,
        warningCode: "LOCAL_STATE_RECONCILIATION_REQUIRED",
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.warningCode).toBe("LOCAL_STATE_RECONCILIATION_REQUIRED");
    expect(json.warnings).toEqual([
      expect.objectContaining({
        code: "LOCAL_STATE_RECONCILIATION_REQUIRED",
        category: "local_state",
      }),
    ]);
  });

  test("JSON mode: omits anonymitySet when not provided", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    const json = parseCapturedJson(stdout);
    expect(json.anonymitySet).toBeUndefined();
  });

  test("human mode (direct): emits withdrawal messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrew");
    expect(countMatches(stderr, /Withdrew 0\.5 ETH/g)).toBe(1);
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).not.toContain("Relayer fee:");
    expect(stderr).toContain("Next steps:");
  });

  test("human mode (relayed): includes relayer fee", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrew");
    expect(stderr).toContain("Relayer fee:");
    expect(stderr).toContain("Next steps:");
  });

  test("human mode (relayed): explains success anonymity set without eligible jargon", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, {
        ...STUB_WITHDRAW_SUCCESS_RELAYED,
        anonymitySet: { eligible: 42, total: 128, percentage: 32.81 },
      }),
    );

    expect(stderr).toContain("Privacy note:");
    expect(stderr).toContain("42 of 128 deposits (32.8%; larger is more private)");
    expect(stderr).not.toContain("eligible");
  });

  test("human mode (direct): shows remaining balance", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    expect(stderr).toContain("Remaining in PA-1:");
    expect(stderr).toContain("ETH");
  });

  test("human mode (relayed): shows remaining balance", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    expect(stderr).toContain("Remaining in PA-2:");
    expect(stderr).toContain("ETH");
  });

  test("human mode: shows 'fully withdrawn' when remainingBalance is 0", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_SUCCESS_DIRECT, remainingBalance: 0n };
    const { stderr } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    expect(stderr).toContain("PA-1 fully withdrawn");
    expect(stderr).not.toContain("Remaining in PA-1:");
  });

  test("human mode (relayed): shows gas token received when extraGas is true", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_SUCCESS_RELAYED, extraGas: true };
    const { stderr } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    expect(stderr).toContain("Gas token received:");
  });

  test("human mode (relayed): omits gas token received when extraGas is falsy", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    expect(stderr).not.toContain("Gas token received");
  });

  test("human mode: shows USD values when tokenPrice is provided", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_SUCCESS_RELAYED, tokenPrice: 2000 };
    const { stderr } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    // Should show USD for net received and remaining balance
    expect(stderr).toContain("$");
    expect(stderr).toContain("Relayer fee:");
    expect(stderr).toContain("Remaining in PA-2:");
  });

  test("human mode: omits USD values when tokenPrice is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_SUCCESS_RELAYED, tokenPrice: null };
    const { stderr } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    // The line should still appear, but without a $ value
    expect(stderr).toContain("Relayer fee:");
    expect(stderr).toContain("Remaining in PA-2:");
    // Net received and remaining balance lines should NOT have "$"
    const lines = stderr.split("\n");
    const remainingLine = lines.find((l: string) => l.includes("Remaining in PA-2:"));
    expect(remainingLine).not.toContain("$");
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
  baseFeeBPS: "45",
  quoteFeeBPS: "50",
  feeCommitmentPresent: true,
  quoteExpiresAt: "2025-06-01T00:00:00.000Z",
  relayTxCost: { gas: "0", eth: "100000000000000" },
  tokenPrice: null,
};

describe("renderWithdrawQuote parity", () => {
  test("JSON mode: emits quote envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, {
        ...STUB_WITHDRAW_QUOTE,
        relayerHost: "https://relayer.example",
        quoteRefreshCount: 3,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("500000000000000000");
    expect(json.recipient).toBe("0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB");
    expect(json.minWithdrawAmount).toBe("100000000000000000");
    expect(typeof json.minWithdrawAmountFormatted).toBe("string");
    expect(json.quoteFeeBPS).toBe("50");
    expect(json.feeAmount).toBe("2500000000000000");
    expect(json.netAmount).toBe("497500000000000000");
    expect(json.feeCommitmentPresent).toBe(true);
    expect(json.quoteExpiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(json.relayerHost).toBe("https://relayer.example");
    expect(json.quoteRefreshCount).toBe(3);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "withdraw",
        reason: "Submit the withdrawal promptly if the quoted fee is acceptable.",
        when: "after_quote",
        args: ["0.5", "ETH"],
        options: {
          agent: true,
          chain: "sepolia",
          to: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
        },
      },
      "privacy-pools withdraw 0.5 ETH --agent --chain sepolia --to 0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode: handles null recipient and quoteExpiresAt", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_WITHDRAW_QUOTE, recipient: null, quoteExpiresAt: null };
    const { stdout } = captureOutput(() => renderWithdrawQuote(ctx, data));

    const json = parseCapturedJson(stdout);
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
    expect(stderr).toMatch(/Asset:\s+ETH/);
    expect(stderr).toContain("Relayer fee:");
    expect(stderr).toContain("You receive:");
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

  test("human mode: shows USD values when tokenPrice is provided", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_QUOTE, tokenPrice: 2000 };
    const { stderr } = captureOutput(() => renderWithdrawQuote(ctx, data));

    expect(stderr).toContain("$");
    expect(stderr).toContain("Relayer fee:");
    expect(stderr).toContain("You receive:");
  });

  test("human mode: omits USD when tokenPrice is null", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    expect(stderr).not.toContain("$");
    expect(stderr).toContain("Relayer fee:");
    expect(stderr).toContain("You receive:");
  });

  test("human mode: omits --chain when chainOverridden is falsy", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools withdraw");
    expect(stderr).not.toContain("--chain");
  });

  test("human mode: includes --chain when chainOverridden is true", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, { ...STUB_WITHDRAW_QUOTE, chainOverridden: true }),
    );

    expect(stderr).toContain("--chain sepolia");
  });

  test("human mode: suppresses next steps when fee makes withdrawal uneconomical", () => {
    const ctx = createOutputContext(makeMode());
    // Fee of 10100 BPS = 101%, meaning netAmount < 0
    const { stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, { ...STUB_WITHDRAW_QUOTE, quoteFeeBPS: "10100" }),
    );

    expect(stderr).toContain("Withdrawal quote");
    expect(stderr).toContain("You receive:");
    expect(stderr).not.toContain("Next steps:");
  });

  test("JSON mode: still emits agent nextActions even when fee is uneconomical", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawQuote(ctx, { ...STUB_WITHDRAW_QUOTE, quoteFeeBPS: "10100" }),
    );

    const json = parseCapturedJson(stdout);
    // Agent still gets the action — they can decide for themselves
    expect(json.nextActions.length).toBeGreaterThan(0);
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

// ── CSV guard: transactional renderers throw on --output csv ────────────────

describe("CSV guard: transactional renderers", () => {
  const csvCtx = createOutputContext(makeMode({ isCsv: true }));

  test("renderDepositDryRun throws CLIError for CSV", () => {
    expect(() => renderDepositDryRun(csvCtx, STUB_DEPOSIT_DRY_RUN)).toThrow(CLIError);
  });

  test("renderDepositSuccess throws CLIError for CSV", () => {
    expect(() => renderDepositSuccess(csvCtx, STUB_DEPOSIT_SUCCESS)).toThrow(CLIError);
  });

  test("renderRagequitDryRun throws CLIError for CSV", () => {
    expect(() => renderRagequitDryRun(csvCtx, STUB_RAGEQUIT_DRY_RUN)).toThrow(CLIError);
  });

  test("renderRagequitSuccess throws CLIError for CSV", () => {
    expect(() => renderRagequitSuccess(csvCtx, STUB_RAGEQUIT_SUCCESS)).toThrow(CLIError);
  });

  test("renderWithdrawDryRun throws CLIError for CSV", () => {
    expect(() => renderWithdrawDryRun(csvCtx, STUB_WITHDRAW_DRY_RUN_DIRECT)).toThrow(CLIError);
  });

  test("renderWithdrawSuccess throws CLIError for CSV", () => {
    expect(() => renderWithdrawSuccess(csvCtx, STUB_WITHDRAW_SUCCESS_DIRECT)).toThrow(CLIError);
  });

  test("renderWithdrawQuote throws CLIError for CSV", () => {
    expect(() => renderWithdrawQuote(csvCtx, STUB_WITHDRAW_QUOTE)).toThrow(CLIError);
  });
});
