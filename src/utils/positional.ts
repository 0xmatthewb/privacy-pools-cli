import { CLIError } from "./errors.js";

const AMOUNT_LIKE = /^-?(?:\d+(?:\.\d+)?|\.\d+)%?$/;

function isAmountLike(value: string): boolean {
  return AMOUNT_LIKE.test(value.trim());
}

/** Returns true when value looks like a percentage (e.g. "50%", "100%"). */
export function isPercentageAmount(value: string): boolean {
  return /^\d+(?:\.\d+)?%$/.test(value.trim());
}

export interface AmountAssetInput {
  amount: string;
  asset?: string;
}

/**
 * Supports both:
 * - command <amount> --asset <asset>
 * - command <asset> <amount>
 * - command <amount> <asset>
 */
export function resolveAmountAndAssetInput(
  commandName: string,
  first: string,
  second: string | undefined,
  flaggedAsset: string | undefined
): AmountAssetInput {
  if (flaggedAsset) {
    if (second !== undefined) {
      throw new CLIError(
        `Ambiguous positional arguments for ${commandName}.`,
        "INPUT",
        `Use either "${commandName} <amount> --asset <symbol|address>" or "${commandName} <asset> <amount>".`
      );
    }
    return { amount: first, asset: flaggedAsset };
  }

  if (second === undefined) {
    return { amount: first };
  }

  const firstIsAmount = isAmountLike(first);
  const secondIsAmount = isAmountLike(second);

  if (firstIsAmount && !secondIsAmount) {
    return { amount: first, asset: second };
  }

  if (!firstIsAmount && secondIsAmount) {
    return { amount: second, asset: first };
  }

  throw new CLIError(
    `Could not infer amount/asset positional arguments for ${commandName}.`,
    "INPUT",
    `Use "${commandName} <amount> --asset <symbol|address>" or "${commandName} <asset> <amount>".`
  );
}

export function resolveOptionalAssetInput(
  commandName: string,
  positionalAsset: string | undefined,
  flaggedAsset: string | undefined
): string | undefined {
  if (positionalAsset && flaggedAsset) {
    throw new CLIError(
      `Ambiguous asset input for ${commandName}.`,
      "INPUT",
      `Use either positional asset ("${commandName} <asset>") or "--asset <symbol|address>", not both.`
    );
  }
  return flaggedAsset ?? positionalAsset;
}
