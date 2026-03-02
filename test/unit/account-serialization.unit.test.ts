import { describe, expect, test } from "bun:test";
import { serialize, deserialize } from "../../src/services/account.ts";

describe("account serialization round-trip", () => {
  test("handles BigInt values", () => {
    const original = { balance: 1000000000000000000n, index: 0n };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.balance).toBe(1000000000000000000n);
    expect(result.index).toBe(0n);
  });

  test("handles negative-like BigInt (large values)", () => {
    const original = {
      large: 115792089237316195423570985008687907853269984665640564039457584007913129639935n,
    };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.large).toBe(
      115792089237316195423570985008687907853269984665640564039457584007913129639935n
    );
  });

  test("handles Map values", () => {
    const original = {
      data: new Map<string, number>([
        ["alice", 100],
        ["bob", 200],
      ]),
    };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.data).toBeInstanceOf(Map);
    expect(result.data.get("alice")).toBe(100);
    expect(result.data.get("bob")).toBe(200);
    expect(result.data.size).toBe(2);
  });

  test("handles empty Map", () => {
    const original = { items: new Map() };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.items).toBeInstanceOf(Map);
    expect(result.items.size).toBe(0);
  });

  test("handles nested BigInt inside Map values", () => {
    const original = {
      entries: new Map<string, { amount: bigint }>([
        ["tx1", { amount: 500n }],
        ["tx2", { amount: 999n }],
      ]),
    };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.entries).toBeInstanceOf(Map);
    expect(result.entries.get("tx1")!.amount).toBe(500n);
    expect(result.entries.get("tx2")!.amount).toBe(999n);
  });

  test("handles plain primitives without mangling", () => {
    const original = {
      name: "test",
      count: 42,
      active: true,
      nothing: null,
    };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.name).toBe("test");
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.nothing).toBeNull();
  });

  test("handles arrays with BigInt elements", () => {
    const original = { nullifiers: [123n, 456n, 789n] };
    const result = deserialize(serialize(original)) as typeof original;
    expect(result.nullifiers).toEqual([123n, 456n, 789n]);
  });

  test("round-trips complex account-like structure", () => {
    const account = {
      commitments: new Map([
        ["0xabc", { value: 1000000000000000000n, label: 42n }],
        ["0xdef", { value: 2000000000000000000n, label: 7n }],
      ]),
      index: 5n,
      nullifiers: [123n, 456n],
      metadata: {
        chainId: 1,
        lastSync: "2025-01-01T00:00:00Z",
      },
    };

    const result = deserialize(serialize(account)) as any;

    // Map survives the round-trip
    expect(result.commitments).toBeInstanceOf(Map);
    expect(result.commitments.size).toBe(2);
    expect(result.commitments.get("0xabc").value).toBe(
      1000000000000000000n
    );
    expect(result.commitments.get("0xabc").label).toBe(42n);
    expect(result.commitments.get("0xdef").value).toBe(
      2000000000000000000n
    );

    // BigInt fields survive
    expect(result.index).toBe(5n);
    expect(result.nullifiers).toEqual([123n, 456n]);

    // Plain objects survive
    expect(result.metadata.chainId).toBe(1);
    expect(result.metadata.lastSync).toBe("2025-01-01T00:00:00Z");
  });
});
