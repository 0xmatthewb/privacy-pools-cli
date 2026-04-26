import type { Command } from "commander";
import type { Address } from "viem";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService, getReadOnlyRpcSession } from "../services/sdk.js";
import {
  initializeAccountServiceWithState,
  loadSyncMeta,
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { listPools, resolvePool } from "../services/pools.js";
import { printError } from "../utils/errors.js";
import { JSON_SCHEMA_VERSION } from "../utils/json.js";
import { spinner, verbose } from "../utils/format.js";
import { withSpinnerProgress } from "../utils/proof-progress.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderSyncEmpty, renderSyncComplete } from "../output/sync.js";
import { maybeRenderPreviewScenario } from "../preview/runtime.js";
import { maybeRecoverMissingWalletSetup } from "../utils/setup-recovery.js";

export function summarizeSyncedEventCounts(account: unknown): {
  deposits: number;
  withdrawals: number;
  ragequits: number;
  migrations: number;
  total: number;
} {
  const counts = {
    deposits: 0,
    withdrawals: 0,
    ragequits: 0,
    migrations: 0,
    total: 0,
  };
  const poolAccounts = (account as { poolAccounts?: unknown })?.poolAccounts;
  if (!(poolAccounts instanceof Map)) {
    return counts;
  }

  for (const poolAccountList of poolAccounts.values()) {
    if (!Array.isArray(poolAccountList)) continue;
    for (const poolAccount of poolAccountList as Array<{
      deposit?: unknown;
      children?: unknown[];
      ragequit?: unknown;
      isMigrated?: boolean;
    }>) {
      if (poolAccount.deposit) counts.deposits += 1;
      if (Array.isArray(poolAccount.children)) {
        counts.withdrawals += poolAccount.children.length;
      }
      if (poolAccount.ragequit && typeof poolAccount.ragequit === "object") {
        counts.ragequits += 1;
      }
      if (poolAccount.isMigrated) {
        counts.migrations += 1;
      }
    }
  }

  counts.total =
    counts.deposits +
    counts.withdrawals +
    counts.ragequits +
    counts.migrations;
  return counts;
}

export { createSyncCommand } from "../command-shells/sync.js";

interface SyncCommandOptions {
  streamJson?: boolean;
}

export async function handleSyncCommand(
  positionalAsset: string | undefined,
  opts: SyncCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const streamJson = opts.streamJson === true;
  const mode = resolveGlobalMode({
    ...globalOpts,
    ...(streamJson ? { json: true } : {}),
  });
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);
  const silent = isSilent(ctx);

  const asset = positionalAsset;
  let heartbeat: NodeJS.Timeout | null = null;

  try {
    if (await maybeRenderPreviewScenario("sync")) {
      return;
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    const startedAt = Date.now();
    let currentStage = "resolving_pools";

    const emitSyncEvent = (event: Record<string, unknown>): void => {
      if (!streamJson) {
        return;
      }

      process.stdout.write(
        `${JSON.stringify({
          schemaVersion: JSON_SCHEMA_VERSION,
          success: true,
          mode: "sync-progress",
          chain: chainConfig.name,
          ...event,
        })}\n`,
      );
    };

    const spin = spinner("Resolving pools for sync...", silent);
    spin.start();
    emitSyncEvent({ event: "stage", stage: currentStage });
    if (streamJson) {
      heartbeat = setInterval(() => {
        emitSyncEvent({
          event: "heartbeat",
          stage: currentStage,
          elapsedMs: Date.now() - startedAt,
        });
      }, 5_000);
    }

    const pools = asset
      ? [await resolvePool(chainConfig, asset, globalOpts?.rpcUrl)]
      : await listPools(chainConfig, globalOpts?.rpcUrl);

    if (pools.length === 0) {
      spin.stop();
      renderSyncEmpty(ctx, chainConfig.name);
      return;
    }

    const mnemonic = loadMnemonic();

    verbose(
      `Syncing ${pools.length} pool(s): ${pools.map((p) => p.symbol).join(", ")}`,
      isVerbose,
      silent,
    );
    if (!silent) {
      spin.text = `Resolved ${pools.length} pool(s). Loading account state...`;
    }
    currentStage = "loading_account_state";
    emitSyncEvent({
      event: "stage",
      stage: currentStage,
      syncedPools: pools.length,
      syncedSymbols: pools.map((p) => p.symbol),
    });

    const poolInfos = pools.map((p) => ({
      chainId: chainConfig.id,
      address: p.pool as Address,
      scope: p.scope,
      deploymentBlock: p.deploymentBlock ?? chainConfig.startBlock,
    }));
    const scannedFromBlock =
      poolInfos.length > 0
        ? poolInfos.reduce(
            (min, poolInfo) =>
              poolInfo.deploymentBlock < min ? poolInfo.deploymentBlock : min,
            poolInfos[0]!.deploymentBlock,
          )
        : chainConfig.startBlock;
    let scannedToBlock: bigint | null = null;
    try {
      const rpcSession = await getReadOnlyRpcSession(
        chainConfig,
        globalOpts?.rpcUrl,
      );
      scannedToBlock = await rpcSession.getLatestBlockNumber();
    } catch {
      scannedToBlock = null;
    }

    const dataService = await getDataService(
      chainConfig,
      pools[0].pool,
      globalOpts?.rpcUrl,
    );
    // Get pre-sync spendable count so we can report the delta
    const { accountService: preSyncService, skipImmediateSync } =
      await initializeAccountServiceWithState(
        dataService,
        mnemonic,
        poolInfos,
        chainConfig.id,
        {
          allowLegacyAccountRebuild: true,
          suppressWarnings: silent,
          strictSync: true,
        },
      );
    const preSyncSpendable = withSuppressedSdkStdoutSync(() =>
      preSyncService.getSpendableCommitments(),
    );
    const previousSpendableCount = Array.from(preSyncSpendable.values()).reduce(
      (acc, list) => acc + list.length,
      0,
    );
    currentStage = "syncing_events";
    if (!silent) {
      spin.text =
        scannedToBlock === null
          ? `Syncing events from block ${scannedFromBlock.toString()}...`
          : `Syncing events from block ${scannedFromBlock.toString()} to ${scannedToBlock.toString()}...`;
    }
    emitSyncEvent({
      event: "stage",
      stage: currentStage,
      previousAvailablePoolAccounts: previousSpendableCount,
      scannedFromBlock: scannedFromBlock.toString(),
      scannedToBlock: scannedToBlock === null ? null : scannedToBlock.toString(),
    });

    await withSpinnerProgress(
      spin,
      scannedToBlock === null
        ? `Syncing deposit/withdrawal/ragequit events from block ${scannedFromBlock.toString()}`
        : `Syncing deposit/withdrawal/ragequit events from block ${scannedFromBlock.toString()} to ${scannedToBlock.toString()}`,
      () =>
        syncAccountEvents(preSyncService, poolInfos, pools, chainConfig.id, {
          skip: skipImmediateSync,
          force: true,
          silent,
          isJson: mode.isJson,
          isVerbose,
          errorLabel: "Sync",
          dataService,
          mnemonic,
        }),
    );

    const spendable = withSuppressedSdkStdoutSync(() =>
      preSyncService.getSpendableCommitments(),
    );
    const spendableCount = Array.from(spendable.values()).reduce(
      (acc, list) => acc + list.length,
      0,
    );
    const syncMeta = loadSyncMeta(chainConfig.id);
    const eventCounts = summarizeSyncedEventCounts(preSyncService.account);
    currentStage = "finalizing";
    emitSyncEvent({
      event: "stage",
      stage: currentStage,
      availablePoolAccounts: spendableCount,
      elapsedMs: Date.now() - startedAt,
    });

    spin.succeed("Sync complete.");

    renderSyncComplete(ctx, {
      chain: chainConfig.name,
      syncedPools: pools.length,
      syncedSymbols: pools.map((p) => p.symbol),
      availablePoolAccounts: spendableCount,
      previousAvailablePoolAccounts: previousSpendableCount,
      chainOverridden: !!globalOpts?.chain,
      durationMs: Date.now() - startedAt,
      scannedFromBlock,
      scannedToBlock,
      eventCounts,
      lastSyncTime: syncMeta?.lastSyncTime ?? null,
    });
  } catch (error) {
    if (await maybeRecoverMissingWalletSetup(error, cmd)) {
      return;
    }
    printError(error, mode.isJson);
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  }
}
