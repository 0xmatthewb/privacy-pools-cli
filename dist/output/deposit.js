/**
 * Output renderer for the `deposit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, prompts, and balance checks remain in the
 * command handler.
 */
import { printJsonSuccess, success, info, isSilent } from "./common.js";
import { formatAmount, formatTxHash } from "../utils/format.js";
/**
 * Render deposit dry-run output.
 *
 * NOTE: In the current CLI, human-mode dry-run messages (success/info) are
 * suppressed because the command's `silent` flag includes `isDryRun`.
 * Only a bare newline is emitted.  This is preserved for byte-parity.
 */
export function renderDepositDryRun(ctx, data) {
    if (ctx.mode.isJson) {
        printJsonSuccess({
            dryRun: true,
            operation: "deposit",
            chain: data.chain,
            asset: data.asset,
            amount: data.amount.toString(),
            poolAccountNumber: data.poolAccountNumber,
            poolAccountId: data.poolAccountId,
            precommitment: data.precommitment.toString(),
            balanceSufficient: data.balanceSufficient,
        }, false);
        return;
    }
    // Human dry-run: messages are suppressed by the command's `silent` flag
    // (which includes isDryRun).  Only the leading newline is emitted.
    process.stderr.write("\n");
    const silent = true; // matches command-level: silent = isQuiet || isJson || isUnsigned || isDryRun
    success("Dry-run complete.", silent);
    info(`Chain: ${data.chain}`, silent);
    info(`Asset: ${data.asset}`, silent);
    info(`Pool Account: ${data.poolAccountId}`, silent);
    info(`Amount: ${formatAmount(data.amount, data.decimals, data.asset)}`, silent);
    const balanceLabel = data.balanceSufficient === "unknown"
        ? "unknown (no signer key)"
        : data.balanceSufficient
            ? "yes"
            : "no";
    info(`Balance sufficient: ${balanceLabel}`, silent);
    info("No transaction was submitted.", silent);
}
/**
 * Render deposit success output.
 */
export function renderDepositSuccess(ctx, data) {
    if (ctx.mode.isJson) {
        printJsonSuccess({
            operation: "deposit",
            txHash: data.txHash,
            amount: data.amount.toString(),
            committedValue: data.committedValue?.toString() ?? null,
            asset: data.asset,
            chain: data.chain,
            poolAccountNumber: data.poolAccountNumber,
            poolAccountId: data.poolAccountId,
            poolAddress: data.poolAddress,
            scope: data.scope.toString(),
            label: data.label?.toString() ?? null,
            blockNumber: data.blockNumber.toString(),
            explorerUrl: data.explorerUrl,
        }, false);
        return;
    }
    const silent = isSilent(ctx);
    process.stderr.write("\n");
    success(`Deposited ${formatAmount(data.amount, data.decimals, data.asset)}`, silent);
    info(`Pool Account: ${data.poolAccountId}`, silent);
    if (data.committedValue !== undefined) {
        info(`Net deposited: ${formatAmount(data.committedValue, data.decimals, data.asset)} (after vetting fee)`, silent);
    }
    info(`Tx: ${formatTxHash(data.txHash)}`, silent);
    if (data.explorerUrl) {
        info(`Explorer: ${data.explorerUrl}`, silent);
    }
    info("Your deposit is pending approval (most deposits are approved within 1 hour, some may take up to 7 days).", silent);
    info("Check status: privacy-pools accounts --chain " + data.chain, silent);
}
