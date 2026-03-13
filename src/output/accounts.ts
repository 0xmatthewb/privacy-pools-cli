/**
 * Output renderer for the `accounts` command.
 *
 * `src/commands/accounts.ts` delegates final output here.
 * Sync, pool discovery, ASP label fetching, and spinner remain in
 * the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  info,
  isSilent,
  printCsv,
  printJsonSuccess,
  printTable,
  renderNextSteps,
  warn,
} from "./common.js";
import {
  displayDecimals,
  formatAddress,
  formatAmount,
  formatTxHash,
  formatUsdValue,
} from "../utils/format.js";
import { accentBold } from "../utils/theme.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import { explorerTxUrl, isMultiChainScope } from "../config/chains.js";
import {
  renderAspApprovalStatus,
  renderPoolAccountStatus,
} from "../utils/statuses.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AccountPoolGroup {
  chain: string;
  chainId: number;
  symbol: string;
  poolAddress: string;
  decimals: number;
  scope: bigint;
  tokenPrice: number | null;
  poolAccounts: PoolAccountRef[];
}

export interface AccountWarning {
  chain: string;
  category: string;
  message: string;
}

export interface AccountsRenderData {
  chain: string;
  allChains?: boolean;
  chains?: string[];
  warnings?: AccountWarning[];
  groups: AccountPoolGroup[];
  showDetails: boolean;
  showSummary: boolean;
  showPendingOnly: boolean;
}

export interface AccountsEmptyRenderData {
  chain: string;
  allChains?: boolean;
  chains?: string[];
  warnings?: AccountWarning[];
  summary?: boolean;
  pendingOnly?: boolean;
}

interface JsonAccountRow {
  poolAccountNumber: number;
  poolAccountId: string;
  status: string;
  aspStatus: string;
  asset: string;
  scope: string;
  value: string;
  hash: string;
  label: string;
  blockNumber: string;
  txHash: string;
  explorerUrl: string | null;
  chain?: string;
  chainId?: number;
}

interface JsonBalanceRow {
  asset: string;
  balance: string;
  usdValue: string | null;
  poolAccounts: number;
  chain?: string;
  chainId?: number;
}

interface AccountsSummaryData {
  accounts: JsonAccountRow[];
  balances: JsonBalanceRow[];
  pendingCount: number;
  approvedCount: number;
  spendableCount: number;
  spentCount: number;
  exitedCount: number;
}

interface AccountsRootMeta {
  chain: string;
  allChains?: boolean;
  chains?: string[];
  warnings?: AccountWarning[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isMultiChain(data: Pick<AccountsRenderData | AccountsEmptyRenderData, "chains">): boolean {
  return Array.isArray(data.chains) && data.chains.length > 0;
}

function withRootMeta(
  payload: Record<string, unknown>,
  meta: AccountsRootMeta,
): Record<string, unknown> {
  return {
    ...payload,
    chain: meta.chain,
    ...(meta.allChains ? { allChains: true } : {}),
    ...(meta.chains ? { chains: meta.chains } : {}),
    ...(meta.warnings && meta.warnings.length > 0 ? { warnings: meta.warnings } : {}),
  };
}

function filterPendingGroups(groups: AccountPoolGroup[]): AccountPoolGroup[] {
  return groups.map((group) => ({
    ...group,
    poolAccounts: group.poolAccounts.filter((pa) => pa.aspStatus === "pending"),
  }));
}

function summarizeGroups(
  groups: AccountPoolGroup[],
  includeChainFields: boolean,
): AccountsSummaryData {
  const accounts: JsonAccountRow[] = [];
  const balances: JsonBalanceRow[] = [];
  let pendingCount = 0;
  let approvedCount = 0;
  let spendableCount = 0;
  let spentCount = 0;
  let exitedCount = 0;

  for (const group of groups) {
    let groupTotal = 0n;
    let groupSpendableCount = 0;

    for (const pa of group.poolAccounts) {
      if (pa.aspStatus === "pending") pendingCount++;
      if (pa.aspStatus === "approved") approvedCount++;

      if (pa.status === "spendable") {
        spendableCount++;
        groupTotal += pa.value;
        groupSpendableCount++;
      } else if (pa.status === "spent") {
        spentCount++;
      } else if (pa.status === "exited") {
        exitedCount++;
      }

      accounts.push({
        poolAccountNumber: pa.paNumber,
        poolAccountId: pa.paId,
        status: pa.status,
        aspStatus: pa.aspStatus,
        asset: group.symbol,
        scope: group.scope.toString(),
        value: pa.value.toString(),
        hash: pa.commitment.hash.toString(),
        label: pa.commitment.label.toString(),
        blockNumber: pa.blockNumber.toString(),
        txHash: pa.txHash,
        explorerUrl: explorerTxUrl(group.chainId, pa.txHash),
        ...(includeChainFields ? { chain: group.chain, chainId: group.chainId } : {}),
      });
    }

    if (groupSpendableCount > 0) {
      balances.push({
        asset: group.symbol,
        balance: groupTotal.toString(),
        usdValue:
          group.tokenPrice !== null
            ? formatUsdValue(groupTotal, group.decimals, group.tokenPrice)
            : null,
        poolAccounts: groupSpendableCount,
        ...(includeChainFields ? { chain: group.chain, chainId: group.chainId } : {}),
      });
    }
  }

  return {
    accounts,
    balances,
    pendingCount,
    approvedCount,
    spendableCount,
    spentCount,
    exitedCount,
  };
}

function buildPollNextActions(meta: AccountsRootMeta, pendingCount: number) {
  if (pendingCount <= 0) return undefined;

  return [
    createNextAction(
      "accounts",
      "Poll again until pending deposits are approved for private withdrawal.",
      "has_pending",
      {
        options: {
          agent: true,
          ...(meta.allChains ? { allChains: true } : {}),
          ...(isMultiChain(meta) ? {} : !isMultiChainScope(meta.chain)
            ? { chain: meta.chain }
            : {}),
          pendingOnly: true,
        },
      },
    ),
  ];
}

function renderWarnings(warnings: AccountWarning[] | undefined, silent: boolean): void {
  if (silent || !warnings || warnings.length === 0) return;
  for (const warning of warnings) {
    warn(`${warning.chain} (${warning.category}): ${warning.message}`, false);
  }
  process.stderr.write("\n");
}

function renderSummaryCsv(
  meta: AccountsRootMeta,
  summary: AccountsSummaryData,
  includeChainFields: boolean,
): void {
  const headers = includeChainFields
    ? ["Chain", "Asset", "Balance", "USD", "Pool Accounts", "Pending", "Approved", "Spendable", "Spent", "Exited"]
    : ["Asset", "Balance", "USD", "Pool Accounts", "Pending", "Approved", "Spendable", "Spent", "Exited"];
  const sourceRows =
    summary.balances.length > 0
      ? summary.balances
      : [{
          asset: "",
          balance: "",
          usdValue: null,
          poolAccounts: 0,
          ...(includeChainFields ? { chain: "" } : {}),
        }];
  const rows = sourceRows.map((balance) => {
    const baseRow = [
      balance.asset,
      balance.balance,
      balance.usdValue ?? "",
      String(balance.poolAccounts),
      String(summary.pendingCount),
      String(summary.approvedCount),
      String(summary.spendableCount),
      String(summary.spentCount),
      String(summary.exitedCount),
    ];
    return includeChainFields ? [balance.chain ?? "", ...baseRow] : baseRow;
  });
  printCsv(headers, rows);
}

function renderHumanBalanceSummary(
  groups: AccountPoolGroup[],
  silent: boolean,
  includeChainFields: boolean,
): void {
  if (silent) return;

  const anyUsd = groups.some(
    (group) =>
      group.tokenPrice !== null &&
      group.poolAccounts.some((pa) => pa.status === "spendable"),
  );
  const summaryRows: string[][] = [];

  for (const group of groups) {
    const spendablePAs = group.poolAccounts.filter((pa) => pa.status === "spendable");
    if (spendablePAs.length === 0) continue;

    const total = spendablePAs.reduce((sum, pa) => sum + pa.value, 0n);
    const dd = displayDecimals(group.decimals);
    const totalFmt = formatAmount(total, group.decimals, group.symbol, dd);
    const pendingCount = spendablePAs.filter((pa) => pa.aspStatus === "pending").length;
    const paLabel =
      `${spendablePAs.length} Pool Account${spendablePAs.length === 1 ? "" : "s"}` +
      (pendingCount > 0 ? ` (${pendingCount} pending)` : "");

    const label = includeChainFields
      ? `${group.symbol} Pool (${group.chain})`
      : `${group.symbol} Pool`;

    if (anyUsd) {
      const usdFmt =
        group.tokenPrice !== null
          ? formatUsdValue(total, group.decimals, group.tokenPrice)
          : "";
      summaryRows.push([label, totalFmt, usdFmt, paLabel]);
    } else {
      summaryRows.push([label, totalFmt, paLabel]);
    }
  }

  if (summaryRows.length === 0) return;

  const summaryHeaders = anyUsd
    ? ["Pool", "Balance", "USD", "Accounts"]
    : ["Pool", "Balance", "Accounts"];
  printTable(summaryHeaders, summaryRows);
  process.stderr.write("\n");
}

function groupByChain(groups: AccountPoolGroup[]): Array<{ chain: string; groups: AccountPoolGroup[] }> {
  const ordered = new Map<string, AccountPoolGroup[]>();
  for (const group of groups) {
    const existing = ordered.get(group.chain);
    if (existing) {
      existing.push(group);
    } else {
      ordered.set(group.chain, [group]);
    }
  }
  return Array.from(ordered.entries()).map(([chain, chainGroups]) => ({
    chain,
    groups: chainGroups,
  }));
}

function renderHumanGroupTable(
  ctx: OutputContext,
  group: AccountPoolGroup,
  silent: boolean,
  showDetails: boolean,
): void {
  if (!silent) process.stderr.write(`  ${group.symbol} Pool:\n`);
  if (silent) return;

  const dd = displayDecimals(group.decimals);
  const hasUsd = group.tokenPrice !== null;
  if (showDetails) {
    const detailHeaders = ctx.isVerbose
      ? hasUsd
        ? ["PA", "Status", "ASP", "Value", "USD", "Commitment", "Label", "Block", "Tx"]
        : ["PA", "Status", "ASP", "Value", "Commitment", "Label", "Block", "Tx"]
      : hasUsd
        ? ["PA", "Status", "ASP", "Value", "USD", "Tx"]
        : ["PA", "Status", "ASP", "Value", "Tx"];
    printTable(
      detailHeaders,
      group.poolAccounts.map((pa) => {
        const base = [
          pa.paId,
          renderPoolAccountStatus(pa.status),
          renderAspApprovalStatus(pa.aspStatus),
          formatAmount(pa.value, group.decimals, group.symbol, dd),
        ];
        if (hasUsd) {
          base.push(formatUsdValue(pa.value, group.decimals, group.tokenPrice!));
        }
        if (ctx.isVerbose) {
          base.push(
            formatAddress(`0x${pa.commitment.hash.toString(16).padStart(64, "0")}`, 8),
            formatAddress(`0x${pa.label.toString(16).padStart(64, "0")}`, 8),
            pa.blockNumber.toString(),
          );
        }
        base.push(formatTxHash(pa.txHash));
        return base;
      }),
    );
  } else {
    const summaryHeaders = hasUsd
      ? ["PA", "Balance", "USD", "Status"]
      : ["PA", "Balance", "Status"];
    printTable(
      summaryHeaders,
      group.poolAccounts.map((pa) => {
        const statusLabel = renderPoolAccountStatus(pa.status);
        const aspSuffix = pa.aspStatus === "unknown"
          ? ""
          : ` (${renderAspApprovalStatus(pa.aspStatus)})`;
        const row = [
          pa.paId,
          formatAmount(pa.value, group.decimals, group.symbol, dd),
        ];
        if (hasUsd) {
          row.push(formatUsdValue(pa.value, group.decimals, group.tokenPrice!));
        }
        row.push(`${statusLabel}${aspSuffix}`);
        return row;
      }),
    );
  }

  const spendablePAs = group.poolAccounts.filter((pa) => pa.status === "spendable");
  if (spendablePAs.length > 0) {
    const total = spendablePAs.reduce((sum, pa) => sum + pa.value, 0n);
    const totalFmt = formatAmount(total, group.decimals, group.symbol, dd);
    const usdFmt = hasUsd
      ? `  ${formatUsdValue(total, group.decimals, group.tokenPrice!)}`
      : "";
    process.stderr.write(
      chalk.dim(
        `    Total: ${totalFmt}${usdFmt}  (${spendablePAs.length} account${spendablePAs.length === 1 ? "" : "s"})\n`,
      ),
    );
  }
  process.stderr.write("\n");
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" / empty account state for accounts.
 */
export function renderAccountsNoPools(
  ctx: OutputContext,
  data: AccountsEmptyRenderData,
): void {
  const meta: AccountsRootMeta = {
    chain: data.chain,
    allChains: data.allChains,
    chains: data.chains,
    warnings: data.warnings,
  };
  const includeChainFields = isMultiChain(data);

  if (ctx.mode.isJson) {
    if (data.summary) {
      printJsonSuccess(
        withRootMeta(
          {
            pendingCount: 0,
            approvedCount: 0,
            spendableCount: 0,
            spentCount: 0,
            exitedCount: 0,
            balances: [],
          },
          meta,
        ),
      );
      return;
    }
    if (data.pendingOnly) {
      printJsonSuccess(withRootMeta({ accounts: [], pendingCount: 0 }, meta));
      return;
    }
    printJsonSuccess(withRootMeta({ accounts: [], balances: [], pendingCount: 0 }, meta));
    return;
  }

  if (ctx.mode.isCsv) {
    if (data.summary) {
      renderSummaryCsv(
        meta,
        {
          accounts: [],
          balances: [],
          pendingCount: 0,
          approvedCount: 0,
          spendableCount: 0,
          spentCount: 0,
          exitedCount: 0,
        },
        includeChainFields,
      );
      return;
    }
    const headers = includeChainFields
      ? ["Chain", "PA", "Status", "ASP", "Asset", "Value", "Tx"]
      : ["PA", "Status", "ASP", "Asset", "Value", "Tx"];
    printCsv(headers, []);
    return;
  }

  const silent = isSilent(ctx);
  renderWarnings(data.warnings, silent);

  if (data.pendingOnly) {
    info(
      includeChainFields
        ? `No pending Pool Accounts found across ${data.allChains ? "all chains" : "mainnet chains"}.`
        : `No pending Pool Accounts found on ${data.chain}.`,
      silent,
    );
    return;
  }

  info(
    includeChainFields
      ? `No Pool Accounts found across ${data.allChains ? "all chains" : "mainnet chains"}.`
      : `No Pool Accounts found on ${data.chain}.`,
    silent,
  );
}

/**
 * Render populated accounts listing.
 */
export function renderAccounts(ctx: OutputContext, data: AccountsRenderData): void {
  const {
    chain,
    allChains,
    chains,
    warnings,
    groups,
    showDetails,
    showSummary,
    showPendingOnly,
  } = data;

  const meta: AccountsRootMeta = { chain, allChains, chains, warnings };
  const includeChainFields = isMultiChain(data);
  const visibleGroups = showPendingOnly ? filterPendingGroups(groups) : groups;
  const summary = summarizeGroups(visibleGroups, includeChainFields);
  const nextActions = buildPollNextActions(meta, summary.pendingCount);

  if (ctx.mode.isCsv) {
    if (showSummary) {
      renderSummaryCsv(meta, summary, includeChainFields);
      return;
    }

    const csvHeaders = includeChainFields
      ? ["Chain", "PA", "Status", "ASP", "Asset", "Value", "Tx"]
      : ["PA", "Status", "ASP", "Asset", "Value", "Tx"];
    const csvRows: string[][] = [];
    for (const group of visibleGroups) {
      const dd = displayDecimals(group.decimals);
      for (const pa of group.poolAccounts) {
        const row = [
          pa.paId,
          pa.status,
          pa.aspStatus ?? "",
          group.symbol,
          formatAmount(pa.value, group.decimals, group.symbol, dd),
          pa.txHash,
        ];
        csvRows.push(includeChainFields ? [group.chain, ...row] : row);
      }
    }
    printCsv(csvHeaders, csvRows);
    return;
  }

  if (ctx.mode.isJson) {
    if (showSummary) {
      printJsonSuccess(
        appendNextActions(
          withRootMeta(
            {
              pendingCount: summary.pendingCount,
              approvedCount: summary.approvedCount,
              spendableCount: summary.spendableCount,
              spentCount: summary.spentCount,
              exitedCount: summary.exitedCount,
              balances: summary.balances,
            },
            meta,
          ),
          nextActions,
        ),
      );
      return;
    }

    if (showPendingOnly) {
      printJsonSuccess(
        appendNextActions(
          withRootMeta(
            {
              accounts: summary.accounts,
              pendingCount: summary.pendingCount,
            },
            meta,
          ),
          nextActions,
        ),
      );
      return;
    }

    printJsonSuccess(
      appendNextActions(
        withRootMeta(
          {
            accounts: summary.accounts,
            balances: summary.balances,
            pendingCount: summary.pendingCount,
          },
          meta,
        ),
        nextActions,
      ),
    );
    return;
  }

  const silent = isSilent(ctx);
  const hasPendingApprovals = summary.pendingCount > 0;
  const title = showSummary
    ? includeChainFields
      ? `My Pools summary across ${allChains ? "all chains" : "mainnet chains"}:`
      : `Pool Account summary on ${chain}:`
    : showPendingOnly
      ? includeChainFields
        ? `Pending Pool Accounts across ${allChains ? "all chains" : "mainnet chains"}:`
        : `Pending Pool Accounts on ${chain}:`
      : includeChainFields
        ? `My Pools across ${allChains ? "all chains" : "mainnet chains"}:`
        : `Pool Accounts on ${chain}:`;

  if (!silent) process.stderr.write(`\n${accentBold(title)}\n\n`);
  renderWarnings(warnings, silent);

  if (!silent && hasPendingApprovals) {
    info(
      "Pending ASP approval: recent deposits usually approve within ~1 hour, but some may take up to 7 days before private withdrawal.",
      silent,
    );
    process.stderr.write("\n");
  }

  if (showSummary) {
    printTable(
      ["Status", "Count"],
      [
        [renderAspApprovalStatus("pending"), String(summary.pendingCount)],
        [renderAspApprovalStatus("approved"), String(summary.approvedCount)],
        [renderPoolAccountStatus("spendable"), String(summary.spendableCount)],
        [renderPoolAccountStatus("spent"), String(summary.spentCount)],
        [renderPoolAccountStatus("exited"), String(summary.exitedCount)],
      ],
    );
    process.stderr.write("\n");

    renderHumanBalanceSummary(visibleGroups, silent, includeChainFields);

    if (summary.spendableCount === 0 && summary.pendingCount === 0) {
      info("No available Pool Accounts found.", silent);
      if (!silent) process.stderr.write("\n");
    }

    renderNextSteps(ctx, nextActions);
    return;
  }

  renderHumanBalanceSummary(visibleGroups, silent, includeChainFields);

  let renderedAny = false;
  const chainGroups = includeChainFields
    ? groupByChain(visibleGroups)
    : [{ chain, groups: visibleGroups }];

  for (const chainGroup of chainGroups) {
    const nonEmpty = chainGroup.groups.filter((group) => group.poolAccounts.length > 0);
    if (nonEmpty.length === 0) continue;
    renderedAny = true;

    if (includeChainFields && !silent) {
      process.stderr.write(`${accentBold(`${chainGroup.chain}:`)}\n\n`);
    }

    for (const group of nonEmpty) {
      renderHumanGroupTable(ctx, group, silent, showDetails);
    }
  }

  if (!renderedAny) {
    if (showPendingOnly) {
      info("No pending Pool Accounts found.", silent);
    } else {
      info(
        includeChainFields
          ? `No Pool Accounts found on ${allChains ? "any chain" : "mainnet chains"}.`
          : `No Pool Accounts found on ${chain}.`,
        silent,
      );
    }
    if (!silent) process.stderr.write("\n");
    renderNextSteps(ctx, nextActions);
    return;
  }

  if (!silent) {
    if (includeChainFields) {
      info(
        "PA IDs are chain-local. Re-run with --chain <name> before using PA-# with withdraw or ragequit.",
        silent,
      );
    } else {
      info("PA = Pool Account. Use -p PA-1 with withdraw or ragequit to target one.", silent);
    }
    if (showPendingOnly) {
      info("Pending-only mode hides approved accounts and withdraw suggestions.", silent);
    } else {
      if (!showDetails) {
        info("Use --details to show transaction hashes and ASP status breakdown.", silent);
      }
      if (showDetails && !ctx.isVerbose) {
        info(
          "Use --verbose with --details to show commitment, label, and block metadata for troubleshooting.",
          silent,
        );
      }
    }
  }

  renderNextSteps(ctx, nextActions);
}
