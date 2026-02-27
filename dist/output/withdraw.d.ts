/**
 * Output renderer for the `withdraw` command.
 *
 * Handles dry-run, success, and quote output for both direct
 * and relayed withdrawal modes.
 * Unsigned output, spinners, proof generation, relayer interactions, and
 * prompts remain in the command handler.
 */
import type { OutputContext } from "./common.js";
export interface WithdrawDryRunData {
    withdrawMode: "direct" | "relayed";
    amount: bigint;
    asset: string;
    chain: string;
    decimals: number;
    recipient: string;
    poolAccountNumber: number;
    poolAccountId: string;
    selectedCommitmentLabel: bigint;
    selectedCommitmentValue: bigint;
    proofPublicSignals: number;
    /** Relayed-only: fee in basis points. */
    feeBPS?: string;
    /** Relayed-only: ISO timestamp of quote expiration. */
    quoteExpiresAt?: string;
}
/**
 * Render withdraw dry-run output (both direct and relayed).
 *
 * NOTE: Human-mode messages are suppressed by the command's `silent` flag
 * (which includes isDryRun).  Only a bare newline is emitted.
 */
export declare function renderWithdrawDryRun(ctx: OutputContext, data: WithdrawDryRunData): void;
export interface WithdrawSuccessData {
    withdrawMode: "direct" | "relayed";
    txHash: string;
    blockNumber: bigint;
    amount: bigint;
    recipient: string;
    asset: string;
    chain: string;
    decimals: number;
    poolAccountNumber: number;
    poolAccountId: string;
    poolAddress: string;
    scope: bigint;
    explorerUrl: string | null;
    /** Relayed-only: fee in basis points. */
    feeBPS?: string;
}
/**
 * Render withdraw success output (both direct and relayed).
 */
export declare function renderWithdrawSuccess(ctx: OutputContext, data: WithdrawSuccessData): void;
export interface WithdrawQuoteData {
    chain: string;
    asset: string;
    amount: bigint;
    decimals: number;
    recipient: string | null;
    minWithdrawAmount: string;
    maxRelayFeeBPS: bigint;
    quoteFeeBPS: string;
    feeCommitmentPresent: boolean;
    quoteExpiresAt: string | null;
}
/**
 * Render withdraw quote output.
 */
export declare function renderWithdrawQuote(ctx: OutputContext, data: WithdrawQuoteData): void;
