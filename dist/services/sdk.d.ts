import { PrivacyPoolSDK, DataService } from "@0xbow/privacy-pools-core-sdk";
import type { PublicClient, Address } from "viem";
import type { ChainConfig } from "../types.js";
export declare function getSDK(): Promise<PrivacyPoolSDK>;
export declare function getContracts(chainConfig: ChainConfig, rpcOverride?: string): Promise<import("@0xbow/privacy-pools-core-sdk").ContractInteractionsService>;
export declare function getPublicClient(chainConfig: ChainConfig, rpcOverride?: string): PublicClient;
export declare function getDataService(chainConfig: ChainConfig, poolAddress: Address, rpcOverride?: string): DataService;
export declare function warmCircuits(): Promise<void>;
