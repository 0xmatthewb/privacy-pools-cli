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
 * - command <asset> <amount>
 * - command <amount> <asset>
 */
export function resolveAmountAndAssetInput(
  commandName: string,
  first: string,
  second: string | undefined
): AmountAssetInput {
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
    `Use "${commandName} <amount> <asset>" or "${commandName} <asset> <amount>".`,
    "INPUT_INVALID_ASSET",
  );
}

export function resolveOptionalAssetInput(
  commandName: string,
  positionalAsset: string | undefined
): string | undefined {
  if (!commandName.trim()) {
    throw new CLIError(
      "Missing command name for asset resolution.",
      "INPUT",
      "Use a non-empty command name when resolving positional assets.",
      "INPUT_INVALID_ASSET",
    );
  }
  return positionalAsset;
}
