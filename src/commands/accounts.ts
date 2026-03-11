import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountService,
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { listPools } from "../services/pools.js";
import { fetchApprovedLabels } from "../services/asp.js";
import { spinner, verbose, deriveTokenPrice } from "../utils/format.js";
import { withSpinnerProgress } from "../utils/proof-progress.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
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

interface AccountsCommandOptions {
  sync?: boolean;
  all?: boolean;
  details?: boolean;
  summary?: boolean;
  pendingOnly?: boolean;
}

interface AccountScopeSource {
  poolAccounts?: Map<bigint, unknown[]>;
}

export function collectAccountScopeStrings(
  spendable: ReadonlyMap<bigint, readonly unknown[]>,
  account: AccountScopeSource | null | undefined,
  includeHistorical: boolean,
): string[] {
  const scopeSet = new Set<string>();
  for (const scope of spendable.keys()) {
    scopeSet.add(scope.toString());
  }

  if (includeHistorical) {
    const map = account?.poolAccounts;
    if (map instanceof Map) {
      for (const scope of map.keys()) {
        scopeSet.add(scope.toString());
      }
    }
  }

  return Array.from(scopeSet).sort((a, b) => {
    const aa = BigInt(a);
    const bb = BigInt(b);
    if (aa < bb) return -1;
    if (aa > bb) return 1;
    return 0;
  });
}

export function createAccountsCommand(): Command {
  const metadata = getCommandMetadata("accounts");
  return new Command("accounts")
    .description(metadata.description)
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option("--all", "Include exited and fully spent Pool Accounts")
    .option("--details", "Show additional details per Pool Account")
    .option("--summary", "Show counts and balances only")
    .option("--pending-only", "Show only pending ASP approvals")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (opts: AccountsCommandOptions, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isVerbose = globalOpts?.verbose ?? false;
      const ctx = createOutputContext(mode, isVerbose);
      const silent = isSilent(ctx);

      try {
        if (opts.summary && opts.pendingOnly) {
          throw new CLIError(
            "Cannot specify both --summary and --pending-only.",
            "INPUT",
            "Use one compact polling mode at a time."
          );
        }

        if ((opts.summary || opts.pendingOnly) && opts.details) {
          throw new CLIError(
            "Compact account modes do not support --details.",
            "INPUT",
            "Remove --details when using --summary or --pending-only."
          );
        }

        if ((opts.summary || opts.pendingOnly) && opts.all) {
          throw new CLIError(
            "Compact account modes do not support --all.",
            "INPUT",
            "Remove --all when using --summary or --pending-only."
          );
        }

        const config = loadConfig();
        const chainConfig = resolveChain(
          globalOpts?.chain,
          config.defaultChain
        );
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

        const mnemonic = loadMnemonic();

        const spin = spinner("Discovering pools...", silent);
        spin.start();

        const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
        verbose(`Discovered ${pools.length} pool(s)`, isVerbose, silent);

        if (pools.length === 0) {
          spin.stop();
          renderAccountsNoPools(ctx, chainConfig.name, {
            summary: !!opts.summary,
            pendingOnly: !!opts.pendingOnly,
          });
          return;
        }

        const poolInfos = pools.map((p) => ({
          chainId: chainConfig.id,
          address: p.pool as Address,
          scope: p.scope,
          deploymentBlock: chainConfig.startBlock,
        }));

        const dataService = await getDataService(
          chainConfig,
          pools[0].pool,
          globalOpts?.rpcUrl
        );

        spin.text = "Initializing account state...";
        const accountService = await initializeAccountService(
          dataService,
          mnemonic,
          poolInfos,
          chainConfig.id,
          false,
          silent,
          true
        );

        await withSpinnerProgress(
          spin,
          "Syncing onchain events",
          () => syncAccountEvents(accountService, poolInfos, pools, chainConfig.id, {
            skip: opts.sync === false,
            force: false,
            silent,
            isJson: mode.isJson,
            isVerbose,
            errorLabel: "Account",
          }),
        );

        const spendable = withSuppressedSdkStdoutSync(() =>
          accountService.getSpendableCommitments()
        );
        const sortedScopeStrings = collectAccountScopeStrings(
          spendable,
          accountService.account,
          !!opts.all || !!opts.summary,
        );

        // Fetch ASP approval status in parallel (non-fatal if unavailable)
        spin.text = "Checking ASP approval status...";
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
          const poolAccounts = (opts.all || opts.summary)
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
          chainId: chainConfig.id,
          groups,
          showDetails: !!opts.details,
          showAll: !!opts.all,
          showSummary: !!opts.summary,
          showPendingOnly: !!opts.pendingOnly,
        });
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
