/**
 * Output renderer for the `deposit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, prompts, and balance checks remain in the
 * command handler.
 */
import type { OutputContext } from "./common.js";
export interface DepositDryRunData {
    chain: string;
    asset: string;
    amount: bigint;
    decimals: number;
    poolAccountNumber: number;
    poolAccountId: string;
    precommitment: bigint;
    balanceSufficient: boolean | "unknown";
}
export interface DepositSuccessData {
    txHash: string;
    amount: bigint;
    committedValue: bigint | undefined;
    asset: string;
    chain: string;
    decimals: number;
    poolAccountNumber: number;
    poolAccountId: string;
    poolAddress: string;
    scope: bigint;
    label: bigint | undefined;
    blockNumber: bigint;
    explorerUrl: string | null;
}
/**
 * Render deposit dry-run output.
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export declare function renderDepositDryRun(ctx: OutputContext, data: DepositDryRunData): void;
/**
 * Render deposit success output.
 */
export declare function renderDepositSuccess(ctx: OutputContext, data: DepositSuccessData): void;
