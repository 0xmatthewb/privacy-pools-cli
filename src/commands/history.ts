import type { Command } from "commander";
import type { Address } from "viem";
import type { PoolAccount, RagequitEvent } from "@0xbow/privacy-pools-core-sdk";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService, getReadOnlyRpcSession } from "../services/sdk.js";
import {
  assertAccountStateFreshForNoSync,
  getStoredLegacyPoolAccounts,
  initializeAccountServiceWithState,
  syncAccountEvents,
} from "../services/account.js";
import {
  listKnownPoolsFromRegistry,
  listPools,
} from "../services/pools.js";
import { explorerTxUrl } from "../config/chains.js";
import { spinner, verbose } from "../utils/format.js";
import { withSpinnerProgress } from "../utils/proof-progress.js";
import { CLIError, printError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderHistoryNoPools, renderHistory } from "../output/history.js";
import { maybeRenderPreviewScenario } from "../preview/runtime.js";
import { maybeRecoverMissingWalletSetup } from "../utils/setup-recovery.js";

export interface HistoryEvent {
  type: "deposit" | "migration" | "withdrawal" | "ragequit";
  asset: string;
  poolAddress: string;
  paNumber: number;
  paId: string;
  value: bigint;
  blockNumber: bigint;
  txHash: string;
}

interface AccountLike {
  poolAccounts?: ReadonlyMap<bigint, readonly PoolAccount[]>;
}

interface PoolLike {
  symbol: string;
  pool: string;
  scope: bigint;
}

type PoolLookup = ReadonlyMap<string, PoolLike>;

interface HistoryBuildResult {
  events: HistoryEvent[];
  handledLegacyLabels: Set<string>;
}

interface LegacyHistoryBuildResult extends HistoryBuildResult {
  declinedLegacyAccount: AccountLike | null;
}

function poolAccountLabelKey(scope: bigint, label: bigint): string {
  return `${scope.toString()}:${label.toString()}`;
}

function resolvePoolAccountLabel(
  poolAccount: PoolAccount,
): bigint | null {
  if (typeof poolAccount.deposit?.label === "bigint") {
    return poolAccount.deposit.label;
  }

  return typeof poolAccount.label === "bigint" ? poolAccount.label : null;
}

export { createHistoryCommand } from "../command-shells/history.js";

function buildPoolLookup(pools: readonly PoolLike[]): PoolLookup {
  return new Map(
    pools.map((pool) => [pool.scope.toString(), pool] as const),
  );
}

function buildHistoryEventsFromAccountWithLookup(
  account: AccountLike | null | undefined,
  poolLookup: PoolLookup,
  handledLegacyLabels: ReadonlySet<string> = new Set<string>(),
): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const poolAccountsMap = account?.poolAccounts;

  if (!(poolAccountsMap instanceof Map)) return events;

  for (const [scopeKey, poolAccountsList] of poolAccountsMap.entries()) {
    if (!Array.isArray(poolAccountsList)) continue;
    const scopeStr = scopeKey.toString();
    const pool = poolLookup.get(scopeStr);
    if (!pool) continue;

    let paNumber = 1;
    for (const pa of poolAccountsList as PoolAccount[]) {
      const paId = `PA-${paNumber}`;
      const label = resolvePoolAccountLabel(pa);
      const isHandledLegacyPoolAccount =
        label !== null && handledLegacyLabels.has(poolAccountLabelKey(scopeKey, label));

      if (pa.deposit && !isHandledLegacyPoolAccount) {
        events.push({
          type: "deposit",
          asset: pool.symbol,
          poolAddress: pool.pool,
          paNumber,
          paId,
          value: pa.deposit.value,
          blockNumber: pa.deposit.blockNumber,
          txHash: pa.deposit.txHash,
        });
      }

      if (pa.children && pa.children.length > 0 && pa.deposit) {
        let prevValue = pa.deposit.value;
        for (const child of pa.children) {
          if (isHandledLegacyPoolAccount && child.hash === pa.deposit.hash) {
            prevValue = child.value;
            continue;
          }
          const withdrawnAmount = prevValue - child.value;
          events.push({
            type: "withdrawal",
            asset: pool.symbol,
            poolAddress: pool.pool,
            paNumber,
            paId,
            value: withdrawnAmount < 0n ? child.value : withdrawnAmount,
            blockNumber: child.blockNumber,
            txHash: child.txHash,
          });
          prevValue = child.value;
        }
      }

      const ragequit = pa.ragequit as RagequitEvent | null | undefined;
      if (
        !isHandledLegacyPoolAccount &&
        ragequit &&
        typeof ragequit === "object" &&
        typeof ragequit.blockNumber === "bigint"
      ) {
        events.push({
          type: "ragequit",
          asset: pool.symbol,
          poolAddress: pool.pool,
          paNumber,
          paId,
          value: ragequit.value,
          blockNumber: ragequit.blockNumber,
          txHash: ragequit.transactionHash,
        });
      }

      paNumber++;
    }
  }

  return events;
}

export function buildHistoryEventsFromAccount(
  account: AccountLike | null | undefined,
  pools: readonly PoolLike[],
  handledLegacyLabels: ReadonlySet<string> = new Set<string>(),
): HistoryEvent[] {
  return buildHistoryEventsFromAccountWithLookup(
    account,
    buildPoolLookup(pools),
    handledLegacyLabels,
  );
}

function buildLegacyHistoryFromAccountWithLookup(
  legacyAccount: AccountLike | null | undefined,
  poolLookup: PoolLookup,
  declinedLegacyLabels: ReadonlySet<string>,
): LegacyHistoryBuildResult {
  const events: HistoryEvent[] = [];
  const handledLegacyLabels = new Set<string>();
  const declinedPoolAccountsByScope = new Map<bigint, PoolAccount[]>();
  const poolAccountsMap = legacyAccount?.poolAccounts;

  if (!(poolAccountsMap instanceof Map)) {
    return {
      events,
      handledLegacyLabels,
      declinedLegacyAccount: null,
    };
  }

  for (const [scopeKey, poolAccountsList] of poolAccountsMap.entries()) {
    if (!Array.isArray(poolAccountsList)) continue;
    const scopeStr = scopeKey.toString();
    const pool = poolLookup.get(scopeStr);
    if (!pool) continue;

    let paNumber = 1;
    for (const pa of poolAccountsList as PoolAccount[]) {
      if (!pa.deposit) {
        paNumber++;
        continue;
      }

      const label = resolvePoolAccountLabel(pa);
      if (label === null) {
        paNumber++;
        continue;
      }

      if (pa.isMigrated !== true && declinedLegacyLabels.has(label.toString())) {
        const declinedScopeAccounts = declinedPoolAccountsByScope.get(scopeKey) ?? [];
        declinedScopeAccounts.push(pa);
        declinedPoolAccountsByScope.set(scopeKey, declinedScopeAccounts);
      }

      const paId = `PA-${paNumber}`;
      const ragequit = pa.ragequit as RagequitEvent | null | undefined;

      if (pa.isMigrated === true) {
        handledLegacyLabels.add(poolAccountLabelKey(scopeKey, label));
        events.push({
          type: "deposit",
          asset: pool.symbol,
          poolAddress: pool.pool,
          paNumber,
          paId,
          value: pa.deposit.value,
          blockNumber: pa.deposit.blockNumber,
          txHash: pa.deposit.txHash,
        });

        let prevValue = pa.deposit.value;
        for (const child of pa.children ?? []) {
          if (child.isMigration === true) {
            events.push({
              type: "migration",
              asset: pool.symbol,
              poolAddress: pool.pool,
              paNumber,
              paId,
              value: child.value,
              blockNumber: child.blockNumber,
              txHash: child.txHash,
            });
          } else {
            const withdrawnAmount = prevValue - child.value;
            events.push({
              type: "withdrawal",
              asset: pool.symbol,
              poolAddress: pool.pool,
              paNumber,
              paId,
              value: withdrawnAmount < 0n ? child.value : withdrawnAmount,
              blockNumber: child.blockNumber,
              txHash: child.txHash,
            });
          }
          prevValue = child.value;
        }
      } else if (
        ragequit
        && typeof ragequit === "object"
        && typeof ragequit.blockNumber === "bigint"
      ) {
        handledLegacyLabels.add(poolAccountLabelKey(scopeKey, label));
        events.push({
          type: "deposit",
          asset: pool.symbol,
          poolAddress: pool.pool,
          paNumber,
          paId,
          value: pa.deposit.value,
          blockNumber: pa.deposit.blockNumber,
          txHash: pa.deposit.txHash,
        });
        events.push({
          type: "ragequit",
          asset: pool.symbol,
          poolAddress: pool.pool,
          paNumber,
          paId,
          value: ragequit.value,
          blockNumber: ragequit.blockNumber,
          txHash: ragequit.transactionHash,
        });
      }

      paNumber++;
    }
  }

  return {
    events,
    handledLegacyLabels,
    declinedLegacyAccount:
      declinedPoolAccountsByScope.size > 0
        ? { poolAccounts: declinedPoolAccountsByScope }
        : null,
  };
}

export function buildHistoryEventsFromAccounts(
  account: AccountLike | null | undefined,
  legacyAccount: AccountLike | null | undefined,
  pools: readonly PoolLike[],
  declinedLegacyLabels: ReadonlySet<string> = new Set<string>(),
): HistoryEvent[] {
  const poolLookup = buildPoolLookup(pools);
  const {
    events: legacyEvents,
    handledLegacyLabels,
    declinedLegacyAccount,
  } = buildLegacyHistoryFromAccountWithLookup(
    legacyAccount,
    poolLookup,
    declinedLegacyLabels,
  );

  return [
    ...legacyEvents,
    ...buildHistoryEventsFromAccountWithLookup(
      declinedLegacyAccount,
      poolLookup,
      handledLegacyLabels,
    ),
    ...buildHistoryEventsFromAccountWithLookup(account, poolLookup, handledLegacyLabels),
  ];
}

export async function handleHistoryCommand(
  opts: { sync?: boolean; limit?: string },
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);
  const silent = isSilent(ctx);
  const parsedLimit = Number(opts.limit ?? 50);
  if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
    printError(
      new CLIError(
        `Invalid --limit value: ${opts.limit}.`,
        "INPUT",
        "--limit must be a positive integer.",
      ),
      mode.isJson,
    );
    return;
  }
  const limit = parsedLimit;

  try {
    if (await maybeRenderPreviewScenario("history")) {
      return;
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    verbose(
      `Chain: ${chainConfig.name} (${chainConfig.id})`,
      isVerbose,
      silent,
    );

    const spin = spinner("Loading history...", silent);
    spin.start();

    if (opts.sync === false) {
      assertAccountStateFreshForNoSync(chainConfig.id);
    }

    const pools = opts.sync === false
      ? await listKnownPoolsFromRegistry(chainConfig, globalOpts?.rpcUrl)
      : await listPools(chainConfig, globalOpts?.rpcUrl);
    verbose(`Discovered ${pools.length} pool(s)`, isVerbose, silent);

    if (pools.length === 0) {
      spin.stop();
      renderHistoryNoPools(ctx, chainConfig.name);
      return;
    }

    const mnemonic = loadMnemonic();

    const poolInfos = pools.map((p) => ({
      chainId: chainConfig.id,
      address: p.pool as Address,
      scope: p.scope,
      deploymentBlock: p.deploymentBlock ?? chainConfig.startBlock,
    }));

    const dataService = await getDataService(
      chainConfig,
      pools[0].pool,
      globalOpts?.rpcUrl,
    );
    const {
      accountService,
      skipImmediateSync,
      legacyDeclinedLabels,
    } =
      await initializeAccountServiceWithState(
        dataService,
        mnemonic,
        poolInfos,
        chainConfig.id,
        {
          allowLegacyAccountRebuild: opts.sync !== false,
          allowLegacyRecoveryVisibility: true,
          suppressWarnings: silent,
          strictSync: true,
        },
      );

    await withSpinnerProgress(spin, "Syncing", () =>
      syncAccountEvents(accountService, poolInfos, pools, chainConfig.id, {
        skip: opts.sync === false || skipImmediateSync,
        force: false,
        silent,
        isJson: mode.isJson,
        isVerbose,
        errorLabel: "History",
        dataService,
        mnemonic,
        allowLegacyRecoveryVisibility: true,
      }),
    );

    // Extract chronological events from merged safe + legacy account state.
    const legacyPoolAccounts = getStoredLegacyPoolAccounts(accountService.account);
    const events = buildHistoryEventsFromAccounts(
      accountService.account,
      legacyPoolAccounts ? { poolAccounts: legacyPoolAccounts } : null,
      pools,
      legacyDeclinedLabels ?? new Set<string>(),
    );

    // Sort chronologically (newest first)
    events.sort((a, b) => {
      if (a.blockNumber > b.blockNumber) return -1;
      if (a.blockNumber < b.blockNumber) return 1;
      return 0;
    });

    const limited = events.slice(0, limit);

    // Fetch current block for approximate relative timestamps (non-fatal).
    let currentBlock: bigint | null = null;
    if (!mode.isJson) {
      try {
        const rpcSession = await getReadOnlyRpcSession(
          chainConfig,
          globalOpts?.rpcUrl,
        );
        currentBlock = await rpcSession.getLatestBlockNumber();
      } catch {
        /* non-fatal — fall back to block numbers */
      }
    }

    spin.stop();

    const poolByAddress = new Map(
      pools.map((p) => [p.pool, { pool: p.pool, decimals: p.decimals }]),
    );

    renderHistory(ctx, {
      chain: chainConfig.name,
      chainId: chainConfig.id,
      events: limited,
      poolByAddress,
      explorerTxUrl,
      currentBlock,
      avgBlockTimeSec: chainConfig.avgBlockTimeSec,
    });
  } catch (error) {
    if (await maybeRecoverMissingWalletSetup(error, cmd)) {
      return;
    }
    printError(error, mode.isJson);
  }
}
