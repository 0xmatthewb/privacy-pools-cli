import type { Command } from "commander";
import type { Address } from "viem";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountServiceWithState,
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { listPools, resolvePool } from "../services/pools.js";
import { printError } from "../utils/errors.js";
import { spinner, verbose } from "../utils/format.js";
import { withSpinnerProgress } from "../utils/proof-progress.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderSyncEmpty, renderSyncComplete } from "../output/sync.js";
import { maybeRenderPreviewScenario } from "../preview/runtime.js";
import { maybeRecoverMissingWalletSetup } from "../utils/setup-recovery.js";
import { warnLegacyAssetFlag } from "../utils/deprecations.js";

export { createSyncCommand } from "../command-shells/sync.js";

export async function handleSyncCommand(
  positionalAsset: string | undefined,
  opts: { asset?: string },
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);
  const silent = isSilent(ctx);

  // Resolve positional vs deprecated --asset flag.
  const asset = positionalAsset ?? opts.asset;
  if (opts.asset !== undefined && positionalAsset === undefined) {
    warnLegacyAssetFlag("privacy-pools sync <asset> (e.g. privacy-pools sync ETH)", silent);
  }

  try {
    if (await maybeRenderPreviewScenario("sync")) {
      return;
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);

    const spin = spinner("Resolving pools for sync...", silent);
    spin.start();

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

    await withSpinnerProgress(
      spin,
      "Syncing deposit/withdrawal/ragequit events",
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

    spin.succeed("Sync complete.");

    renderSyncComplete(ctx, {
      chain: chainConfig.name,
      syncedPools: pools.length,
      syncedSymbols: pools.map((p) => p.symbol),
      availablePoolAccounts: spendableCount,
      previousAvailablePoolAccounts: previousSpendableCount,
      chainOverridden: !!globalOpts?.chain,
    });
  } catch (error) {
    if (await maybeRecoverMissingWalletSetup(error, cmd)) {
      return;
    }
    printError(error, mode.isJson);
  }
}
