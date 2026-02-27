import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import {
  initializeAccountService,
  saveAccount,
  toPoolInfo,
  withSuppressedSdkStdout,
} from "../services/account.js";
import { listPools } from "../services/pools.js";
import {
  printTable,
  spinner,
  formatAmount,
  formatAddress,
  formatTxHash,
  warn,
} from "../utils/format.js";
import { CLIError, printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import type { Address } from "viem";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  buildAllPoolAccountRefs,
  buildPoolAccountRefs,
} from "../utils/pool-accounts.js";

export function createAccountsCommand(): Command {
  return new Command("accounts")
    .description("List your Pool Accounts (PA-1, PA-2, ...)")
    .option("--sync", "Sync account state before displaying")
    .option("--all", "Include exited and fully spent Pool Accounts")
    .option("--details", "Show low-level commitment details (hash/label/tx)")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools accounts\n  privacy-pools accounts --all\n  privacy-pools accounts --details\n  privacy-pools accounts --sync --chain sepolia\n  privacy-pools accounts --json\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ chain, accounts: [{ poolAccountId, status, asset, scope, value, hash, label, ... }] }",
        })
    )
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(
          globalOpts?.chain,
          config.defaultChain
        );

        const mnemonic = loadMnemonic();

        const spin = spinner("Loading accounts...", silent);
        spin.start();

        const pools = await listPools(chainConfig, globalOpts?.rpcUrl);

        if (pools.length === 0) {
          spin.stop();
          if (isJson) {
            printJsonSuccess({ chain: chainConfig.name, accounts: [] });
          } else {
            process.stderr.write(`No pools found on ${chainConfig.name}.\n`);
          }
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

        if (opts.sync) {
          spin.text = "Syncing...";
          let syncFailures = 0;
          for (const poolInfo of poolInfos) {
            const pi = toPoolInfo(poolInfo);
            try {
              await withSuppressedSdkStdout(async () => {
                await accountService.getDepositEvents(pi);
                await accountService.getWithdrawalEvents(pi);
                await accountService.getRagequitEvents(pi);
              });
            } catch (err) {
              syncFailures++;
              warn(`Sync failed for pool ${poolInfo.address}: ${err instanceof Error ? err.message : String(err)}`, silent);
            }
          }
          if (syncFailures > 0 && isJson) {
            throw new CLIError(
              `Account sync failed for ${syncFailures} pool(s).`,
              "RPC",
              "Retry with a healthy RPC before using account data."
            );
          }
          saveAccount(chainConfig.id, accountService.account);
        }

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
        spin.stop();

        if (isJson) {
          const jsonData: Record<string, unknown>[] = [];
          for (const scopeStr of sortedScopeStrings) {
            const scopeBigInt = BigInt(scopeStr);
            const commitments = spendable.get(scopeBigInt) ?? [];
            const pool = pools.find(
              (p) => p.scope.toString() === scopeStr
            );
            if (!pool) continue;

            const poolAccounts = opts.all
              ? buildAllPoolAccountRefs(
                accountService.account,
                pool.scope,
                commitments
              )
              : buildPoolAccountRefs(
              accountService.account,
              pool.scope,
              commitments
            );
            poolAccounts.sort((a, b) => a.paNumber - b.paNumber);

            for (const pa of poolAccounts) {
              const c = pa.commitment;
              jsonData.push({
                poolAccountNumber: pa.paNumber,
                poolAccountId: pa.paId,
                status: pa.status,
                asset: pool.symbol,
                scope: scopeBigInt.toString(),
                value: pa.value.toString(),
                hash: c.hash.toString(),
                label: c.label.toString(),
                blockNumber: pa.blockNumber.toString(),
                txHash: pa.txHash,
              });
            }
          }
          printJsonSuccess({ chain: chainConfig.name, accounts: jsonData });
          return;
        }

        process.stderr.write(`\nAccounts on ${chainConfig.name}:\n\n`);
        let renderedAny = false;

        for (const scopeStr of sortedScopeStrings) {
          const scopeBigInt = BigInt(scopeStr);
          const commitments = spendable.get(scopeBigInt) ?? [];
          const pool = pools.find(
            (p) => p.scope.toString() === scopeStr
          );
          if (!pool) continue;

          const poolAccounts = opts.all
            ? buildAllPoolAccountRefs(
              accountService.account,
              pool.scope,
              commitments
            )
            : buildPoolAccountRefs(
            accountService.account,
            pool.scope,
            commitments
          );
          poolAccounts.sort((a, b) => a.paNumber - b.paNumber);
          if (poolAccounts.length === 0) continue;
          renderedAny = true;

          process.stderr.write(`  ${pool.symbol} pool (${formatAddress(pool.pool)}):\n`);

          if (opts.details) {
            printTable(
              ["PA", "Status", "Value", "Commitment", "Label", "Block", "Tx"],
              poolAccounts.map((pa) => [
                pa.paId,
                pa.status.charAt(0).toUpperCase() + pa.status.slice(1),
                formatAmount(pa.value, pool.decimals, pool.symbol),
                formatAddress(`0x${pa.commitment.hash.toString(16).padStart(64, "0")}`, 8),
                formatAddress(`0x${pa.label.toString(16).padStart(64, "0")}`, 8),
                pa.blockNumber.toString(),
                formatTxHash(pa.txHash),
              ])
            );
          } else {
            printTable(
              ["PA", "Balance", "Status", "Last Activity"],
              poolAccounts.map((pa) => [
                pa.paId,
                formatAmount(pa.value, pool.decimals, pool.symbol),
                pa.status.charAt(0).toUpperCase() + pa.status.slice(1),
                `block ${pa.blockNumber.toString()} • ${formatTxHash(pa.txHash)}`,
              ])
            );
          }

          process.stderr.write("\n");
        }

        if (!renderedAny) {
          process.stderr.write(
            opts.all
              ? "No Pool Accounts found.\n\n"
              : `No spendable Pool Accounts found. Deposit first, then run 'privacy-pools accounts --chain ${chainConfig.name}'.\n\n`
          );
        }
      } catch (error) {
        printError(error, isJson);
      }
    });
}
