/**
 * Output renderer for the `pools` command.
 *
 * `src/commands/pools.ts` delegates final output here.
 * Pool fetching, search, sort, and spinner remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { guardCsvUnsupported, printJsonSuccess, printCsv, printTable, info, warn, isSilent, createNextAction, appendNextActions, renderNextSteps } from "./common.js";
import { POA_PORTAL_URL } from "../config/chains.js";
import { accentBold, muted } from "../utils/theme.js";
import { formatAddress, formatAmount, formatBPS, displayDecimals, parseUsd, formatUsdValue, rawUsdValue } from "../utils/format.js";
import type { PoolStats } from "../types.js";
import type { PoolAccountRef } from "../utils/pool-accounts.js";
import {
  isActivePoolAccountStatus,
  normalizePublicEventReviewStatus,
  renderAspApprovalStatus,
  renderPoolAccountStatus,
} from "../utils/statuses.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
  formatStackedKeyValueRows,
  getOutputWidthClass,
} from "./layout.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PoolWithChain {
  chain: string;
  chainId: number;
  pool: PoolStats;
  myPoolAccountsCount?: number;
}

export interface ChainSummary {
  chain: string;
  pools: number;
  error: string | null;
}

export interface PoolWarning {
  chain: string;
  category: string;
  message: string;
}

export interface PoolBaseFields {
  asset: string;
  tokenAddress: string;
  pool: string;
  scope: string;
  decimals: number;
  minimumDeposit: string;
  vettingFeeBPS: string;
  maxRelayFeeBPS: string;
  totalInPoolValue: string | null;
  totalInPoolValueUsd: string | null;
  totalDepositsValue: string | null;
  totalDepositsValueUsd: string | null;
  acceptedDepositsValue: string | null;
  acceptedDepositsValueUsd: string | null;
  pendingDepositsValue: string | null;
  pendingDepositsValueUsd: string | null;
  totalDepositsCount: number | null;
  acceptedDepositsCount: number | null;
  pendingDepositsCount: number | null;
  growth24h: number | null;
  pendingGrowth24h: number | null;
}

export interface PoolListItem extends PoolBaseFields {
  chain?: string;
  myPoolAccountsCount?: number;
}

export interface PoolDetail extends PoolBaseFields {
  chain: string;
  requestedChain?: string | null;
}

export interface PoolsRenderData {
  allChains: boolean;
  chainName: string;
  requestedChain?: string | null;
  multiChainLabel?: "all-mainnets" | "all-chains";
  search: string | null;
  sort: string;
  filteredPools: PoolWithChain[];
  chainSummaries?: ChainSummary[];
  warnings: PoolWarning[];
}

// ── Helpers (moved from command) ─────────────────────────────────────────────

function formatStatAmount(
  value: bigint | undefined,
  decimals: number,
  symbol: string,
): string {
  if (value === undefined) return "-";
  return formatAmount(value, decimals, symbol, displayDecimals(decimals));
}

function rawCsvAmount(value: bigint | undefined): string {
  return value?.toString() ?? "";
}

function rawCsvCount(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function rawUsdString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(/\$/g, "").replace(/,/g, "");
  if (normalized === "") return null;
  return /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : null;
}

function rawCsvUsd(value: string | null | undefined): string {
  return rawUsdString(value) ?? "";
}

function formatDepositsCount(pool: PoolStats): string {
  if (pool.totalDepositsCount !== undefined) {
    return pool.totalDepositsCount.toLocaleString("en-US");
  }
  return "-";
}

export function poolToJson(
  pool: PoolStats,
  chain?: string,
  myPoolAccountsCount?: number,
): PoolListItem {
  const payload: PoolListItem = {
    asset: pool.symbol,
    tokenAddress: pool.asset,
    pool: pool.pool,
    scope: pool.scope.toString(),
    decimals: pool.decimals,
    minimumDeposit: pool.minimumDepositAmount.toString(),
    vettingFeeBPS: pool.vettingFeeBPS.toString(),
    maxRelayFeeBPS: pool.maxRelayFeeBPS.toString(),
    totalInPoolValue: pool.totalInPoolValue?.toString() ?? null,
    totalInPoolValueUsd: rawUsdString(pool.totalInPoolValueUsd),
    totalDepositsValue: pool.totalDepositsValue?.toString() ?? null,
    totalDepositsValueUsd: rawUsdString(pool.totalDepositsValueUsd),
    acceptedDepositsValue: pool.acceptedDepositsValue?.toString() ?? null,
    acceptedDepositsValueUsd: rawUsdString(pool.acceptedDepositsValueUsd),
    pendingDepositsValue: pool.pendingDepositsValue?.toString() ?? null,
    pendingDepositsValueUsd: rawUsdString(pool.pendingDepositsValueUsd),
    totalDepositsCount: pool.totalDepositsCount ?? null,
    acceptedDepositsCount: pool.acceptedDepositsCount ?? null,
    pendingDepositsCount: pool.pendingDepositsCount ?? null,
    growth24h: pool.growth24h ?? null,
    pendingGrowth24h: pool.pendingGrowth24h ?? null,
  };
  if (chain) payload.chain = chain;
  if (myPoolAccountsCount !== undefined) {
    payload.myPoolAccountsCount = myPoolAccountsCount;
  }
  return payload;
}

// ── Renderers ────────────────────────────────────────────────────────────────

/**
 * Render "no pools found" (all raw pools empty, no errors to throw).
 */
export function renderPoolsEmpty(ctx: OutputContext, data: PoolsRenderData): void {
  if (ctx.mode.isJson) {
    const emptyNextActions = [
      createNextAction("status", "Check CLI and chain connectivity.", "no_pools_found", { options: { agent: true } }),
    ];
    if (data.allChains) {
      printJsonSuccess(
        appendNextActions(
          {
            chain: data.multiChainLabel ?? "all-mainnets",
            ...(data.requestedChain ? { requestedChain: data.requestedChain } : {}),
            search: data.search,
            sort: data.sort,
            chainSummaries: data.chainSummaries ?? [],
            pools: [],
          },
          emptyNextActions,
        ),
      );
    } else {
      printJsonSuccess(appendNextActions({
        chain: data.chainName,
        ...(data.requestedChain ? { requestedChain: data.requestedChain } : {}),
        search: data.search,
        sort: data.sort,
        pools: [],
      }, emptyNextActions));
    }
    return;
  }

  if (ctx.mode.isCsv) {
    printCsv(["Chain", "Asset", "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"], []);
    return;
  }

  if (ctx.mode.isName) {
    return;
  }

  const silent = isSilent(ctx);
  if (data.allChains) {
    info("No pools found on supported chains.", silent);
  } else {
    info(`No pools found on ${data.chainName}.`, silent);
  }
}

/**
 * Render populated pools listing.
 */
export function renderPools(ctx: OutputContext, data: PoolsRenderData): void {
  const { allChains, chainName, search, sort, filteredPools, chainSummaries, warnings } = data;
  const showMyPoolAccounts = filteredPools.some(
    (entry) => (entry.myPoolAccountsCount ?? 0) > 0,
  );
  const ownedPools = filteredPools.filter(
    (entry) => (entry.myPoolAccountsCount ?? 0) > 0,
  );

  const agentNextActions = [
    ...(ownedPools.length > 0
      ? [
          createNextAction(
            "accounts",
            "Review your Pool Accounts before choosing a withdrawal or public recovery path.",
            "after_pools",
            {
              options: {
                agent: true,
                ...(allChains ? { includeTestnets: true } : { chain: chainName }),
              },
            },
          ),
        ]
      : []),
    ...(ownedPools.length === 1
      ? [
          createNextAction(
            "pools",
            "Open the detailed view for the pool that already has your funds.",
            "after_pools",
            {
              args: [ownedPools[0]!.pool.symbol],
              options: {
                agent: true,
                ...(allChains ? { includeTestnets: true } : { chain: chainName }),
              },
            },
          ),
        ]
      : []),
    createNextAction("deposit", "Deposit into a pool.", "after_pools", {
      options: {
        agent: true,
        ...(allChains ? {} : { chain: chainName }),
      },
      runnable: false,
      parameters: [
        { name: "amount", type: "token_amount", required: true },
        { name: "asset", type: "asset_symbol", required: true },
      ],
    }),
  ];
  const humanNextActions = [
    ...(filteredPools.length === 1
      ? [
          createNextAction("pools", "Open the detailed view for this pool.", "after_pools", {
            args: [filteredPools[0]!.pool.symbol],
            options: {
              chain: allChains ? filteredPools[0]!.chain : chainName,
            },
          }),
        ]
      : []),
    createNextAction("activity", "Review recent public activity before depositing.", "after_pools", {
      options: allChains ? { includeTestnets: true } : { chain: chainName },
    }),
  ];

  if (ctx.mode.isJson) {
    if (allChains) {
      printJsonSuccess(appendNextActions({
        chain: data.multiChainLabel ?? "all-mainnets",
        ...(data.requestedChain ? { requestedChain: data.requestedChain } : {}),
        search,
        sort,
        chainSummaries: chainSummaries ?? [],
        pools: filteredPools.map((entry) =>
          poolToJson(entry.pool, entry.chain, entry.myPoolAccountsCount),
        ),
        warnings: warnings.length > 0 ? warnings : undefined,
      }, agentNextActions));
    } else {
      printJsonSuccess(appendNextActions({
        chain: chainName,
        ...(data.requestedChain ? { requestedChain: data.requestedChain } : {}),
        search,
        sort,
        pools: filteredPools.map((entry) =>
          poolToJson(entry.pool, undefined, entry.myPoolAccountsCount),
        ),
      }, agentNextActions));
    }
    return;
  }

  if (ctx.mode.isCsv) {
    const csvHeaders = allChains
      ? ["Chain", "Asset", ...(showMyPoolAccounts ? ["Your PAs"] : []), "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"]
      : ["Asset", ...(showMyPoolAccounts ? ["Your PAs"] : []), "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"];
    printCsv(
      csvHeaders,
      filteredPools.map(({ chain, pool, myPoolAccountsCount }) => {
        const baseRow = [
          pool.symbol,
          ...(showMyPoolAccounts ? [String(myPoolAccountsCount ?? 0)] : []),
          rawCsvCount(pool.totalDepositsCount),
          rawCsvAmount(pool.totalInPoolValue ?? pool.acceptedDepositsValue),
          rawCsvUsd(pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd),
          rawCsvAmount(pool.pendingDepositsValue),
          pool.minimumDepositAmount.toString(),
          pool.vettingFeeBPS.toString(),
        ];
        return allChains ? [chain, ...baseRow] : baseRow;
      }),
    );
    return;
  }

  if (ctx.mode.isName) {
    const lines = filteredPools.map(({ chain, pool }) =>
      allChains ? `${chain}/${pool.symbol}` : pool.symbol,
    );
    if (lines.length > 0) {
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;
  const out = ctx.mode.isWide ? process.stdout : process.stderr;

  if (allChains) {
    out.write(`\n${accentBold("Pools across supported chains:")}\n\n`);
  } else {
    out.write(`\n${accentBold(`Pools on ${chainName}:`)}\n\n`);
  }

  if (warnings.length > 0) {
    out.write(
      formatCallout(
        "warning",
        warnings.map((warning) => `${warning.chain} (${warning.category}): ${warning.message}`),
      ),
    );
  }

  if (filteredPools.length === 0) {
    if (search && search.length > 0) {
      info(`No pools matched search query "${search}".`, false);
    } else {
      info("No pools found.", false);
    }
    return;
  }

  out.write(formatSectionHeading("Summary", { divider: true }));
  out.write(
    formatKeyValueRows([
      { label: "Chain", value: allChains ? "all supported chains" : chainName },
      { label: "Matched pools", value: String(filteredPools.length) },
      { label: "Sort", value: sort },
      ...(search ? [{ label: "Search", value: search }] : []),
    ]),
  );

  const isWideFormat = ctx.mode.isWide;
  const baseHeaders = allChains
    ? ["Chain", "Asset", ...(showMyPoolAccounts ? ["Your PAs"] : []), "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"]
    : ["Asset", ...(showMyPoolAccounts ? ["Your PAs"] : []), "Total Deposits", "Pool Balance", "USD Value", "Pending", "Min Deposit", "Vetting Fee"];
  const headers = isWideFormat
    ? [...baseHeaders, "Pool Address", "Scope"]
    : baseHeaders;
  if (getOutputWidthClass() === "wide" || isWideFormat) {
    printTable(
      headers,
      filteredPools.map(({ chain, pool, myPoolAccountsCount }) => {
        const dd = displayDecimals(pool.decimals);
        const baseRow = [
          pool.symbol,
          ...(showMyPoolAccounts ? [String(myPoolAccountsCount ?? 0)] : []),
          formatDepositsCount(pool),
          formatStatAmount(
            pool.totalInPoolValue ?? pool.acceptedDepositsValue,
            pool.decimals,
            pool.symbol,
          ),
          parseUsd(pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd),
          formatStatAmount(
            pool.pendingDepositsValue,
            pool.decimals,
            pool.symbol,
          ),
          formatAmount(
            pool.minimumDepositAmount,
            pool.decimals,
            pool.symbol,
            dd,
          ),
          formatBPS(pool.vettingFeeBPS),
        ];
        const row = allChains ? [chain, ...baseRow] : baseRow;
        if (isWideFormat) {
          row.push(formatAddress(pool.pool, 8), `0x${pool.scope.toString(16)}`);
        }
        return row;
      }),
    );
  } else {
    for (const { chain, pool, myPoolAccountsCount } of filteredPools) {
      const dd = displayDecimals(pool.decimals);
      out.write(
        formatSectionHeading(
          allChains ? `${chain} · ${pool.symbol}` : pool.symbol,
          { divider: true },
        ),
      );
      out.write(
        formatStackedKeyValueRows([
          {
            label: "Pool Balance",
            value: formatStatAmount(
              pool.totalInPoolValue ?? pool.acceptedDepositsValue,
              pool.decimals,
              pool.symbol,
            ),
          },
          {
            label: "USD Value",
            value: parseUsd(pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd),
          },
          {
            label: "Pending",
            value: formatStatAmount(pool.pendingDepositsValue, pool.decimals, pool.symbol),
          },
          {
            label: "Min Deposit",
            value: formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol, dd),
          },
          {
            label: "Vetting Fee",
            value: formatBPS(pool.vettingFeeBPS),
          },
          {
            label: "Your PAs",
            value: showMyPoolAccounts ? String(myPoolAccountsCount ?? 0) : undefined,
          },
          {
            label: "Total Deposits",
            value: formatDepositsCount(pool),
          },
        ].filter((row): row is { label: string; value: string } => typeof row.value === "string")),
      );
    }
  }
  if (ctx.mode.verboseLevel >= 1) {
    out.write(
      muted(
        "\nVetting fees are deducted on deposit.\n" +
        "Pool Balance: current total value in the pool (accepted + pending deposits).\n" +
        "Pending: deposits still under ASP review.\n",
      ),
    );
  }
  renderNextSteps(ctx, humanNextActions);
}

// ── Detail View ─────────────────────────────────────────────────────────────

export interface PoolDetailActivityEvent {
  type: string;
  amount: string | null;
  amountRaw?: string | null;
  timeLabel: string;
  timestamp?: string | null;
  txHash?: string | null;
  status: string | null;
}

export interface PoolDetailRenderData {
  chain: string;
  requestedChain?: string | null;
  pool: PoolStats;
  tokenPrice: number | null;
  walletState: "available" | "setup_required" | "load_failed";
  myPoolAccounts: PoolAccountRef[] | null;
  myFundsWarning?: string | null;
  lastSyncTime?: number | null;
  recentActivity: PoolDetailActivityEvent[] | null;
  recentActivityUnavailable?: boolean;
}

function formatReviewSummary(poolAccounts: PoolAccountRef[]): string {
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

/**
 * Render pool detail view: `pools <asset>`.
 */
export function renderPoolDetail(ctx: OutputContext, data: PoolDetailRenderData): void {
  const {
    chain,
    requestedChain,
    pool,
    tokenPrice,
    walletState,
    myPoolAccounts,
    myFundsWarning,
    lastSyncTime,
    recentActivity,
    recentActivityUnavailable,
  } = data;
  const dd = displayDecimals(pool.decimals);
  const hasUsd = tokenPrice !== null;
  const widthClass = getOutputWidthClass();
  const humanNextActions = walletState === "available"
    ? [
        createNextAction(
          "accounts",
          `View your Pool Account balances on ${chain}.`,
          "after_pool_detail",
          { options: { chain } },
        ),
      ]
    : walletState === "setup_required"
    ? [
        createNextAction(
          "init",
          "Set up or restore your wallet before checking balances here.",
          "after_pool_detail",
          { options: { defaultChain: chain } },
        ),
      ]
    : undefined;

  const buildDetailAgentNextActions = () => {
    if (myPoolAccounts === null) {
      return [
        createNextAction("accounts", "View your Pool Account balances.", "after_pool_detail", { options: { agent: true, chain } }),
        createNextAction("deposit", `Deposit into the ${pool.symbol} pool.`, "after_pool_detail", {
          args: [pool.symbol],
          options: { agent: true, chain },
          runnable: false,
          parameters: [{ name: "amount", type: "token_amount", required: true }],
        }),
      ];
    }

    const active = myPoolAccounts.filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
    const approved = active.filter((pa) => pa.status === "approved");
    const requiredRecoveryCandidates = active.filter((pa) => pa.status === "declined");
    const optionalRecoveryCandidates = active.filter(
      (pa) =>
        pa.status === "approved" ||
        pa.status === "pending" ||
        pa.status === "poa_required" ||
        pa.status === "unknown",
    );
    const recoveryCandidates = [
      ...requiredRecoveryCandidates,
      ...optionalRecoveryCandidates,
    ];

    return [
      ...approved.map((pa) =>
        createNextAction(
          "withdraw",
          `Withdraw privately from ${pa.paId} once you provide the recipient address.`,
          "after_pool_detail",
          {
            args: [pool.symbol],
            options: {
              agent: true,
              chain,
              poolAccount: pa.paId,
              all: true,
            },
            runnable: false,
            parameters: [{ name: "to", type: "address", required: true }],
          },
        ),
      ),
      ...recoveryCandidates.map((pa) =>
        createNextAction(
          "ragequit",
          `Recover ${pa.paId} publicly to the original deposit address.`,
          "after_pool_detail",
          {
            args: [pool.symbol],
            options: { agent: true, chain, poolAccount: pa.paId },
          },
        ),
      ),
      createNextAction("accounts", "View your Pool Account balances.", "after_pool_detail", { options: { agent: true, chain } }),
      createNextAction("deposit", `Deposit into the ${pool.symbol} pool.`, "after_pool_detail", {
        args: [pool.symbol],
        options: { agent: true, chain },
        runnable: false,
        parameters: [{ name: "amount", type: "token_amount", required: true }],
      }),
    ];
  };

  guardCsvUnsupported(ctx, "pools <asset>");

  if (ctx.mode.isJson) {
    const payload: Record<string, unknown> = {
      chain,
      ...(requestedChain ? { requestedChain } : {}),
      ...poolToJson(pool),
    };

    if (myPoolAccounts !== null) {
      const active = myPoolAccounts.filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
      const myTotal = active.reduce((sum, pa) => sum + pa.value, 0n);
      payload.myFunds = {
        balance: myTotal.toString(),
        usdValue: hasUsd ? rawUsdValue(myTotal, pool.decimals, tokenPrice) : null,
        poolAccounts: active.length,
        pendingCount: active.filter((pa) => pa.status === "pending").length,
        poaRequiredCount: active.filter((pa) => pa.status === "poa_required").length,
        declinedCount: active.filter((pa) => pa.status === "declined").length,
        accounts: myPoolAccounts.map((pa) => ({
          id: pa.paId,
          status: pa.status,
          aspStatus: pa.aspStatus,
          value: pa.value.toString(),
        })),
      };
    } else {
      payload.myFunds = null;
    }

    if (myFundsWarning) {
      payload.myFundsWarning = myFundsWarning;
    }
    if (lastSyncTime !== undefined && lastSyncTime !== null) {
      payload.lastSyncTime = new Date(lastSyncTime).toISOString();
    }

    if (recentActivity !== null) {
      payload.recentActivity = recentActivity.map((event) => ({
        ...event,
        status: normalizePublicEventReviewStatus(event.type, event.status),
      }));
    }
    if (recentActivityUnavailable) {
      payload.recentActivityUnavailable = true;
    }

    const detailNextActions = buildDetailAgentNextActions();
    printJsonSuccess(appendNextActions(payload, detailNextActions), false);
    return;
  }

  const silent = isSilent(ctx);
  if (silent) return;

  process.stderr.write(`\n${accentBold(`${pool.symbol} Pool on ${chain}`)}\n`);
  const poolBalance = pool.totalInPoolValue ?? pool.acceptedDepositsValue;
  const poolBalanceUsd = pool.totalInPoolValueUsd ?? pool.acceptedDepositsValueUsd;
  const pendingFunds = pool.pendingDepositsValue;
  const pendingUsd = pool.pendingDepositsValueUsd;
  const allTimeDeposits = pool.totalDepositsValue;
  const allTimeUsd = pool.totalDepositsValueUsd;

  const fmtVal = (v: bigint | undefined): string =>
    v !== undefined ? formatAmount(v, pool.decimals, pool.symbol, dd) : "-";
  const fmtUsd = (v: string | null | undefined): string =>
    v ? ` (${parseUsd(v)})` : "";

  const summaryRows = [
    { label: "Pool Balance", value: `${fmtVal(poolBalance)}${fmtUsd(poolBalanceUsd)}` },
    { label: "Pending Funds", value: `${fmtVal(pendingFunds)}${fmtUsd(pendingUsd)}` },
    { label: "All-Time Deposits", value: `${fmtVal(allTimeDeposits)}${fmtUsd(allTimeUsd)}` },
    { label: "Total Deposits", value: formatDepositsCount(pool) },
    { label: "Vetting Fee", value: formatBPS(pool.vettingFeeBPS) },
    {
      label: "Min Deposit",
      value: formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol, dd),
    },
  ];
  process.stderr.write(formatSectionHeading("Pool summary", { divider: true }));
  process.stderr.write(
    widthClass === "wide"
      ? formatKeyValueRows(summaryRows)
      : formatStackedKeyValueRows(summaryRows),
  );

  process.stderr.write(
    formatCallout(
      "read-only",
      "Vetting fees are deducted on deposit. Pool balance includes accepted plus pending deposits.",
    ),
  );

  if (myPoolAccounts !== null) {
    const active = myPoolAccounts.filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
    const myTotal = active.reduce((sum, pa) => sum + pa.value, 0n);
    const usdFmt = hasUsd ? ` (${formatUsdValue(myTotal, pool.decimals, tokenPrice)})` : "";
    const myFundRows = [
      {
        label: "Available balance",
        value: `${formatAmount(myTotal, pool.decimals, pool.symbol, dd)}${usdFmt}`,
      },
      {
        label: "Active Pool Accounts",
        value: `${active.length}${formatReviewSummary(active)}`,
      },
    ];
    process.stderr.write(formatSectionHeading("Your funds", { divider: true }));
    process.stderr.write(
      widthClass === "wide"
        ? formatKeyValueRows(myFundRows)
        : formatStackedKeyValueRows(myFundRows),
    );

    if (active.length > 0) {
      if (widthClass === "wide") {
        printTable(
          ["Pool Account", "Balance", "Status"],
          active.map((pa) => [
            pa.paId,
            formatAmount(pa.value, pool.decimals, pool.symbol, dd),
            renderPoolAccountStatus(pa.status),
          ]),
        );
      } else {
        for (const pa of active) {
          process.stderr.write(
            formatSectionHeading(pa.paId, { divider: true }),
          );
          process.stderr.write(
            formatStackedKeyValueRows([
              {
                label: "Balance",
                value: formatAmount(pa.value, pool.decimals, pool.symbol, dd),
              },
              {
                label: "Status",
                value: renderPoolAccountStatus(pa.status),
              },
            ]),
          );
        }
      }
    }

    if (myFundsWarning) {
      process.stderr.write(formatCallout("warning", myFundsWarning));
    }

    if (active.some((pa) => pa.status === "declined")) {
      process.stderr.write(
        formatCallout(
          "recovery",
          "Declined Pool Accounts cannot use withdraw, including --direct. Use ragequit for public recovery to the deposit address.",
        ),
      );
    }

    if (active.some((pa) => pa.status === "poa_required")) {
      process.stderr.write(
        formatCallout(
          "recovery",
          `Proof of Association is still required before these balances can withdraw privately. Complete it at ${POA_PORTAL_URL}, or use ragequit if you prefer public recovery.`,
        ),
      );
    }
  } else {
    if (myFundsWarning) {
      process.stderr.write(formatSectionHeading("Your funds", { divider: true }));
      process.stderr.write(formatCallout("warning", myFundsWarning));
    } else {
      process.stderr.write(formatSectionHeading("Your funds", { divider: true }));
      process.stderr.write(
        formatCallout("read-only", "Run 'privacy-pools init' to see your balances here."),
      );
    }
  }

  process.stderr.write(formatSectionHeading("Recent activity", { divider: true }));
  if (recentActivityUnavailable) {
    process.stderr.write(
      formatCallout(
        "warning",
        "Recent public activity could not be loaded right now. Pool stats and your cached funds are still available.",
      ),
    );
  } else if (recentActivity !== null && recentActivity.length > 0) {
    const activityRows = recentActivity.map((event) => [
      event.type === "withdrawal" ? "Withdraw" : event.type === "ragequit" ? "Ragequit" : "Deposit",
      event.amount ?? "-",
      event.timeLabel,
      renderAspApprovalStatus(
        normalizePublicEventReviewStatus(event.type, event.status),
        { preserveInput: true },
      ),
    ]);
    if (widthClass === "wide") {
      printTable(["Type", "Amount", "Time", "Status"], activityRows);
    } else {
      for (const [type, amount, time, status] of activityRows) {
        process.stderr.write(
          formatStackedKeyValueRows([
            { label: "Type", value: type },
            { label: "Amount", value: amount },
            { label: "Time", value: time },
            { label: "Status", value: status },
          ]),
        );
        process.stderr.write("\n");
      }
    }
  } else {
    process.stderr.write(
      formatCallout("read-only", "No recent public activity was returned for this pool."),
    );
  }

  renderNextSteps(ctx, humanNextActions);
}
