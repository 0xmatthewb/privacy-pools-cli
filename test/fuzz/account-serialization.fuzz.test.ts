import { describe, expect, test } from "bun:test";
import { deserialize, serialize } from "../../src/services/account-storage.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

function randomBigInt(rng: ReturnType<typeof createSeededRng>): bigint {
  return (BigInt(rng.nextUInt32()) << 32n) | BigInt(rng.nextUInt32());
}

function randomScalar(rng: ReturnType<typeof createSeededRng>): unknown {
  switch (rng.nextInt(4)) {
    case 0:
      return randomBigInt(rng);
    case 1:
      return rng.nextInt(10_000);
    case 2:
      return `v-${rng.nextUInt32().toString(16)}`;
    default:
      return rng.nextInt(2) === 0;
  }
}

function randomValue(
  rng: ReturnType<typeof createSeededRng>,
  depth: number,
): unknown {
  if (depth <= 0) {
    return randomScalar(rng);
  }

  switch (rng.nextInt(4)) {
    case 0: {
      const size = 1 + rng.nextInt(3);
      const map = new Map<unknown, unknown>();
      for (let i = 0; i < size; i++) {
        map.set(`k-${depth}-${i}-${rng.nextInt(1000)}`, randomValue(rng, depth - 1));
      }
      return map;
    }
    case 1:
      return Array.from(
        { length: 1 + rng.nextInt(3) },
        () => randomValue(rng, depth - 1),
      );
    case 2: {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < 1 + rng.nextInt(3); i++) {
        obj[`field_${depth}_${i}`] = randomValue(rng, depth - 1);
      }
      return obj;
    }
    default:
      return randomScalar(rng);
  }
}

function expectRoundTripEqual(expected: unknown, actual: unknown): void {
  if (typeof expected === "bigint") {
    expect(actual).toBe(expected);
    return;
  }

  if (expected instanceof Map) {
    expect(actual).toBeInstanceOf(Map);
    const actualMap = actual as Map<unknown, unknown>;
    expect(actualMap.size).toBe(expected.size);
    for (const [key, value] of expected.entries()) {
      expect(actualMap.has(key)).toBe(true);
      expectRoundTripEqual(value, actualMap.get(key));
    }
    return;
  }

  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((value, index) => {
      expectRoundTripEqual(value, (actual as unknown[])[index]);
    });
    return;
  }

  if (expected && typeof expected === "object") {
    expect(actual && typeof actual === "object").toBe(true);
    const expectedEntries = Object.entries(expected as Record<string, unknown>);
    const actualRecord = actual as Record<string, unknown>;
    expect(Object.keys(actualRecord).sort()).toEqual(
      expectedEntries.map(([key]) => key).sort(),
    );
    for (const [key, value] of expectedEntries) {
      expectRoundTripEqual(value, actualRecord[key]);
    }
    return;
  }

  expect(actual).toEqual(expected);
}

describe("account serialization fuzz", () => {
  test("serialize/deserialize preserves nested BigInt and Map account shapes", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x6ac1f4d2);

    for (let i = 0; i < 250; i++) {
      const accountLike = {
        chainId: 11155111,
        nonce: randomBigInt(rng),
        poolAccounts: randomValue(rng, 3),
        commitments: randomValue(rng, 3),
        metadata: randomValue(rng, 2),
      };

      const roundTripped = deserialize(serialize(accountLike));
      expectRoundTripEqual(accountLike, roundTripped);
    }
  });
});
