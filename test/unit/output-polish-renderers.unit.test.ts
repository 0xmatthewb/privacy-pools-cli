import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderUpgradeResult, type UpgradeResult } from "../../src/output/upgrade.ts";
import {
  renderWorkflowWalletBackupConfirmation,
  renderWorkflowWalletBackupManual,
  renderWorkflowWalletBackupSaved,
} from "../../src/output/workflow-wallet.ts";
import { formatRelayedWithdrawalReview } from "../../src/output/withdraw.ts";
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
