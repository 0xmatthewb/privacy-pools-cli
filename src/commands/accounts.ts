import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountService,
  syncAccountEvents,
} from "../services/account.js";
import { listPools } from "../services/pools.js";
import { fetchApprovedLabels } from "../services/asp.js";
import { spinner, verbose, deriveTokenPrice } from "../utils/format.js";
import { printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import type { Address } from "viem";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  buildAllPoolAccountRefs,
  buildPoolAccountRefs,
} from "../utils/pool-accounts.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderAccountsNoPools, renderAccounts } from "../output/accounts.js";
import type { AccountPoolGroup } from "../output/accounts.js";

export function createAccountsCommand(): Command {
  return new Command("accounts")
    .description("List your Pool Accounts with balances")
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option("--all", "Include exited and fully spent Pool Accounts")
    .option("--details", "Show additional details per Pool Account")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools accounts\n  privacy-pools accounts --all\n  privacy-pools accounts --details\n  privacy-pools accounts --json\n  privacy-pools accounts --no-sync --chain sepolia\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ chain, accounts: [{ poolAccountId, status, asset, scope, value, hash, label, ... }] }",
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
        const chainConfig = resolveChain(
          globalOpts?.chain,
          config.defaultChain
        );
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

        const mnemonic = loadMnemonic();

        const spin = spinner("Loading accounts...", silent);
        spin.start();

        const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
        verbose(`Discovered ${pools.length} pool(s)`, isVerbose, silent);

        if (pools.length === 0) {
          spin.stop();
          renderAccountsNoPools(ctx, chainConfig.name);
          return;
        }

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

        const accountService = await initializeAccountService(
          dataService,
          mnemonic,
          poolInfos,
          chainConfig.id,
          false,
          silent,
          true
        );

        spin.text = "Syncing...";
        await syncAccountEvents(accountService, poolInfos, pools, chainConfig.id, {
          skip: opts.noSync === true,
          force: false,
          silent,
          isJson: mode.isJson,
          isVerbose,
          errorLabel: "Account",
        });

        const spendable = accountService.getSpendableCommitments();
        const scopeSet = new Set<string>();
        for (const scope of spendable.keys()) {
          scopeSet.add(scope.toString());
        }
        if (opts.all) {
          const map = accountService.account?.poolAccounts;
          if (map instanceof Map) {
            for (const scope of map.keys()) {
              scopeSet.add(scope.toString());
            }
          }
        }
        const sortedScopeStrings = Array.from(scopeSet).sort((a, b) => {
          const aa = BigInt(a);
          const bb = BigInt(b);
          if (aa < bb) return -1;
          if (aa > bb) return 1;
          return 0;
        });

        // Fetch ASP approval status in parallel (non-fatal if unavailable)
        const approvedLabelsByScope = new Map<string, Set<string> | null>();
        await Promise.all(
          sortedScopeStrings.map(async (scopeStr) => {
            const pool = pools.find((p) => p.scope.toString() === scopeStr);
            if (pool) {
              approvedLabelsByScope.set(scopeStr, await fetchApprovedLabels(chainConfig, pool.scope));
            }
          })
        );

        spin.stop();

        // Build render data
        const groups: AccountPoolGroup[] = [];
        for (const scopeStr of sortedScopeStrings) {
          const scopeBigInt = BigInt(scopeStr);
          const commitments = spendable.get(scopeBigInt) ?? [];
          const pool = pools.find(
            (p) => p.scope.toString() === scopeStr
          );
          if (!pool) continue;

          const approvedLabels = approvedLabelsByScope.get(scopeStr);
          const poolAccounts = opts.all
            ? buildAllPoolAccountRefs(
              accountService.account,
              pool.scope,
              commitments,
              approvedLabels
            )
            : buildPoolAccountRefs(
            accountService.account,
            pool.scope,
            commitments,
            approvedLabels
          );
          poolAccounts.sort((a, b) => a.paNumber - b.paNumber);

          groups.push({
            symbol: pool.symbol,
            poolAddress: pool.pool,
            decimals: pool.decimals,
            scope: pool.scope,
            tokenPrice: deriveTokenPrice(pool),
            poolAccounts,
          });
        }

        renderAccounts(ctx, {
          chain: chainConfig.name,
          groups,
          showDetails: !!opts.details,
          showAll: !!opts.all,
        });
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
