import { CLIError } from "./errors.js";
const AMOUNT_LIKE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
function isAmountLike(value) {
    return AMOUNT_LIKE.test(value.trim());
}
/**
 * Supports both:
 * - command <amount> --asset <asset>
 * - command <asset> <amount>
 * - command <amount> <asset>
 */
export function resolveAmountAndAssetInput(commandName, first, second, flaggedAsset) {
    if (flaggedAsset) {
        if (second !== undefined) {
            throw new CLIError(`Ambiguous positional arguments for ${commandName}.`, "INPUT", `Use either "${commandName} <amount> --asset <symbol|address>" or "${commandName} <asset> <amount>".`);
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
    throw new CLIError(`Could not infer amount/asset positional arguments for ${commandName}.`, "INPUT", `Use "${commandName} <amount> --asset <symbol|address>" or "${commandName} <asset> <amount>".`);
}
export function resolveOptionalAssetInput(commandName, positionalAsset, flaggedAsset) {
    if (positionalAsset && flaggedAsset) {
        throw new CLIError(`Ambiguous asset input for ${commandName}.`, "INPUT", `Use either positional asset ("${commandName} <asset>") or "--asset <symbol|address>", not both.`);
    }
    return flaggedAsset ?? positionalAsset;
}
