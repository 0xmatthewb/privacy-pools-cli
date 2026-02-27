import { Command } from "commander";
import type { Address } from "viem";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount } from "../services/account.js";
import { listPools, resolvePool } from "../services/pools.js";
import { printError } from "../utils/errors.js";
import { spinner, verbose } from "../utils/format.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderSyncEmpty, renderSyncComplete } from "../output/sync.js";

export function createSyncCommand(): Command {
  return new Command("sync")
    .description("Sync local account state from on-chain events")
    .option("--asset <symbol|address>", "Sync only a single pool asset")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools sync\n  privacy-pools sync --chain sepolia\n  privacy-pools sync --asset ETH --json\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ chain, syncedPools, syncedSymbols, spendableCommitments }",
        })
    )
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isVerbose = globalOpts?.verbose ?? false;
      const ctx = createOutputContext(mode, isVerbose);
      const silent = isSilent(ctx);

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
        const mnemonic = loadMnemonic();

        const spin = spinner("Resolving pools for sync...", silent);
        spin.start();

        const pools = opts.asset
          ? [await resolvePool(chainConfig, opts.asset, globalOpts?.rpcUrl)]
          : await listPools(chainConfig, globalOpts?.rpcUrl);

        if (pools.length === 0) {
          spin.stop();
          renderSyncEmpty(ctx, chainConfig.name);
          return;
        }

        verbose(
          `Syncing ${pools.length} pool(s): ${pools.map((p) => p.symbol).join(", ")}`,
          isVerbose,
          silent
        );

        const poolInfos = pools.map((p) => ({
          chainId: chainConfig.id,
          address: p.pool as Address,
          scope: p.scope,
          deploymentBlock: chainConfig.startBlock,
        }));

        const dataService = getDataService(
          chainConfig,
          pools[0].pool,
          globalOpts?.rpcUrl
        );

        spin.text = "Syncing deposit/withdrawal/ragequit events...";
        const accountService = await initializeAccountService(
          dataService,
          mnemonic,
          poolInfos,
          chainConfig.id,
          true,
          silent,
          true
        );

        guardCriticalSection();
        try {
          saveAccount(chainConfig.id, accountService.account);
        } finally {
          releaseCriticalSection();
        }
        const spendable = accountService.getSpendableCommitments();
        const spendableCount = Array.from(spendable.values()).reduce(
          (acc, list) => acc + list.length,
          0
        );

        spin.succeed("Sync complete.");

        renderSyncComplete(ctx, {
          chain: chainConfig.name,
          syncedPools: pools.length,
          syncedSymbols: pools.map((p) => p.symbol),
          spendableCommitments: spendableCount,
        });
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
