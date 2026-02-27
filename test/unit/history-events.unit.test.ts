import { describe, expect, test } from "bun:test";
import { buildHistoryEventsFromAccount } from "../../src/commands/history.ts";

describe("history event extraction", () => {
  test("uses remaining Pool Account value for ragequit after withdrawals", () => {
    const scope = 777n;
    const deposit = {
      label: 1n as any,
      hash: 11n as any,
      value: 100n,
      blockNumber: 10n,
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      nullifier: 1n as any,
      secret: 2n as any,
    };
    const childAfterWithdraw = {
      ...deposit,
      hash: 22n as any,
      value: 60n,
      blockNumber: 20n,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    };

    const account = {
      poolAccounts: new Map([
        [scope as any, [
          {
            label: deposit.label,
            deposit,
            children: [childAfterWithdraw],
            ragequit: {
              ragequitter: "0x0000000000000000000000000000000000000001",
              commitment: childAfterWithdraw.hash,
              label: childAfterWithdraw.label,
              value: childAfterWithdraw.value,
              blockNumber: 30n,
              transactionHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
            },
          },
        ]],
      ]),
    };

    const pools = [
      {
        symbol: "USDC",
        pool: "0x0000000000000000000000000000000000000abc",
        scope,
      },
    ];

    const events = buildHistoryEventsFromAccount(account as any, pools as any);
    const withdrawal = events.find((e) => e.type === "withdrawal");
    const ragequit = events.find((e) => e.type === "ragequit");

    expect(withdrawal?.value).toBe(40n);
    expect(ragequit?.value).toBe(60n);
  });
});

