/**
 * Output renderer for the `ragequit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, proof generation, and prompts remain in the
 * command handler.
 */
import type { OutputContext } from "./common.js";
export interface RagequitDryRunData {
    chain: string;
    asset: string;
    amount: bigint;
    decimals: number;
    poolAccountNumber: number;
    poolAccountId: string;
    selectedCommitmentLabel: bigint;
    selectedCommitmentValue: bigint;
    proofPublicSignals: number;
}
export interface RagequitSuccessData {
    txHash: string;
    amount: bigint;
    asset: string;
    chain: string;
    decimals: number;
    poolAccountNumber: number;
    poolAccountId: string;
    poolAddress: string;
    scope: bigint;
    blockNumber: bigint;
    explorerUrl: string | null;
}
/**
 * Render ragequit dry-run output.
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export declare function renderRagequitDryRun(ctx: OutputContext, data: RagequitDryRunData): void;
/**
 * Render ragequit success output.
 */
export declare function renderRagequitSuccess(ctx: OutputContext, data: RagequitSuccessData): void;
