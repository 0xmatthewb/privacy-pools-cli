/**
 * Transaction receipt safety conformance.
 *
 * Every fund-moving command (deposit, withdraw, ragequit) MUST check the
 * receipt status before treating the transaction as successful.  A missing
 * check means the CLI could report success on a reverted transaction,
 * leading to incorrect account state and potential loss of funds.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

const FUND_MOVING_COMMANDS = [
  {
    file: "src/commands/deposit.ts",
    revertMessage: "Deposit transaction reverted",
  },
  {
    file: "src/commands/withdraw.ts",
    revertMessage: "transaction reverted",
  },
  {
    file: "src/commands/ragequit.ts",
    revertMessage: "Ragequit transaction reverted",
  },
] as const;

describe("transaction receipt safety conformance", () => {
  for (const { file, revertMessage } of FUND_MOVING_COMMANDS) {
    test(`${file} checks receipt status before success output`, () => {
      const source = readFileSync(`${CLI_ROOT}/${file}`, "utf8");

      // Must check receipt status for reverts
      expect(source).toContain('receipt.status !== "success"');
      expect(source).toContain(revertMessage);
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
  });
});
