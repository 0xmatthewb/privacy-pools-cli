import { describe, expect, test } from "bun:test";
import { buildHistoryEventsFromAccount } from "../../src/commands/history.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDeposit(overrides: Record<string, unknown> = {}) {
  return {
    label: 1n as any,
    hash: 11n as any,
    value: 100n,
    blockNumber: 10n,
    txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    nullifier: 1n as any,
    secret: 2n as any,
    ...overrides,
  };
}

function makePoolAccount(
  deposit: ReturnType<typeof makeDeposit>,
  children: ReturnType<typeof makeDeposit>[] = [],
  ragequit?: Record<string, unknown>
) {
  return {
    label: deposit.label,
    deposit,
    children,
    ragequit: ragequit ?? null,
  };
}

function makeAccount(scope: bigint, poolAccounts: ReturnType<typeof makePoolAccount>[]) {
  return {
    poolAccounts: new Map([[scope as any, poolAccounts]]),
  };
}

const POOL_USDC = {
  symbol: "USDC",
  pool: "0x0000000000000000000000000000000000000abc",
  scope: 777n,
};

const POOL_ETH = {
  symbol: "ETH",
  pool: "0x0000000000000000000000000000000000000def",
  scope: 888n,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("history event extraction", () => {
  test("uses remaining Pool Account value for ragequit after withdrawals", () => {
    const deposit = makeDeposit();
    const childAfterWithdraw = makeDeposit({
      hash: 22n,
      value: 60n,
      blockNumber: 20n,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [childAfterWithdraw], {
        ragequitter: "0x0000000000000000000000000000000000000001",
        commitment: childAfterWithdraw.hash,
        label: childAfterWithdraw.label,
        value: childAfterWithdraw.value,
        blockNumber: 30n,
        transactionHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      }),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const withdrawal = events.find((e) => e.type === "withdrawal");
    const ragequit = events.find((e) => e.type === "ragequit");

    expect(withdrawal?.value).toBe(40n);
    expect(ragequit?.value).toBe(60n);
  });

  test("deposit-only account produces a single deposit event", () => {
    const deposit = makeDeposit({ value: 500n });
    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("deposit");
    expect(events[0].value).toBe(500n);
    expect(events[0].asset).toBe("USDC");
    expect(events[0].paId).toBe("PA-1");
  });

  test("empty poolAccounts map returns empty events array", () => {
    const account = { poolAccounts: new Map() };
    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    expect(events).toHaveLength(0);
  });

  test("null/undefined account returns empty events array", () => {
    expect(buildHistoryEventsFromAccount(null, [POOL_USDC] as any)).toHaveLength(0);
    expect(buildHistoryEventsFromAccount(undefined, [POOL_USDC] as any)).toHaveLength(0);
  });

  test("account with scope not matching any pool skips those entries", () => {
    const deposit = makeDeposit();
    const account = makeAccount(999n, [makePoolAccount(deposit)]);

    // No pool has scope 999n
    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    expect(events).toHaveLength(0);
  });

  test("multiple deposits in the same scope produce correct PA numbering", () => {
    const dep1 = makeDeposit({ value: 100n, blockNumber: 10n });
    const dep2 = makeDeposit({ value: 200n, blockNumber: 20n, hash: 33n });
    const dep3 = makeDeposit({ value: 300n, blockNumber: 30n, hash: 44n });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(dep1),
      makePoolAccount(dep2),
      makePoolAccount(dep3),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const deposits = events.filter((e) => e.type === "deposit");
    expect(deposits).toHaveLength(3);
    expect(deposits[0].paId).toBe("PA-1");
    expect(deposits[0].value).toBe(100n);
    expect(deposits[1].paId).toBe("PA-2");
    expect(deposits[1].value).toBe(200n);
    expect(deposits[2].paId).toBe("PA-3");
    expect(deposits[2].value).toBe(300n);
  });

  test("multiple withdrawals from same PA produce correct deltas", () => {
    const deposit = makeDeposit({ value: 100n, blockNumber: 10n });
    const child1 = makeDeposit({
      hash: 22n, value: 70n, blockNumber: 20n,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });
    const child2 = makeDeposit({
      hash: 33n, value: 30n, blockNumber: 30n,
      txHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
    });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [child1, child2]),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const withdrawals = events.filter((e) => e.type === "withdrawal");
    expect(withdrawals).toHaveLength(2);
    // First withdrawal: 100 - 70 = 30
    expect(withdrawals[0].value).toBe(30n);
    // Second withdrawal: 70 - 30 = 40
    expect(withdrawals[1].value).toBe(40n);
  });

  test("zero-value withdrawal remains a zero-value history event", () => {
    const deposit = makeDeposit({ value: 100n, blockNumber: 10n });
    const child = makeDeposit({
      hash: 22n,
      value: 100n,
      blockNumber: 20n,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [child]),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const withdrawals = events.filter((e) => e.type === "withdrawal");

    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0].value).toBe(0n);
  });

  test("synthesized migration bookkeeping child is not rendered as withdrawal", () => {
    const depositTxHash =
      "0x4444444444444444444444444444444444444444444444444444444444444444";
    const deposit = makeDeposit({
      value: 100n,
      blockNumber: 20n,
      txHash: depositTxHash,
    });
    const migrationChild = makeDeposit({
      hash: 22n,
      value: 100n,
      blockNumber: 20n,
      txHash: depositTxHash,
    });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [migrationChild]),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("deposit");
    expect(events.some((event) => event.type === "withdrawal")).toBe(false);
  });

  test("migration children do not surface as user withdrawal history events", () => {
    const deposit = makeDeposit({ value: 100n, blockNumber: 10n });
    const migrationChild = makeDeposit({
      hash: 22n,
      value: 100n,
      blockNumber: 20n,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      isMigration: true,
    });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [migrationChild]),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const withdrawals = events.filter((e) => e.type === "withdrawal");

    expect(withdrawals).toHaveLength(0);
  });

  test("ragequit without prior withdrawals uses full deposit value", () => {
    const deposit = makeDeposit({ value: 250n });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [], {
        ragequitter: "0x0000000000000000000000000000000000000001",
        commitment: deposit.hash,
        label: deposit.label,
        value: deposit.value,
        blockNumber: 50n,
        transactionHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
      }),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const ragequit = events.find((e) => e.type === "ragequit");
    expect(ragequit?.value).toBe(250n);
  });

  test("ragequit uses the canonical event value instead of recomputing from local children", () => {
    const deposit = makeDeposit({ value: 250n });
    const migrationChild = makeDeposit({
      hash: 22n,
      value: 180n,
      blockNumber: 20n,
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      isMigration: true,
    });

    const account = makeAccount(POOL_USDC.scope, [
      makePoolAccount(deposit, [migrationChild], {
        ragequitter: "0x0000000000000000000000000000000000000001",
        commitment: migrationChild.hash,
        label: migrationChild.label,
        value: 250n,
        blockNumber: 50n,
        transactionHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
      }),
    ]);

    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);
    const ragequit = events.find((e) => e.type === "ragequit");

    expect(ragequit?.value).toBe(250n);
  });

  test("events include correct pool address and txHash", () => {
    const deposit = makeDeposit({
      txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });

    const account = makeAccount(POOL_USDC.scope, [makePoolAccount(deposit)]);
    const events = buildHistoryEventsFromAccount(account as any, [POOL_USDC] as any);

    expect(events[0].poolAddress).toBe(POOL_USDC.pool);
    expect(events[0].txHash).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  });
});
