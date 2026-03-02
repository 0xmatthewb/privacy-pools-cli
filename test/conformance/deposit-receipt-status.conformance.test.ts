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
    successPattern: /renderDepositSuccess\(/,
  },
  {
    file: "src/commands/withdraw.ts",
    revertMessage: "transaction reverted",
    successPattern: /renderWithdrawSuccess\(/,
  },
  {
    file: "src/commands/ragequit.ts",
    revertMessage: "Ragequit transaction reverted",
    successPattern: /renderRagequitSuccess\(/,
  },
] as const;

describe("transaction receipt safety conformance", () => {
  for (const { file, revertMessage, successPattern } of FUND_MOVING_COMMANDS) {
    test(`${file} checks receipt status before success output`, () => {
      const source = readFileSync(`${CLI_ROOT}/${file}`, "utf8");

      // Must check receipt status for reverts
      expect(source).toContain('receipt.status !== "success"');
      expect(source).toContain(revertMessage);

      // Receipt check must appear *before* success renderer call.
      // This guards against the check being in dead code after the
      // success path.
      const receiptCheckPos = source.indexOf('receipt.status !== "success"');
      const successOutputPos = source.search(successPattern);

      expect(receiptCheckPos).toBeGreaterThan(-1);
      expect(successOutputPos).toBeGreaterThan(-1);
      expect(receiptCheckPos).toBeLessThan(successOutputPos);
    });
  }

  test("withdraw command checks receipt status for both direct and relayed paths", () => {
    const source = readFileSync(
      `${CLI_ROOT}/src/commands/withdraw.ts`,
      "utf8"
    );

    // Both the direct withdraw path and the relayed withdraw path must check
    const matches = source.match(/receipt\.status !== "success"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);

    // Each renderWithdrawSuccess call must be preceded by a receipt check.
    // Find all positions of both patterns and verify interleaving.
    const receiptPositions: number[] = [];
    const receiptRe = /receipt\.status !== "success"/g;
    let m: RegExpExecArray | null;
    while ((m = receiptRe.exec(source)) !== null) {
      receiptPositions.push(m.index);
    }

    const successPositions: number[] = [];
    const successRe = /renderWithdrawSuccess\(/g;
    while ((m = successRe.exec(source)) !== null) {
      successPositions.push(m.index);
    }

    // Every success call must have at least one receipt check before it
    for (const sp of successPositions) {
      const hasPrecedingCheck = receiptPositions.some((rp) => rp < sp);
      expect(hasPrecedingCheck).toBe(true);
    }
  });
});
