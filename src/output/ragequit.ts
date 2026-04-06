/**
 * Output renderer for the `ragequit` command.
 *
 * Handles dry-run and success output.
 * Unsigned output, spinners, proof generation, and prompts remain in the
 * command handler.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  renderNextSteps,
  printJsonSuccess,
  success,
  info,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import { formatAddress, formatAmount, formatTxHash, displayDecimals } from "../utils/format.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";

export interface RagequitDryRunData {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  destinationAddress: string | null;
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
  destinationAddress: string | null;
}

/**
 * Render ragequit dry-run output.
 *
 * Prints a human-readable summary of what would happen without submitting.
 */
export function renderRagequitDryRun(ctx: OutputContext, data: RagequitDryRunData): void {
  guardCsvUnsupported(ctx, "ragequit --dry-run");

  const agentNextActions = [
    createNextAction(
      "ragequit",
      "Submit the ragequit for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [data.asset],
        options: { agent: true, chain: data.chain, fromPa: data.poolAccountId },
      },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "ragequit",
      "Submit the ragequit for real when you are ready to broadcast it.",
      "after_dry_run",
      {
        args: [data.asset],
        options: { chain: data.chain, fromPa: data.poolAccountId },
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        dryRun: true,
        operation: "ragequit",
        chain: data.chain,
        asset: data.asset,
        amount: data.amount.toString(),
        destinationAddress: data.destinationAddress,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        selectedCommitmentLabel: data.selectedCommitmentLabel.toString(),
        selectedCommitmentValue: data.selectedCommitmentValue.toString(),
        proofPublicSignals: data.proofPublicSignals,
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Dry-run complete. No transaction was submitted.", silent);
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: data.chain },
        { label: "Asset", value: data.asset },
        { label: "Pool Account", value: data.poolAccountId },
        {
          label: "Amount",
          value: formatAmount(
            data.amount,
            data.decimals,
            data.asset,
            displayDecimals(data.decimals),
          ),
        },
        ...(data.destinationAddress
          ? [{
              label: "Destination",
              value: formatAddress(data.destinationAddress),
            }]
          : []),
      ]),
    );
    process.stderr.write(
      formatCallout(
        "recovery",
        "Ragequit is a public, non-private withdrawal that returns funds to your deposit address.",
      ),
    );
    process.stderr.write(
      formatCallout(
        "danger",
        "Once submitted onchain, this public recovery path cannot be turned back into a private withdrawal for the same Pool Account.",
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}

/**
 * Render ragequit success output.
 */
export function renderRagequitSuccess(ctx: OutputContext, data: RagequitSuccessData): void {
  guardCsvUnsupported(ctx, "ragequit");

  const agentNextActions = [
    createNextAction(
      "accounts",
      `Verify the account status for ${data.poolAccountId} after ragequit.`,
      "after_ragequit",
      { options: { agent: true, chain: data.chain } },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "accounts",
      `Verify the account status for ${data.poolAccountId}.`,
      "after_ragequit",
      { options: data.chain ? { chain: data.chain } : undefined },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions({
        operation: "ragequit",
        txHash: data.txHash,
        amount: data.amount.toString(),
        asset: data.asset,
        chain: data.chain,
        poolAccountNumber: data.poolAccountNumber,
        poolAccountId: data.poolAccountId,
        poolAddress: data.poolAddress,
        scope: data.scope.toString(),
        blockNumber: data.blockNumber.toString(),
        explorerUrl: data.explorerUrl,
        destinationAddress: data.destinationAddress,
      }, agentNextActions),
      false,
    );
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  const destinationLabel = data.destinationAddress
    ? formatAddress(data.destinationAddress)
    : "deposit address";
  success(
    `Ragequit ${data.poolAccountId}: withdrew ${formatAmount(data.amount, data.decimals, data.asset, displayDecimals(data.decimals))} back to ${destinationLabel}.`,
    silent,
  );
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Chain", value: data.chain },
        { label: "Pool Account", value: data.poolAccountId },
        {
          label: "Amount",
          value: formatAmount(
            data.amount,
            data.decimals,
            data.asset,
            displayDecimals(data.decimals),
          ),
        },
        { label: "Tx", value: formatTxHash(data.txHash) },
        ...(data.explorerUrl
          ? [{ label: "Explorer", value: data.explorerUrl }]
          : []),
        ...(data.destinationAddress
          ? [{
              label: "Destination",
              value: formatAddress(data.destinationAddress),
            }]
          : []),
      ]),
    );
    process.stderr.write(
      formatCallout(
        "recovery",
        "Privacy was not preserved. Ragequit uses the public recovery path back to the original deposit address.",
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
