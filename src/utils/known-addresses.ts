export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const LOW_BURN_ADDRESS = "0x000000000000000000000000000000000000dead" as const;
export const HIGH_BURN_ADDRESS = "0xdead000000000000000000000000000000000000" as const;

export const BURN_RECIPIENT_ADDRESSES = [
  ZERO_ADDRESS,
  LOW_BURN_ADDRESS,
  HIGH_BURN_ADDRESS,
] as const;

const BURN_RECIPIENT_ADDRESS_SET = new Set<string>(BURN_RECIPIENT_ADDRESSES);

export function isBurnRecipientAddress(address: string): boolean {
  return BURN_RECIPIENT_ADDRESS_SET.has(address.toLowerCase());
}
