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
export declare function resolveAmountAndAssetInput(commandName: string, first: string, second: string | undefined, flaggedAsset: string | undefined): AmountAssetInput;
export declare function resolveOptionalAssetInput(commandName: string, positionalAsset: string | undefined, flaggedAsset: string | undefined): string | undefined;
