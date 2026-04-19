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
  formatTimeAgo,
  formatTxHash,
  formatUsdValue,
} from "../utils/format.js";
import { accentBold } from "../utils/theme.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import { explorerTxUrl, isMultiChainScope, POA_PORTAL_URL } from "../config/chains.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "../utils/approval-timing.js";
import { formatCallout } from "./layout.js";
import {
  isActivePoolAccountStatus,
  renderAspApprovalStatus,
  renderPoolAccountStatus,
} from "../utils/statuses.js";
import type { NextActionOptionValue } from "../types.js";

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
  statusFilter?: string;
  /** Epoch ms of the oldest sync across queried chains. Null if unknown. */
  lastSyncTime?: number | null;
  syncSkipped?: boolean;
}

export interface AccountsEmptyRenderData {
  chain: string;
  allChains?: boolean;
  chains?: string[];
  warnings?: AccountWarning[];
  summary?: boolean;
  pendingOnly?: boolean;
  emptyReason:
    | "first_deposit"
    | "other_chain_activity"
    | "no_pending_left"
    | "restore_check_recommended"
    | "status_filtered_empty";
  otherChains?: string[];
  statusFilter?: string;
  lastSyncTime?: number | null;
  syncSkipped?: boolean;
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
  poaRequiredCount: number;
  declinedCount: number;
  unknownCount: number;
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
  let poaRequiredCount = 0;
  let declinedCount = 0;
  let unknownCount = 0;
  let spentCount = 0;
  let exitedCount = 0;

  for (const group of groups) {
    let groupTotal = 0n;
    let groupActiveCount = 0;

    for (const pa of group.poolAccounts) {
      if (pa.status === "pending") pendingCount++;
      if (pa.status === "approved") approvedCount++;
      if (pa.status === "poa_required") poaRequiredCount++;
      if (pa.status === "declined") declinedCount++;
      if (pa.status === "unknown") unknownCount++;

      if (pa.value > 0n && isActivePoolAccountStatus(pa.status)) {
        groupTotal += pa.value;
        groupActiveCount++;
      }
      if (pa.status === "spent") {
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

    if (groupActiveCount > 0) {
      balances.push({
        asset: group.symbol,
        balance: groupTotal.toString(),
        usdValue:
          group.tokenPrice !== null
            ? formatUsdValue(groupTotal, group.decimals, group.tokenPrice)
            : null,
        poolAccounts: groupActiveCount,
        ...(includeChainFields ? { chain: group.chain, chainId: group.chainId } : {}),
      });
    }
  }

  return {
    accounts,
    balances,
    pendingCount,
    approvedCount,
    poaRequiredCount,
    declinedCount,
    unknownCount,
    spentCount,
    exitedCount,
  };
}

function buildPollNextActions(meta: AccountsRootMeta, pendingCount: number) {
  if (pendingCount <= 0) return undefined;

  return [
    createNextAction(
      "accounts",
      "Poll again until pending deposits leave ASP review, then confirm whether they were approved, declined, or need Proof of Association.",
      "has_pending",
      {
        options: {
          agent: true,
          ...(meta.allChains ? { includeTestnets: true } : {}),
          ...(isMultiChain(meta) ? {} : !isMultiChainScope(meta.chain)
            ? { chain: meta.chain }
            : {}),
          pendingOnly: true,
        },
      },
    ),
  ];
}

function buildEmptyAccountsNextActions(
  meta: AccountsRootMeta,
  options: {
    summary?: boolean;
    pendingOnly?: boolean;
  },
) {
  const scopeOptions: Record<string, NextActionOptionValue> | undefined = meta.allChains
    ? { includeTestnets: true }
    : isMultiChain(meta)
      ? undefined
      : { chain: meta.chain };

  if (options.pendingOnly) {
    return [
      createNextAction(
        "accounts",
        "Re-run accounts without --pending-only to confirm approved, declined, or Proof of Association results.",
        "accounts_pending_empty",
        { options: scopeOptions },
      ),
    ];
  }

  return [
    createNextAction(
      "pools",
      "Browse pools to make your first deposit.",
      options.summary ? "accounts_summary_empty" : "accounts_empty",
      { options: scopeOptions },
    ),
  ];
}

function buildEmptyAccountsHumanNextActions(
  meta: AccountsRootMeta,
  data: AccountsEmptyRenderData,
) {
  if (data.pendingOnly) {
    return buildEmptyAccountsNextActions(meta, {
      summary: data.summary,
      pendingOnly: data.pendingOnly,
    });
  }

  if (data.emptyReason === "other_chain_activity") {
    const singleOtherChain = data.otherChains?.length === 1
      ? data.otherChains[0]
      : undefined;
    return [
      createNextAction(
        "accounts",
        singleOtherChain
          ? `Open the saved deposit state detected on ${singleOtherChain}.`
          : "Open the multi-chain dashboard to inspect the saved deposit state found on other chains.",
        "accounts_other_chain_activity",
        singleOtherChain
          ? { options: { chain: singleOtherChain } }
          : { options: { includeTestnets: true } },
      ),
    ];
  }

  if (data.emptyReason === "restore_check_recommended") {
    return [
      createNextAction(
        "init",
        "If this account came from the website, rerun init with the downloaded recovery phrase to refresh supported-chain discovery.",
        "accounts_restore_check",
        {
          options: {},
          runnable: false,
          parameters: [{ name: "recoveryPhraseFile", type: "file_path", required: true }],
        },
      ),
      ...buildEmptyAccountsNextActions(meta, {
        summary: data.summary,
        pendingOnly: data.pendingOnly,
      }),
    ];
  }

  return buildEmptyAccountsNextActions(meta, {
    summary: data.summary,
    pendingOnly: data.pendingOnly,
  });
}

function renderEmptyAccountsGuidance(data: AccountsEmptyRenderData): string {
  const scopeLabel = isMultiChain(data)
    ? data.allChains
      ? "all chains"
      : "mainnet chains"
    : data.chain;
  const statusLabel = data.statusFilter
    ? data.statusFilter.replaceAll("_", " ")
    : null;

  switch (data.emptyReason) {
    case "no_pending_left":
      return formatCallout(
        "success",
        [
          `No pending Pool Accounts are left on ${scopeLabel}.`,
          isMultiChain(data)
            ? `Re-run ${data.allChains ? "privacy-pools accounts --include-testnets" : "privacy-pools accounts"} without --pending-only to confirm approved, declined, or Proof of Association results.`
            : `Re-run privacy-pools accounts --chain ${data.chain} without --pending-only to review the final outcome.`,
        ],
      );
    case "other_chain_activity":
      return formatCallout(
        "read-only",
        [
          data.otherChains && data.otherChains.length === 1
            ? `No Pool Accounts are visible on ${data.chain}, but saved deposit state exists on ${data.otherChains[0]}.`
            : `No Pool Accounts are visible on ${data.chain}, but saved deposit state exists on other chains: ${(data.otherChains ?? []).join(", ")}.`,
          data.otherChains && data.otherChains.length === 1
            ? `Try privacy-pools accounts --chain ${data.otherChains[0]} to open that chain directly.`
            : "Try privacy-pools accounts --include-testnets to open the full dashboard.",
        ],
      );
    case "restore_check_recommended":
      return formatCallout(
        "recovery",
        [
          "No active Pool Accounts found, but this wallet has local deposit history.",
          "If you loaded this recovery phrase before automatic discovery was added, rerun privacy-pools init and choose 'Load an existing Privacy Pools account' to refresh supported-chain discovery.",
        ],
      );
    case "status_filtered_empty":
      return formatCallout(
        "read-only",
        [
          `No ${statusLabel ?? "matching"} Pool Accounts found on ${scopeLabel}.`,
          "Try re-running accounts without --status to review all current Pool Account states.",
        ],
      );
    default:
      return formatCallout(
        "read-only",
        [
          `No Pool Accounts found on ${scopeLabel}.`,
          "Browse pools to make your first deposit. privacy-pools flow start is the easiest path once you have chosen an amount and recipient.",
        ],
      );
  }
}

function renderWarnings(warnings: AccountWarning[] | undefined, silent: boolean): void {
  if (silent || !warnings || warnings.length === 0) return;
  for (const warning of warnings) {
    warn(`${warning.chain} (${warning.category}): ${warning.message}`, false);
  }
  process.stderr.write("\n");
}

function formatActiveReviewSummary(poolAccounts: PoolAccountRef[]): string {
  const pendingCount = poolAccounts.filter((pa) => pa.status === "pending").length;
  const poaRequiredCount = poolAccounts.filter((pa) => pa.status === "poa_required").length;
  const declinedCount = poolAccounts.filter((pa) => pa.status === "declined").length;
  const unknownCount = poolAccounts.filter((pa) => pa.status === "unknown").length;
  const parts: string[] = [];

  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (poaRequiredCount > 0) parts.push(`${poaRequiredCount} PoA needed`);
  if (declinedCount > 0) parts.push(`${declinedCount} declined`);
  if (unknownCount > 0) parts.push(`${unknownCount} unknown`);

  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function renderEffectiveHumanStatus(pa: PoolAccountRef): string {
  return renderPoolAccountStatus(pa.status);
}

function renderSummaryCsv(
  meta: AccountsRootMeta,
  summary: AccountsSummaryData,
  includeChainFields: boolean,
): void {
  const headers = includeChainFields
    ? ["Chain", "Asset", "Balance", "USD", "Pool Accounts", "Pending", "Approved", "POA Needed", "Declined", "Unknown", "Spent", "Exited"]
    : ["Asset", "Balance", "USD", "Pool Accounts", "Pending", "Approved", "POA Needed", "Declined", "Unknown", "Spent", "Exited"];
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
  // Global status counts are totals, not per-asset. Only include them on the
  // first row to prevent inflated sums when consumers aggregate the CSV.
  const rows = sourceRows.map((balance, index) => {
    const baseRow = [
      balance.asset,
      balance.balance,
      balance.usdValue ?? "",
      String(balance.poolAccounts),
      index === 0 ? String(summary.pendingCount) : "",
      index === 0 ? String(summary.approvedCount) : "",
      index === 0 ? String(summary.poaRequiredCount) : "",
      index === 0 ? String(summary.declinedCount) : "",
      index === 0 ? String(summary.unknownCount) : "",
      index === 0 ? String(summary.spentCount) : "",
      index === 0 ? String(summary.exitedCount) : "",
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
      group.poolAccounts.some((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status)),
  );
  const summaryRows: string[][] = [];

  for (const group of groups) {
    const activePAs = group.poolAccounts.filter(
      (pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status),
    );
    if (activePAs.length === 0) continue;

    const total = activePAs.reduce((sum, pa) => sum + pa.value, 0n);
    const dd = displayDecimals(group.decimals);
    const totalFmt = formatAmount(total, group.decimals, group.symbol, dd);
    const paLabel =
      `${activePAs.length} Pool Account${activePAs.length === 1 ? "" : "s"}` +
      formatActiveReviewSummary(activePAs);

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
    const isWide = ctx.mode.isWide;
    // Build headers programmatically instead of a nested conditional tree.
    const detailHeaders: string[] = ["PA", "State", "Review", "Value"];
    if (hasUsd) detailHeaders.push("USD");
    if (ctx.isVerbose) detailHeaders.push("Commitment", "Label", "Block");
    detailHeaders.push("Tx");
    if (isWide) detailHeaders.push("Pool");
    if (!ctx.isVerbose && isWide) detailHeaders.push("Block");
    printTable(
      detailHeaders,
      group.poolAccounts.map((pa) => {
        const base = [
          pa.paId,
          renderPoolAccountStatus(pa.status),
          pa.aspStatus === "unknown" ? "-" : renderAspApprovalStatus(pa.aspStatus),
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
        if (isWide) {
          base.push(formatAddress(group.poolAddress, 8));
          if (!ctx.isVerbose) {
            base.push(pa.blockNumber.toString());
          }
        }
        return base;
      }),
    );
  } else {
    const isWide = ctx.mode.isWide;
    const summaryHeaders = hasUsd
      ? isWide
        ? ["PA", "Balance", "USD", "Status", "Pool", "Tx", "Block"]
        : ["PA", "Balance", "USD", "Status"]
      : isWide
        ? ["PA", "Balance", "Status", "Pool", "Tx", "Block"]
        : ["PA", "Balance", "Status"];
    printTable(
      summaryHeaders,
      group.poolAccounts.map((pa) => {
        const statusLabel = renderEffectiveHumanStatus(pa);
        const row = [
          pa.paId,
          formatAmount(pa.value, group.decimals, group.symbol, dd),
        ];
        if (hasUsd) {
          row.push(formatUsdValue(pa.value, group.decimals, group.tokenPrice!));
        }
        row.push(statusLabel);
        if (isWide) {
          row.push(
            formatAddress(group.poolAddress, 8),
            formatTxHash(pa.txHash),
            pa.blockNumber.toString(),
          );
        }
        return row;
      }),
    );
  }

  const activePAs = group.poolAccounts.filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
  if (activePAs.length > 0) {
    const total = activePAs.reduce((sum, pa) => sum + pa.value, 0n);
    const totalFmt = formatAmount(total, group.decimals, group.symbol, dd);
    const usdFmt = hasUsd
      ? `  ${formatUsdValue(total, group.decimals, group.tokenPrice!)}`
      : "";
    process.stderr.write(
      chalk.dim(
        `    Total: ${totalFmt}${usdFmt}  (${activePAs.length} account${activePAs.length === 1 ? "" : "s"})\n`,
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
  const agentNextActions = buildEmptyAccountsNextActions(meta, {
    summary: data.summary,
    pendingOnly: data.pendingOnly,
  });
  const humanNextActions = buildEmptyAccountsHumanNextActions(meta, data);

  if (ctx.mode.isJson) {
    if (data.summary) {
      printJsonSuccess(
        appendNextActions(
          withRootMeta(
            {
              pendingCount: 0,
              approvedCount: 0,
              poaRequiredCount: 0,
              declinedCount: 0,
              unknownCount: 0,
              spentCount: 0,
              exitedCount: 0,
              balances: [],
              ...(data.lastSyncTime != null
                ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() }
                : {}),
              syncSkipped: data.syncSkipped ?? false,
            },
            meta,
          ),
          agentNextActions,
        ),
      );
      return;
    }
    if (data.pendingOnly) {
      printJsonSuccess(
        appendNextActions(
          withRootMeta(
            {
              accounts: [],
              pendingCount: 0,
              ...(data.lastSyncTime != null
                ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() }
                : {}),
              syncSkipped: data.syncSkipped ?? false,
            },
            meta,
          ),
          agentNextActions,
        ),
      );
      return;
    }
    printJsonSuccess(
      appendNextActions(
        withRootMeta(
          {
            accounts: [],
            balances: [],
            pendingCount: 0,
            ...(data.lastSyncTime != null
              ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() }
              : {}),
            syncSkipped: data.syncSkipped ?? false,
          },
          meta,
        ),
        agentNextActions,
      ),
    );
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
          poaRequiredCount: 0,
          declinedCount: 0,
          unknownCount: 0,
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
  if (!silent) {
    const title = data.pendingOnly
      ? includeChainFields
        ? `Pending Pool Accounts across ${data.allChains ? "all chains" : "mainnet chains"}:`
        : `Pending Pool Accounts on ${data.chain}:`
      : includeChainFields
        ? `Pool Accounts across ${data.allChains ? "all chains" : "mainnet chains"}:`
        : `Pool Accounts on ${data.chain}:`;
    process.stderr.write(`\n${accentBold(title)}\n`);
    if (data.syncSkipped && data.lastSyncTime != null) {
      process.stderr.write(chalk.dim(`  Cached ${formatTimeAgo(data.lastSyncTime)}\n`));
    } else if (data.lastSyncTime != null) {
      process.stderr.write(chalk.dim(`  Updated ${formatTimeAgo(data.lastSyncTime)}\n`));
    }
    process.stderr.write(renderEmptyAccountsGuidance(data));
  }
  renderNextSteps(ctx, humanNextActions);
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
    syncSkipped,
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

  if (ctx.mode.isName) {
    const lines = showSummary
      ? summary.balances.map((balance) =>
          includeChainFields && "chain" in balance && typeof balance.chain === "string"
            ? `${balance.chain}/${balance.asset}`
            : balance.asset,
        )
      : summary.accounts.map((account) =>
          includeChainFields && account.chain
            ? `${account.chain}/${account.poolAccountId}`
            : account.poolAccountId,
        );
    if (lines.length > 0) {
      process.stdout.write(`${lines.join("\n")}\n`);
    }
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
              poaRequiredCount: summary.poaRequiredCount,
              declinedCount: summary.declinedCount,
              unknownCount: summary.unknownCount,
              spentCount: summary.spentCount,
              exitedCount: summary.exitedCount,
              balances: summary.balances,
              ...(data.lastSyncTime != null
                ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() }
                : {}),
              syncSkipped: syncSkipped ?? false,
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
              ...(data.lastSyncTime != null
                ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() }
                : {}),
              syncSkipped: syncSkipped ?? false,
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
            ...(data.lastSyncTime != null ? { lastSyncTime: new Date(data.lastSyncTime).toISOString() } : {}),
            syncSkipped: syncSkipped ?? false,
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
  const hasPoaRequiredApprovals = summary.poaRequiredCount > 0;
  const hasDeclinedApprovals = summary.declinedCount > 0;
  const title = showSummary
    ? includeChainFields
      ? `Pool Account summary across ${allChains ? "all chains" : "mainnet chains"}:`
      : `Pool Account summary on ${chain}:`
    : showPendingOnly
      ? includeChainFields
        ? `Pending Pool Accounts across ${allChains ? "all chains" : "mainnet chains"}:`
        : `Pending Pool Accounts on ${chain}:`
      : data.statusFilter
        ? includeChainFields
          ? `${data.statusFilter.replaceAll("_", " ")} Pool Accounts across ${allChains ? "all chains" : "mainnet chains"}:`
          : `${data.statusFilter.replaceAll("_", " ")} Pool Accounts on ${chain}:`
      : includeChainFields
        ? `Pool Accounts across ${allChains ? "all chains" : "mainnet chains"}:`
        : `Pool Accounts on ${chain}:`;

  if (!silent) {
    process.stderr.write(`\n${accentBold(title)}\n`);
    if (syncSkipped && data.lastSyncTime != null) {
      process.stderr.write(chalk.dim(`  Cached ${formatTimeAgo(data.lastSyncTime)}\n`));
    } else if (data.lastSyncTime != null) {
      process.stderr.write(chalk.dim(`  Updated ${formatTimeAgo(data.lastSyncTime)}\n`));
    }
    process.stderr.write("\n");
  }
  renderWarnings(warnings, silent);

  if (!silent && hasPendingApprovals) {
    info(
      `Under review. ${DEPOSIT_APPROVAL_TIMELINE_COPY} You can always recover publicly with ragequit if you prefer not to wait.`,
      silent,
    );
    process.stderr.write("\n");
  }

  if (!silent && hasDeclinedApprovals) {
    info(
      "Declined Pool Accounts cannot use withdraw, including --direct. Use ragequit for public recovery to the original deposit address.",
      silent,
    );
    process.stderr.write("\n");
  }

  if (!silent && hasPoaRequiredApprovals) {
    info(
      `POA-needed Pool Accounts cannot use withdraw yet. Complete Proof of Association at ${POA_PORTAL_URL}, then re-check accounts. Ragequit remains available if you prefer public recovery to the original deposit address.`,
      silent,
    );
    process.stderr.write("\n");
  }

  if (showSummary) {
    printTable(
      ["Status", "Count"],
      [
        [renderPoolAccountStatus("approved"), String(summary.approvedCount)],
        [renderPoolAccountStatus("pending"), String(summary.pendingCount)],
        [renderPoolAccountStatus("poa_required"), String(summary.poaRequiredCount)],
        [renderPoolAccountStatus("declined"), String(summary.declinedCount)],
        [renderPoolAccountStatus("unknown"), String(summary.unknownCount)],
        [renderPoolAccountStatus("spent"), String(summary.spentCount)],
        [renderPoolAccountStatus("exited"), String(summary.exitedCount)],
      ],
    );
    process.stderr.write("\n");

    renderHumanBalanceSummary(visibleGroups, silent, includeChainFields);

    const activeCount =
      summary.approvedCount +
      summary.pendingCount +
      summary.poaRequiredCount +
      summary.declinedCount +
      summary.unknownCount;
    if (activeCount === 0) {
      info("No Pool Accounts with remaining balance found.", silent);
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
      info(
        "Re-run without --pending-only to confirm whether any recently reviewed Pool Accounts are now approved, declined, or POA Needed.",
        silent,
      );
    } else {
      info(
        includeChainFields
          ? `No Pool Accounts found on ${allChains ? "supported chains" : "mainnet chains"}.`
          : `No Pool Accounts found on ${chain}.`,
        silent,
      );
    }
    if (!silent) process.stderr.write("\n");
    renderNextSteps(ctx, nextActions);
    return;
  }

  if (!silent) {
    // Consolidated tip — only show contextual guidance when relevant.
    if (showPendingOnly) {
      info(
        "Pending-only mode: re-run without --pending-only to see final states (approved, declined, POA Needed).",
        silent,
      );
    }
    const tipParts: string[] = [];
    if (includeChainFields) tipParts.push("--chain <name> to scope PA-# IDs");
    if (!showDetails) tipParts.push("--details for tx hashes");
    if (showDetails && !ctx.isVerbose) tipParts.push("--verbose for troubleshooting metadata");
    if (tipParts.length > 0) {
      info(`Tip: Use ${tipParts.join(", ")}.`, silent);
    }
  }

  renderNextSteps(ctx, nextActions);
}
