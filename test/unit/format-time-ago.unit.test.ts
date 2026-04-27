/**
 * Unit tests for formatTimeAgo() and formatApproxBlockTimeAgo().
 */

import { describe, expect, test, beforeEach, afterEach, setSystemTime } from "bun:test";
import { formatTimeAgo, formatApproxBlockTimeAgo } from "../../src/utils/format.ts";

// Pin Date.now() for deterministic tests.
const FIXED_NOW = new Date("2025-06-15T12:00:00.000Z").getTime();

describe("formatTimeAgo", () => {
  beforeEach(() => setSystemTime(new Date(FIXED_NOW)));
  afterEach(() => setSystemTime());

  test("returns dash for null", () => {
    expect(formatTimeAgo(null)).toBe("-");
  });

  test("seconds range", () => {
    expect(formatTimeAgo(FIXED_NOW - 30_000)).toBe("30s ago");
  });

  test("60 seconds crosses into minutes", () => {
    expect(formatTimeAgo(FIXED_NOW - 60_000)).toBe("1m ago");
  });

  test("60 minutes crosses into hours", () => {
    expect(formatTimeAgo(FIXED_NOW - 60 * 60_000)).toBe("1h ago");
  });

  test("24 hours crosses into days", () => {
    expect(formatTimeAgo(FIXED_NOW - 24 * 60 * 60_000)).toBe("1d ago");
  });

  test("future timestamp clamps to 0s ago", () => {
    expect(formatTimeAgo(FIXED_NOW + 60_000)).toBe("0s ago");
  });

  test("older than a year falls back to ISO date", () => {
    expect(formatTimeAgo(FIXED_NOW - 366 * 24 * 60 * 60_000)).toBe("2024-06-14");
  });
});

describe("formatApproxBlockTimeAgo", () => {
  beforeEach(() => setSystemTime(new Date(FIXED_NOW)));
  afterEach(() => setSystemTime());

  test("event block ahead returns 'just now'", () => {
    expect(formatApproxBlockTimeAgo(1000n, 1001n)).toBe("just now");
  });

  test("delegates to formatTimeAgo with block delta * avg time", () => {
    // 5 blocks * 12s = 60s = 1m
    expect(formatApproxBlockTimeAgo(1005n, 1000n)).toBe("1m ago");
  });

  test("custom avg block time", () => {
    // 10 blocks * 6s = 60s = 1m
    expect(formatApproxBlockTimeAgo(1010n, 1000n, 6)).toBe("1m ago");
  });
});
