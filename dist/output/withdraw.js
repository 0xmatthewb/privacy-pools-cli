/**
 * Output renderer for the `withdraw` command.
 *
 * Phase 5 – handles dry-run, success, and quote output for both direct
 * and relayed withdrawal modes.
 * Unsigned output, spinners, proof generation, relayer interactions, and
 * prompts remain in the command handler.
 */
import { printJsonSuccess, success, info, isSilent } from "./common.js";
import { formatAmount, formatAddress, formatTxHash } from "../utils/format.js";
/**
 * Render withdraw dry-run output (both direct and relayed).
 *
 * NOTE: Human-mode messages are suppressed by the command's `silent` flag
 * (which includes isDryRun).  Only a bare newline is emitted.
 */
export function renderWithdrawDryRun(ctx, data) {
    if (ctx.mode.isJson) {
        const payload = {
            mode: data.withdrawMode,
            dryRun: true,
            amount: data.amount.toString(),
            asset: data.asset,
            chain: data.chain,
            recipient: data.recipient,
            poolAccountNumber: data.poolAccountNumber,
            poolAccountId: data.poolAccountId,
            selectedCommitmentLabel: data.selectedCommitmentLabel.toString(),
            selectedCommitmentValue: data.selectedCommitmentValue.toString(),
            proofPublicSignals: data.proofPublicSignals,
        };
        if (data.withdrawMode === "relayed") {
            payload.feeBPS = data.feeBPS;
            payload.quoteExpiresAt = data.quoteExpiresAt;
        }
        printJsonSuccess(payload, false);
        return;
    }
    // Human dry-run: messages suppressed by command's `silent` flag.
    process.stderr.write("\n");
    const silent = true; // matches command-level: silent = isQuiet || isJson || isUnsigned || isDryRun
    success("Dry-run complete.", silent);
    info(`Mode: ${data.withdrawMode}`, silent);
    info(`Recipient: ${formatAddress(data.recipient)}`, silent);
    info(`From Pool Account: ${data.poolAccountId}`, silent);
    if (data.withdrawMode === "relayed") {
        info(`Relay fee: ${data.feeBPS} BPS`, silent);
        info(`Quote expires: ${data.quoteExpiresAt}`, silent);
    }
    info(`Pool Account balance: ${formatAmount(data.selectedCommitmentValue, data.decimals, data.asset)}`, silent);
    info("No transaction was submitted.", silent);
}
/**
 * Render withdraw success output (both direct and relayed).
 */
export function renderWithdrawSuccess(ctx, data) {
    if (ctx.mode.isJson) {
        const payload = {
            operation: "withdraw",
            mode: data.withdrawMode,
            txHash: data.txHash,
            blockNumber: data.blockNumber.toString(),
            amount: data.amount.toString(),
            recipient: data.recipient,
            withdrawalMode: data.withdrawMode,
            explorerUrl: data.explorerUrl,
            poolAddress: data.poolAddress,
            scope: data.scope.toString(),
            asset: data.asset,
            chain: data.chain,
            poolAccountNumber: data.poolAccountNumber,
            poolAccountId: data.poolAccountId,
        };
        if (data.withdrawMode === "direct") {
            payload.fee = null;
        }
        else {
            payload.feeBPS = data.feeBPS;
        }
        printJsonSuccess(payload, false);
        return;
    }
    const silent = isSilent(ctx);
    process.stderr.write("\n");
    success(`Withdrew ${formatAmount(data.amount, data.decimals, data.asset)} from ${data.poolAccountId} to ${formatAddress(data.recipient)}`, silent);
    info(`Tx: ${formatTxHash(data.txHash)}`, silent);
    if (data.explorerUrl) {
        info(`Explorer: ${data.explorerUrl}`, silent);
    }
    if (data.withdrawMode === "relayed") {
        info(`Relay fee: ${data.feeBPS} BPS`, silent);
    }
}
/**
 * Render withdraw quote output.
 */
export function renderWithdrawQuote(ctx, data) {
    const minWithdrawFormatted = formatAmount(BigInt(data.minWithdrawAmount), data.decimals, data.asset);
    if (ctx.mode.isJson) {
        printJsonSuccess({
            mode: "relayed-quote",
            chain: data.chain,
            asset: data.asset,
            amount: data.amount.toString(),
            recipient: data.recipient ?? null,
            minWithdrawAmount: data.minWithdrawAmount,
            minWithdrawAmountFormatted: minWithdrawFormatted,
            maxRelayFeeBPS: data.maxRelayFeeBPS.toString(),
            quoteFeeBPS: data.quoteFeeBPS,
            feeCommitmentPresent: data.feeCommitmentPresent,
            quoteExpiresAt: data.quoteExpiresAt,
        }, false);
        return;
    }
    const silent = isSilent(ctx);
    process.stderr.write("\n");
    success("Relayer quote", silent);
    info(`Asset: ${data.asset}`, silent);
    info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset)}`, silent);
    info(`Min withdraw: ${minWithdrawFormatted}`, silent);
    info(`Quoted fee: ${data.quoteFeeBPS} BPS`, silent);
    info(`On-chain max fee: ${data.maxRelayFeeBPS.toString()} BPS`, silent);
    if (data.recipient) {
        info(`Recipient: ${formatAddress(data.recipient)}`, silent);
    }
    if (data.quoteExpiresAt) {
        info(`Quote expires: ${data.quoteExpiresAt}`, silent);
    }
}
