import type { Address } from "viem";
import { NATIVE_ASSET_ADDRESS } from "./chains.js";

interface PoolDeploymentHint {
  asset: Address;
  pool: Address;
  deploymentBlock: bigint;
}

const EVM_POOL_DEPLOYMENT_HINTS: Record<number, readonly PoolDeploymentHint[]> = {
  1: [
    { asset: NATIVE_ASSET_ADDRESS as Address, pool: "0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb", deploymentBlock: 22153707n },
    { asset: "0xdc035d45d973e3ec169d2276ddab16f1e407384f", pool: "0x05e4dbd71b56861eed2aaa12d00a797f04b5d3c0", deploymentBlock: 22917987n },
    { asset: "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd", pool: "0xbbda2173cdfea1c3bd7f2908798f1265301d750c", deploymentBlock: 22941225n },
    { asset: "0x6b175474e89094c44da98b954eedeac495271d0f", pool: "0x1c31c03b8cb2ee674d0f11de77135536db828257", deploymentBlock: 22946646n },
    { asset: "0xdac17f958d2ee523a2206206994597c13d831ec7", pool: "0xe859c0bd25f260baee534fb52e307d3b64d24572", deploymentBlock: 22988421n },
    { asset: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", pool: "0xb419c2867ab3cbc78921660cb95150d95a94ce86", deploymentBlock: 22988431n },
    { asset: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", pool: "0x1a604e9dfa0efdc7ffda378af16cb81243b61633", deploymentBlock: 23039970n },
    { asset: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", pool: "0xf973f4b180a568157cd7a0e6006449139e6bfc32", deploymentBlock: 23039980n },
    { asset: "0x4c9edd5852cd905f086c759e8383e09bff1e68b3", pool: "0xe6d36b33b00a7c0cb0c2a8d39d07e7db0c526abc", deploymentBlock: 23090290n },
    { asset: "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", pool: "0xc0a8bc0f4f982b4d4f1ffae8f4fccb58c9b29c98", deploymentBlock: 23090298n },
    { asset: "0xcacd6fd266af91b8aed52accc382b4e165586e29", pool: "0xc6c769fac7aabeadd31a03fae5ca0ec5b4c50f84", deploymentBlock: 23090335n },
    { asset: "0xdcee70654261af21c44c093c300ed3bb97b78192", pool: "0x7d2959bcfb936a84531518e8391ddba844e03ebe", deploymentBlock: 23239091n },
    { asset: "0x085780639cc2cacd35e474e71f4d000e2405d8f6", pool: "0xd14f4b36e1d1d98c218db782c49149876042bc56", deploymentBlock: 23988640n },
    { asset: "0x6440f144b7e50d6a8439336510312d2f54beb01d", pool: "0xb4b5fd38fd4788071d7287e3cb52948e0d10b23e", deploymentBlock: 24433029n },
  ],
  10: [
    { asset: NATIVE_ASSET_ADDRESS as Address, pool: "0x4626a182030d9e98b13f690fff3c443191a918ff", deploymentBlock: 144288142n },
    { asset: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", pool: "0xe4410f6827fa04ce096975d07a9924abb65316e3", deploymentBlock: 145160973n },
  ],
  42161: [
    { asset: NATIVE_ASSET_ADDRESS as Address, pool: "0x4626a182030d9e98b13f690fff3c443191a918ff", deploymentBlock: 404391809n },
    { asset: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", pool: "0x3706e38af05bf0158bcdbb46239f8289980b093f", deploymentBlock: 411197154n },
    { asset: "0x252b965400862d94bda35fecf7ee0f204a53cc36", pool: "0xa63e0bdc3a193d1e6e7c9be72cb502be4b7fc244", deploymentBlock: 411197625n },
  ],
  11155111: [
    { asset: NATIVE_ASSET_ADDRESS as Address, pool: "0x644d5a2554d36e27509254f32ccfebe8cd58861f", deploymentBlock: 8587019n },
    { asset: "0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0", pool: "0x6709277e170dee3e54101cdb73a450e392adff54", deploymentBlock: 8587019n },
    { asset: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", pool: "0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f", deploymentBlock: 8587019n },
  ],
  11155420: [
    { asset: NATIVE_ASSET_ADDRESS as Address, pool: "0x9fa2c482313b75e5bc2297cc0d666ddec19d641e", deploymentBlock: 32854678n },
    { asset: "0x4200000000000000000000000000000000000006", pool: "0x6d79e6062c193f6ac31ca06d98d86dc370eedda6", deploymentBlock: 32900681n },
  ],
};

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

const DEPLOYMENT_HINTS_BY_CHAIN = new Map<number, Map<string, bigint>>(
  Object.entries(EVM_POOL_DEPLOYMENT_HINTS).map(([chainId, hints]) => {
    const byAddress = new Map<string, bigint>();
    for (const hint of hints) {
      byAddress.set(normalizeAddress(hint.asset), hint.deploymentBlock);
      byAddress.set(normalizeAddress(hint.pool), hint.deploymentBlock);
    }
    return [Number(chainId), byAddress];
  }),
);

export function lookupPoolDeploymentBlock(
  chainId: number,
  ...addresses: Array<string | null | undefined>
): bigint | undefined {
  const hints = DEPLOYMENT_HINTS_BY_CHAIN.get(chainId);
  if (!hints) return undefined;

  for (const address of addresses) {
    if (!address) continue;
    const deploymentBlock = hints.get(normalizeAddress(address));
    if (deploymentBlock !== undefined) {
      return deploymentBlock;
    }
  }

  return undefined;
}

export function resolvePoolDeploymentBlock(
  chainId: number,
  fallbackStartBlock: bigint,
  ...addresses: Array<string | null | undefined>
): bigint {
  return lookupPoolDeploymentBlock(chainId, ...addresses) ?? fallbackStartBlock;
}
