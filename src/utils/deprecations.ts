import { warn } from "./format.js";

export function warnLegacyPoolAccountFlag(
  aliasValue: string,
  silent: boolean,
): void {
  warn(`--from-pa is deprecated. Use --pool-account ${aliasValue}`, silent);
}

export function warnLegacyFormatFlag(silent: boolean): void {
  warn("--format is deprecated. Use --output instead.", silent);
}

export function warnLegacyAllChainsFlag(silent: boolean): void {
  warn("--all-chains is deprecated. Use --include-testnets instead.", silent);
}
