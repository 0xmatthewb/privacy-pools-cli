import type { Address, Hex } from "viem";
import type { ChainConfig, RelayerDetailsResponse, RelayerQuoteResponse, RelayerRequestResponse } from "../types.js";
export declare function getRelayerDetails(chainConfig: ChainConfig, assetAddress: Address): Promise<RelayerDetailsResponse>;
export declare function requestQuote(chainConfig: ChainConfig, params: {
    amount: bigint;
    asset: Address;
    extraGas: boolean;
    recipient?: Address;
}): Promise<RelayerQuoteResponse>;
export declare function submitRelayRequest(chainConfig: ChainConfig, params: {
    scope: bigint;
    withdrawal: {
        processooor: Address;
        data: Hex;
    };
    proof: any;
    publicSignals: string[];
    feeCommitment: RelayerQuoteResponse["feeCommitment"];
}): Promise<RelayerRequestResponse>;
