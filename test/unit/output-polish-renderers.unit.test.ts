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

    expect(output).toContain("Withdrawal review");
    expect(output).toContain("Source PA");
    expect(output).toContain("PA-7");
    expect(output).toContain("Relayer fee");
    expect(output).toContain("Gas token received");
    expect(output).toContain("Net received");
    expect(output).toContain("Quote expiry");
    expect(output).toContain("The remaining balance would fall below the relayer minimum.");
  });
});

describe("shared runtime review renderers", () => {
  test("deposit review and privacy override warning share the composed layout", () => {
    const deposit = formatDepositReview({
      amount: 100_000_000_000_000_000n,
      feeAmount: 5_000_000_000_000_000n,
      estimatedCommitted: 95_000_000_000_000_000n,
      asset: "ETH",
      chain: "sepolia",
      decimals: 18,
      tokenPrice: 3200,
      isErc20: false,
    });
    const privacy = formatUniqueAmountReview(
      "0.123456789 ETH is a non-round amount that may reduce your privacy in the anonymity set.",
    );

    expect(deposit).toContain("Deposit review");
    expect(deposit).toContain("Vetting fee");
    expect(deposit).toContain("Net deposited");
    expect(deposit).toContain("Deposits stay public until ASP review finishes.");
    expect(privacy).toContain("Privacy review");
    expect(privacy).toContain("non-round amount");
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
      currentVersion: "1.7.0",
      latestVersion: "1.8.0",
      installContext: {
        kind: "npm_global",
        supportedAutoRun: true,
        reason: "Global npm installation detected.",
      },
      command: "npm install -g privacy-pools-cli@1.8.0",
    });

    expect(direct).toContain("Direct withdrawal review");
    expect(direct).toContain("public onchain withdrawal");
    expect(ragequit).toContain("Public recovery review");
    expect(ragequit).toContain("privacy is lost");
    expect(flow).toContain("Flow start review");
    expect(flow).toContain("Dedicated workflow wallet");
    expect(upgrade).toContain("Upgrade review");
    expect(upgrade).toContain("Auto-run");
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

    expect(output).toContain("Workflow wallet backup");
    expect(output).toContain("Backup mode");
    expect(output).toContain("Manual copy");
    expect(output).toContain("Recovery key:");
    expect(output).toContain(privateKey);
    expect(output).toContain("This is a live recovery key.");
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

    expect(saved).toContain("Saved to file");
    expect(saved).toContain("/tmp/workflow-wallet.txt");
    expect(saved).toContain("live recovery key");
    expect(confirm).toContain("Confirm workflow wallet backup");
    expect(confirm).toContain("Confirmed backup");
    expect(confirm).toContain("Do not continue unless this recovery key is stored somewhere you trust.");
  });

  test("choice and path reviews keep the backup flow visually consistent", () => {
    const choice = renderWorkflowWalletBackupChoiceReview({
      walletAddress: "0x2222222222222222222222222222222222222222",
    });
    const path = renderWorkflowWalletBackupPathReview({
      walletAddress: "0x2222222222222222222222222222222222222222",
    });

    expect(choice).toContain("Choose a backup method");
    expect(choice).toContain("Back up this generated wallet before funding it.");
    expect(path).toContain("Save workflow wallet backup");
    expect(path).toContain("live workflow-wallet private key");
  });
});

describe("init recovery backup renderers", () => {
  test("generated recovery phrase and backup confirmations use structured surfaces", () => {
    const phrase = renderGeneratedRecoveryPhraseReview(
      "test test test test test test test test test test test junk",
    );
    const method = renderInitBackupMethodReview();
    const path = renderInitBackupPathReview("/tmp/privacy-pools-recovery.txt");
    const saved = renderInitBackupSaved("/tmp/privacy-pools-recovery.txt");
    const confirm = renderInitBackupConfirmationReview(
      "file",
      "/tmp/privacy-pools-recovery.txt",
    );
    const overwrite = renderInitOverwriteReview(true);

    expect(phrase).toContain("Recovery phrase");
    expect(phrase).toContain("only time the CLI will display it");
    expect(method).toContain("Back up recovery phrase");
    expect(path).toContain("Save recovery phrase backup");
    expect(saved).toContain("Recovery phrase saved");
    expect(confirm).toContain("Confirm recovery phrase backup");
    expect(overwrite).toContain("Replace existing wallet setup");
  });
});

describe("renderUpgradeResult polished success surface", () => {
  test("human upgraded output is one coherent success story", () => {
    const ctx = createOutputContext(makeMode());
    const result: UpgradeResult = {
      mode: "upgrade",
      status: "upgraded",
      currentVersion: "1.6.0",
      latestVersion: "1.7.0",
      updateAvailable: true,
      performed: true,
      command: "npm install -g privacy-pools-cli@1.7.0",
      installContext: {
        kind: "global_npm",
        supportedAutoRun: true,
        reason: "This CLI was detected as a global npm install.",
      },
      installedVersion: "1.7.0",
    };

    const { stdout, stderr } = captureOutput(() =>
      renderUpgradeResult(ctx, result),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Upgraded privacy-pools-cli to 1.7.0.");
    expect(stderr).toContain("Previous version");
    expect(stderr).toContain("Installed version");
    expect(stderr).toContain("Success:");
    expect(stderr).toContain("Re-run privacy-pools");
    expect(stderr).not.toContain("Update available:");
  });
});
