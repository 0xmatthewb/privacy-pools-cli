import { describe, expect, test } from "bun:test";
import { normalizeActivityEvent, toMsTimestamp } from "../../src/utils/public-activity.ts";

describe("public activity normalization", () => {
  test("extracts object-shaped review statuses the website already supports", () => {
    const event = normalizeActivityEvent({
      type: "deposit",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      timestamp: "1700000000",
      amount: "1000000000000000000",
      reviewStatus: {
        decisionStatus: "declined",
      },
      pool: {
        chainId: "11155111",
        tokenSymbol: "ETH",
        denomination: "18",
        poolAddress: "0x1111111111111111111111111111111111111111",
      },
    });

    expect(event.reviewStatus).toBe("declined");
    expect(event.timestampMs).toBe(1700000000000);
    expect(event.amountFormatted).toContain("ETH");
  });

  test("withdrawals keep null review status and let renderers normalize to approved", () => {
    const event = normalizeActivityEvent({
      type: "withdrawal",
      txHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      timestamp: 1700000000,
      publicAmount: "500000000000000000",
      reviewStatus: null,
      pool: {
        chainId: 11155111,
        tokenSymbol: "ETH",
        denomination: "18",
        poolAddress: "0x1111111111111111111111111111111111111111",
      },
    });

    expect(event.reviewStatus).toBeNull();
    expect(event.type).toBe("withdrawal");
  });
});

describe("toMsTimestamp", () => {
  test("normalizes seconds and milliseconds timestamps", () => {
    expect(toMsTimestamp(1700000000)).toBe(1700000000000);
    expect(toMsTimestamp("1700000000000")).toBe(1700000000000);
  });
});
