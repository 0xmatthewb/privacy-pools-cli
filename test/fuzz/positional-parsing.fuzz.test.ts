import { describe, expect, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import { resolveAmountAndAssetInput } from "../../src/utils/positional.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

function randomNumericString(rng: ReturnType<typeof createSeededRng>): string {
  const intPart = String(1 + rng.nextInt(1_000_000));
  if (rng.nextInt(2) === 0) return intPart;
  const fracLen = 1 + rng.nextInt(6);
  let frac = "";
  for (let i = 0; i < fracLen; i++) frac += String(rng.nextInt(10));
  return `${intPart}.${frac}`;
}

function randomAssetLike(rng: ReturnType<typeof createSeededRng>): string {
  if (rng.nextInt(2) === 0) {
    const symbols = ["ETH", "USDC", "DAI", "TOKEN42"];
    return symbols[rng.nextInt(symbols.length)];
  }
  let hex = "0x";
  const alphabet = "0123456789abcdef";
  for (let i = 0; i < 40; i++) {
    hex += alphabet[rng.nextInt(alphabet.length)];
  }
  return hex;
}

describe("positional parser fuzz", () => {
  test("supports both <amount> <asset> and <asset> <amount> forms", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x11111111);
    const iterations = 500;

    for (let i = 0; i < iterations; i++) {
      const amount = randomNumericString(rng);
      const asset = randomAssetLike(rng);

      const amountFirst = resolveAmountAndAssetInput("deposit", amount, asset, undefined);
      expect(amountFirst.amount).toBe(amount);
      expect(amountFirst.asset).toBe(asset);

      const assetFirst = resolveAmountAndAssetInput("deposit", asset, amount, undefined);
      expect(assetFirst.amount).toBe(amount);
      expect(assetFirst.asset).toBe(asset);
    }
  });

  test("throws on ambiguous combinations", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0x22222222);
    const iterations = 250;

    for (let i = 0; i < iterations; i++) {
      const amountA = randomNumericString(rng);
      const amountB = randomNumericString(rng);
      const assetA = randomAssetLike(rng);
      const assetB = randomAssetLike(rng);

      expect(() =>
        resolveAmountAndAssetInput("withdraw", amountA, amountB, undefined)
      ).toThrow(CLIError);

      expect(() =>
        resolveAmountAndAssetInput("withdraw", assetA, assetB, undefined)
      ).toThrow(CLIError);

      expect(() =>
        resolveAmountAndAssetInput("withdraw", amountA, amountB, assetA)
      ).toThrow(CLIError);
    }
  });
});
