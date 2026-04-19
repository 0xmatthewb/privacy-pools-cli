/**
 * Transaction receipt safety conformance.
 *
 * Every fund-moving command (deposit, withdraw, ragequit) MUST check the
 * receipt status before treating the transaction as successful.  A missing
 * check means the CLI could report success on a reverted transaction,
 * leading to incorrect account state and potential loss of funds.
 *
 * In addition to verifying *presence* of the check, we verify *ordering*:
 * every receipt-status guard must appear before the corresponding success
 * output call (renderer or printJsonSuccess).
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

const FUND_MOVING_COMMANDS = [
  {
    file: "src/commands/deposit.ts",
    revertMessage: "Deposit transaction reverted",
    confirmedSuccessPattern:
      /if \(receipt\.status !== "success"\)[\s\S]*?persistWithReconciliation\([\s\S]*?renderDepositSuccess\(/,
  },
  {
    file: "src/commands/withdraw.ts",
    revertMessage: "transaction reverted",
    confirmedSuccessPattern:
      /if \(receipt\.status !== "success"\)[\s\S]*?persistWithReconciliation\([\s\S]*?renderWithdrawSuccess\(/g,
  },
  {
    file: "src/commands/ragequit.ts",
    revertMessage: "Ragequit transaction reverted",
    confirmedSuccessPattern:
      /if \(receipt\.status !== "success"\)[\s\S]*?persistWithReconciliation\([\s\S]*?renderRagequitSuccess\(/,
  },
] as const;

describe("transaction receipt safety conformance", () => {
  for (const { file, revertMessage, confirmedSuccessPattern } of FUND_MOVING_COMMANDS) {
    test(`${file} checks receipt status before confirmed success output`, () => {
      const source = readFileSync(`${CLI_ROOT}/${file}`, "utf8");

      // Must check receipt status for reverts
      expect(source).toContain('receipt.status !== "success"');
      expect(source).toContain(revertMessage);
      expect(source).toContain("persistWithReconciliation(");

      const matches = source.match(confirmedSuccessPattern);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThan(0);
    });
  }

  test("deposit command checks ERC20 approval receipt status", () => {
    const source = readFileSync(`${CLI_ROOT}/src/commands/deposit.ts`, "utf8");

    // ERC20 approval must verify receipt status, not just wait()
    expect(source).toContain("Approval transaction reverted");
    expect(source).toContain("approvalReceipt.status");

    // Approval must use waitForTransactionReceipt with timeout, not bare .wait()
    expect(source).toContain("getConfirmationTimeoutMs()");
    // The approval path should reference its own receipt variable
    const approvalReceiptPos = source.indexOf("approvalReceipt");
    expect(approvalReceiptPos).toBeGreaterThan(-1);
  });

  test("withdraw command checks receipt status for both direct and relayed paths", () => {
    const source = readFileSync(
      `${CLI_ROOT}/src/commands/withdraw.ts`,
      "utf8"
    );

    // Both the direct withdraw path and the relayed withdraw path must check
    const matches = source.match(/receipt\.status !== "success"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);

    // Both confirmed success paths must include a receipt check before the
    // persistence step and final renderer.
    const confirmedPathMatches = source.match(
      /if \(receipt\.status !== "success"\)[\s\S]*?persistWithReconciliation\([\s\S]*?renderWithdrawSuccess\(/g,
    );
    expect(confirmedPathMatches).not.toBeNull();
    expect(confirmedPathMatches!.length).toBeGreaterThanOrEqual(2);
  });
});
