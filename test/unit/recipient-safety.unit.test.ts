import { describe, expect, test } from "bun:test";
import {
  assertSafeRecipientAddress,
  isKnownRecipient,
  newRecipientWarning,
  normalizeRecipientSet,
} from "../../src/utils/recipient-safety.ts";

describe("recipient safety", () => {
  test("rejects zero and common exact burn recipients", () => {
    const unsafe = [
      "0x0000000000000000000000000000000000000000",
      "0x000000000000000000000000000000000000dEaD",
      "0xdead000000000000000000000000000000000000",
    ];

    for (const address of unsafe) {
      expect(() => assertSafeRecipientAddress(address, "Recipient")).toThrow(
        /Recipient appears to be a burn address|Recipient cannot be the zero address/,
      );
    }
  });

  test("normalizes known recipients case-insensitively", () => {
    const known = normalizeRecipientSet([
      "0xAaaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      null,
      undefined,
    ]);

    expect(isKnownRecipient(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      known,
    )).toBe(true);
    expect(newRecipientWarning("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).toMatchObject({
      code: "recipient_new_to_profile",
      category: "recipient",
    });
  });
});
