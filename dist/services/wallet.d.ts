import type { Address } from "viem";
export declare function generateMnemonic(): string;
export declare function validateMnemonic(mnemonic: string): boolean;
export declare function getMasterKeys(mnemonic: string): import("@0xbow/privacy-pools-core-sdk").MasterKeys;
export declare function getSignerAddress(privateKey: `0x${string}`): Address;
export declare function loadMnemonic(): string;
export declare function loadPrivateKey(): `0x${string}`;
