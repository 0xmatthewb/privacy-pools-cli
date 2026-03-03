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
import { formatAmount, formatAddress, formatTxHash, displayDecimals, formatUsdValue } from "../utils/format.js";
import { highlight, accentBold } from "../utils/theme.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccountPoolGroup {
  symbol: string;
  poolAddress: string;
  decimals: number;
  scope: bigint;
  tokenPrice: number | null;
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
    const balances: Record<string, unknown>[] = [];
    let pendingCount = 0;
    for (const group of groups) {
      let groupTotal = 0n;
      let spendableCount = 0;
      for (const pa of group.poolAccounts) {
        if (pa.aspStatus === "pending") pendingCount++;
        if (pa.status === "spendable") {
          groupTotal += pa.value;
          spendableCount++;
        }
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
      if (spendableCount > 0) {
        balances.push({
          asset: group.symbol,
          balance: groupTotal.toString(),
          usdValue: group.tokenPrice !== null ? formatUsdValue(groupTotal, group.decimals, group.tokenPrice) : null,
          poolAccounts: spendableCount,
        });
      }
    }
    printJsonSuccess({ chain, accounts: jsonData, balances, pendingCount });
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

    const dd = displayDecimals(group.decimals);
    const hasUsd = group.tokenPrice !== null;
    if (showDetails) {
      const detailHeaders = hasUsd
        ? ["PA", "Status", "ASP", "Value", "USD", "Commitment", "Label", "Block", "Tx"]
        : ["PA", "Status", "ASP", "Value", "Commitment", "Label", "Block", "Tx"];
      printTable(
        detailHeaders,
        group.poolAccounts.map((pa) => {
          const base = [
            pa.paId,
            pa.status.charAt(0).toUpperCase() + pa.status.slice(1),
            pa.aspStatus === "approved"
              ? highlight("Approved")
              : pa.aspStatus === "pending"
                ? chalk.yellow("Pending")
                : "",
            formatAmount(pa.value, group.decimals, group.symbol, dd),
          ];
          if (hasUsd) base.push(formatUsdValue(pa.value, group.decimals, group.tokenPrice));
          base.push(
            formatAddress(`0x${pa.commitment.hash.toString(16).padStart(64, "0")}`, 8),
            formatAddress(`0x${pa.label.toString(16).padStart(64, "0")}`, 8),
            pa.blockNumber.toString(),
            formatTxHash(pa.txHash),
          );
          return base;
        }),
      );
    } else {
      const summaryHeaders = hasUsd
        ? ["PA", "Balance", "USD", "Status", "Tx"]
        : ["PA", "Balance", "Status", "Tx"];
      printTable(
        summaryHeaders,
        group.poolAccounts.map((pa) => {
          const statusLabel = pa.status.charAt(0).toUpperCase() + pa.status.slice(1);
          const aspSuffix =
            pa.aspStatus === "approved"
              ? ` (${highlight("Approved")})`
              : pa.aspStatus === "pending"
                ? ` (${chalk.yellow("Pending")})`
                : "";
          const row = [
            pa.paId,
            formatAmount(pa.value, group.decimals, group.symbol, dd),
          ];
          if (hasUsd) row.push(formatUsdValue(pa.value, group.decimals, group.tokenPrice));
          row.push(
            `${statusLabel}${aspSuffix}`,
            formatTxHash(pa.txHash),
          );
          return row;
        }),
      );
    }

    // Summary footer for this pool group
    if (!silent) {
      const spendablePAs = group.poolAccounts.filter((pa) => pa.status === "spendable");
      if (spendablePAs.length > 0) {
        const total = spendablePAs.reduce((sum, pa) => sum + pa.value, 0n);
        const totalFmt = formatAmount(total, group.decimals, group.symbol, dd);
        const usdFmt = hasUsd ? `  ${formatUsdValue(total, group.decimals, group.tokenPrice)}` : "";
        process.stderr.write(chalk.dim(`    Total: ${totalFmt}${usdFmt}  (${spendablePAs.length} account${spendablePAs.length === 1 ? "" : "s"})\n`));
      }
      process.stderr.write("\n");
    }
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
    info(
      "Note: only approved deposits are shown. Recent deposits may be pending ASP approval.",
      silent,
    );
    process.stderr.write("\n");
  }
}
