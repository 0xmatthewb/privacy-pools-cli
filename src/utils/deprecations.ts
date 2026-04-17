import { warn } from "./format.js";

export function warnLegacyAssetFlag(commandUsage: string, silent: boolean): void {
  warn(`--asset is deprecated. Use: ${commandUsage}`, silent);
}

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

export function warnLegacyMnemonicFlag(
  flag: "--mnemonic" | "--mnemonic-file" | "--mnemonic-stdin" | "--show-mnemonic",
  replacement: string,
  silent: boolean,
): void {
  warn(`${flag} is deprecated. Use ${replacement} instead.`, silent);
}
