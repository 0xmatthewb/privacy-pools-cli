/**
 * Output renderer for the `accounts` command.
 *
 * `src/commands/accounts.ts` delegates final output here.
 * Sync, pool discovery, ASP label fetching, and spinner remain in
 * the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { printJsonSuccess, printTable, info, isSilent } from "./common.js";
import { formatAmount, formatAddress, formatTxHash } from "../utils/format.js";
import { highlight, accentBold } from "../utils/theme.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccountPoolGroup {
  symbol: string;
  poolAddress: string;
  decimals: number;
  scope: bigint;
  poolAccounts: PoolAccountRef[];
}

export interface AccountsRenderData {
  chain: string;
  groups: AccountPoolGroup[];
  showDetails: boolean;
  showAll: boolean;
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" for accounts.
 */
export function renderAccountsNoPools(ctx: OutputContext, chain: string): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({ chain, accounts: [] });
    return;
  }
  info(`No pools found on ${chain}.`, isSilent(ctx));
}

/**
 * Render populated accounts listing.
 */
export function renderAccounts(ctx: OutputContext, data: AccountsRenderData): void {
  const { chain, groups, showDetails, showAll } = data;

  if (ctx.mode.isJson) {
    const jsonData: Record<string, unknown>[] = [];
    let pendingCount = 0;
    for (const group of groups) {
      for (const pa of group.poolAccounts) {
        if (pa.aspStatus === "pending") pendingCount++;
        const c = pa.commitment;
        jsonData.push({
          poolAccountNumber: pa.paNumber,
          poolAccountId: pa.paId,
          status: pa.status,
          aspStatus: pa.aspStatus,
          asset: group.symbol,
          scope: group.scope.toString(),
          value: pa.value.toString(),
          hash: c.hash.toString(),
          label: c.label.toString(),
          blockNumber: pa.blockNumber.toString(),
          txHash: pa.txHash,
        });
      }
    }
    printJsonSuccess({ chain, accounts: jsonData, pendingCount });
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write(`\n${accentBold(`Pool Accounts (PA) on ${chain}:`)}\n\n`);
  let renderedAny = false;

  for (const group of groups) {
    if (group.poolAccounts.length === 0) continue;
    renderedAny = true;

    if (!silent) process.stderr.write(`  ${group.symbol} pool (${formatAddress(group.poolAddress)}):\n`);

    if (silent) continue;

    if (showDetails) {
      printTable(
        ["PA", "Status", "ASP", "Value", "Commitment", "Label", "Block", "Tx"],
        group.poolAccounts.map((pa) => [
          pa.paId,
          pa.status.charAt(0).toUpperCase() + pa.status.slice(1),
          pa.aspStatus === "approved"
            ? highlight("Approved")
            : pa.aspStatus === "pending"
              ? chalk.yellow("Pending")
              : "",
          formatAmount(pa.value, group.decimals, group.symbol),
          formatAddress(`0x${pa.commitment.hash.toString(16).padStart(64, "0")}`, 8),
          formatAddress(`0x${pa.label.toString(16).padStart(64, "0")}`, 8),
          pa.blockNumber.toString(),
          formatTxHash(pa.txHash),
        ]),
      );
    } else {
      printTable(
        ["PA", "Balance", "Status", "Tx"],
        group.poolAccounts.map((pa) => {
          const statusLabel = pa.status.charAt(0).toUpperCase() + pa.status.slice(1);
          const aspSuffix =
            pa.aspStatus === "approved"
              ? ` (${highlight("Approved")})`
              : pa.aspStatus === "pending"
                ? ` (${chalk.yellow("Pending")})`
                : "";
          return [
            pa.paId,
            formatAmount(pa.value, group.decimals, group.symbol),
            `${statusLabel}${aspSuffix}`,
            formatTxHash(pa.txHash),
          ];
        }),
      );
    }

    if (!silent) process.stderr.write("\n");
  }

  if (!renderedAny) {
    if (showAll) {
      info("No Pool Accounts found.", silent);
    } else {
      info(`No available Pool Accounts found. Deposit first, then run 'privacy-pools accounts --chain ${chain}'.`, silent);
    }
    if (!silent) process.stderr.write("\n");
  } else if (!silent) {
    info("Use -p PA-1 with withdraw or ragequit to target a specific Pool Account.", silent);
    if (!showAll) {
      info("Exited or spent accounts are hidden. Use --all to show them.", silent);
    }
    process.stderr.write("\n");
  }
}
