import { Command } from "commander";
import type { PoolAccount } from "@0xbow/privacy-pools-core-sdk";
export interface HistoryEvent {
    type: "deposit" | "withdrawal" | "ragequit";
    asset: string;
    poolAddress: string;
    paNumber: number;
    paId: string;
    value: bigint;
    blockNumber: bigint;
    txHash: string;
}
interface AccountLike {
    poolAccounts?: Map<bigint, PoolAccount[]>;
}
interface PoolLike {
    symbol: string;
    pool: string;
    scope: bigint;
}
export declare function buildHistoryEventsFromAccount(account: AccountLike | null | undefined, pools: readonly PoolLike[]): HistoryEvent[];
export declare function createHistoryCommand(): Command;
export {};
