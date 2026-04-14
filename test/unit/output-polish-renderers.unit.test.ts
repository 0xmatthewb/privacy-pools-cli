import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import {
  formatUpgradeInstallReview,
  renderUpgradeResult,
  type UpgradeResult,
} from "../../src/output/upgrade.ts";
import {
  renderWorkflowWalletBackupChoiceReview,
  renderWorkflowWalletBackupConfirmation,
  renderWorkflowWalletBackupManual,
  renderWorkflowWalletBackupPathReview,
  renderWorkflowWalletBackupSaved,
} from "../../src/output/workflow-wallet.ts";
import {
  formatDirectWithdrawalReview,
  formatRelayedWithdrawalReview,
} from "../../src/output/withdraw.ts";
import {
  formatDepositReview,
  formatUniqueAmountReview,
} from "../../src/output/deposit.ts";
import { formatRagequitReview } from "../../src/output/ragequit.ts";
import { formatFlowStartReview } from "../../src/output/flow.ts";
import {
  renderGeneratedRecoveryPhraseReview,
  renderInitBackupConfirmationReview,
  renderInitBackupMethodReview,
  renderInitBackupPathReview,
  renderInitBackupSaved,
  renderInitOverwriteReview,
} from "../../src/output/init.ts";
import { captureOutput, makeMode } from "../helpers/output.ts";
import {
  expectSemanticText,
  stripAnsi,
} from "../helpers/contract-assertions.ts";

describe("formatRelayedWithdrawalReview", () => {
  test("renders the shared review surface for relayed withdrawals", () => {
    const output = formatRelayedWithdrawalReview({
      poolAccountId: "PA-7",
      poolAccountBalance: 100_000_000n,
      amount: 90_000_000n,
      asset: "USDC",
      chain: "sepolia",
      decimals: 6,
      recipient: "0x1111111111111111111111111111111111111111",
      quoteFeeBPS: 100n,
      expirationMs: Date.parse("2026-03-24T13:00:00.000Z"),
      remainingBalance: 10_000_000n,
      extraGasRequested: true,
      extraGasFundAmount: 1_500_000_000_000_000n,
      remainingBelowMinAdvisory:
        "The remaining balance would fall below the relayer minimum.",
      tokenPrice: 1,
      nowMs: Date.parse("2026-03-24T12:59:30.000Z"),
    });

    expectSemanticText(output, {
      includes: [
        "Withdrawal review",
        "PA-7",
        "The remaining balance would fall below the relayer minimum.",
      ],
      patterns: [/pool account/i, /balance/i, /relayer fee/i, /gas token/i, /net received/i, /quote expiry/i],
    });
  });

  test("keeps boxed review spacing to a single blank line between sections", () => {
    const lines = stripAnsi(formatRelayedWithdrawalReview({
      poolAccountId: "PA-7",
      poolAccountBalance: 100_000_000n,
      amount: 90_000_000n,
      asset: "USDC",
      chain: "sepolia",
      decimals: 6,
      recipient: "0x1111111111111111111111111111111111111111",
      quoteFeeBPS: 100n,
      expirationMs: Date.parse("2026-03-24T13:00:00.000Z"),
      remainingBalance: 10_000_000n,
      extraGasRequested: true,
      extraGasFundAmount: 1_500_000_000_000_000n,
      remainingBelowMinAdvisory:
        "The remaining balance would fall below the relayer minimum.",
      tokenPrice: 1,
      nowMs: Date.parse("2026-03-24T12:59:30.000Z"),
    })).split("\n");

    let consecutiveBlankBoxLines = 0;
    let maxBlankRun = 0;

    for (const line of lines) {
      if (/^[│|]\s*[│|]$/.test(line)) {
        consecutiveBlankBoxLines += 1;
        maxBlankRun = Math.max(maxBlankRun, consecutiveBlankBoxLines);
      } else {
        consecutiveBlankBoxLines = 0;
      }
    }

    expect(maxBlankRun).toBe(0);
  });
});

describe("shared runtime review renderers", () => {
  test("deposit review and privacy override warning share the composed layout", () => {
    const deposit = formatDepositReview({
      amount: 100_000_000_000_000_000n,
      feeAmount: 5_000_000_000_000_000n,
      estimatedCommitted: 95_000_000_000_000_000n,
      vettingFeeBPS: 500n,
      asset: "ETH",
      chain: "sepolia",
      decimals: 18,
      tokenPrice: 3200,
      isErc20: false,
    });
    const privacy = formatUniqueAmountReview(
      "0.123456789 ETH is a non-round amount that may reduce your privacy in the anonymity set.",
    );

    expectSemanticText(deposit, {
      includes: ["Deposit review", "Vetting fee", "Net deposited", "Deposits are always public on-chain."],
    });
    expectSemanticText(privacy, {
      includes: ["Privacy review", "non-round amount"],
    });
  });

  test("direct withdrawal, ragequit, flow start, and upgrade review surfaces are structured", () => {
    const direct = formatDirectWithdrawalReview({
      poolAccountId: "PA-1",
      amount: 300_000_000_000_000_000n,
      asset: "ETH",
      chain: "sepolia",
      decimals: 18,
      recipient: "0x1111111111111111111111111111111111111111",
      tokenPrice: 3200,
    });
    const ragequit = formatRagequitReview({
      poolAccountId: "PA-3",
      amount: 400_000_000_000_000_000n,
      asset: "ETH",
      chain: "sepolia",
      decimals: 18,
      destinationAddress: "0x2222222222222222222222222222222222222222",
    });
    const flow = formatFlowStartReview({
      amount: 100_000_000_000_000_000n,
      feeAmount: 5_000_000_000_000_000n,
      estimatedCommitted: 95_000_000_000_000_000n,
      asset: "ETH",
      chain: "sepolia",
      decimals: 18,
      recipient: "0x3333333333333333333333333333333333333333",
      privacyDelaySummary: "Balanced (15-90 minutes)",
      newWallet: true,
      isErc20: false,
      tokenPrice: 3200,
    });
    const upgrade = formatUpgradeInstallReview({
      currentVersion: "2.0.0",
      latestVersion: "1.8.0",
      installContext: {
        kind: "npm_global",
        supportedAutoRun: true,
        reason: "Global npm installation detected.",
      },
      command: "npm install -g privacy-pools-cli@1.8.0",
    });

    expectSemanticText(direct, {
      includes: ["Direct withdrawal review", "public onchain withdrawal"],
    });
    expectSemanticText(ragequit, {
      includes: ["Ragequit review", "will not gain any privacy"],
    });
    expectSemanticText(flow, {
      includes: ["Flow start review", "Dedicated workflow wallet"],
    });
    expectSemanticText(upgrade, {
      includes: ["Upgrade review", "Auto-run"],
    });
  });
});

describe("workflow wallet backup renderers", () => {
  test("manual-copy mode isolates the recovery key and warning state", () => {
    const privateKey =
      "0x99a5cddd389f163d3c8ac8f1d5eaa43475062d353cc81aa1135276c30d22f7dc";
    const output = renderWorkflowWalletBackupManual({
      walletAddress: "0x2222222222222222222222222222222222222222",
      privateKey,
    });

    expectSemanticText(output, {
      includes: [
        "Workflow wallet backup",
        "Backup mode",
        "Manual copy",
        "Recovery key:",
        privateKey,
        "This is a live recovery key.",
      ],
    });
  });

  test("saved-file and confirmation states share the structured backup layout", () => {
    const saved = renderWorkflowWalletBackupSaved({
      walletAddress: "0x2222222222222222222222222222222222222222",
      backupPath: "/tmp/workflow-wallet.txt",
    });
    const confirm = renderWorkflowWalletBackupConfirmation({
      walletAddress: "0x2222222222222222222222222222222222222222",
      backupPath: "/tmp/workflow-wallet.txt",
    });

    expectSemanticText(saved, {
      includes: ["Saved to file", "/tmp/workflow-wallet.txt", "live recovery key"],
    });
    expectSemanticText(confirm, {
      includes: [
        "Confirm workflow wallet backup",
        "Confirmed backup",
        "Do not continue unless this recovery key is stored somewhere you trust.",
      ],
    });
  });

  test("choice and path reviews keep the backup flow visually consistent", () => {
    const choice = renderWorkflowWalletBackupChoiceReview({
      walletAddress: "0x2222222222222222222222222222222222222222",
    });
    const path = renderWorkflowWalletBackupPathReview({
      walletAddress: "0x2222222222222222222222222222222222222222",
    });

    expectSemanticText(choice, {
      includes: ["Choose a backup method", "Back up this generated wallet before funding it."],
    });
    expectSemanticText(path, {
      includes: ["Save workflow wallet backup", "live workflow-wallet private key"],
    });
  });
});

describe("init recovery backup renderers", () => {
  test("generated recovery phrase and backup confirmations use structured surfaces", () => {
    const backupPath = "/tmp/privacy-pools-recovery.txt";
    const phrase = renderGeneratedRecoveryPhraseReview(
      "test test test test test test test test test test test junk",
    );
    const method = renderInitBackupMethodReview();
    const path = renderInitBackupPathReview(backupPath);
    const saved = renderInitBackupSaved(backupPath);
    const confirm = renderInitBackupConfirmationReview(
      "file",
      backupPath,
    );
    const overwrite = renderInitOverwriteReview(true);

    expect(phrase).toContain("Recovery phrase");
    expect(phrase).toMatch(/\b1\.\s+test\b/);
    expect(phrase).toMatch(/\b12\.\s+junk\b/);
    expect(phrase).toMatch(/danger|warning/i);
    expect(phrase).toMatch(/anyone with this phrase/i);
    expect(method).toMatch(/recovery phrase/i);
    expect(method).toMatch(/choose how you want to secure this phrase/i);
    expect(path).toContain(backupPath);
    expect(path).toMatch(/live recovery phrase/i);
    expect(path).toMatch(/delete the original|secure/i);
    expect(saved).toContain(backupPath);
    expect(saved).toMatch(/secure location|stored/i);
    expect(confirm).toContain(backupPath);
    expect(confirm).toMatch(/saved to file/i);
    expect(confirm).toMatch(/do not continue unless this recovery phrase is stored/i);
    expect(overwrite).toMatch(/current setup/i);
    expect(overwrite).toMatch(/replace/i);
    expect(overwrite).toMatch(/next account/i);
  });
});

describe("renderUpgradeResult polished success surface", () => {
  test("human upgraded output is one coherent success story", () => {
    const ctx = createOutputContext(makeMode());
    const result: UpgradeResult = {
      mode: "upgrade",
      status: "upgraded",
      currentVersion: "1.6.0",
      latestVersion: "2.0.0",
      updateAvailable: true,
      performed: true,
      command: "npm install -g privacy-pools-cli@2.0.0",
      installContext: {
        kind: "global_npm",
        supportedAutoRun: true,
        reason: "This CLI was detected as a global npm install.",
      },
      installedVersion: "2.0.0",
    };

    const { stdout, stderr } = captureOutput(() =>
      renderUpgradeResult(ctx, result),
    );

    expect(stdout).toBe("");
    expectSemanticText(stderr, {
      includes: [
        "Upgraded privacy-pools-cli to 2.0.0.",
        "Previous version",
        "Installed version",
        "Success:",
        "Re-run privacy-pools",
      ],
      excludes: ["Update available:"],
    });
  });
});
