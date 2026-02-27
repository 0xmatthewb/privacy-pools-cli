import { Command } from "commander";
import type { Address } from "viem";
import type {
  PoolAccount,
  RagequitEvent,
} from "@0xbow/privacy-pools-core-sdk";
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
import { explorerTxUrl } from "../config/chains.js";
import {
  printTable,
  spinner,
  formatAmount,
  formatTxHash,
  warn,
  verbose,
} from "../utils/format.js";
import { CLIError, printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";

export interface HistoryEvent {
  type: "deposit" | "withdrawal" | "ragequit";
  asset: string;
  poolAddress: string;
  paNumber: number;
  paId: string;
  value: bigint;
  blockNumber: bigint;
  txHash: string;
}

interface AccountLike {
  poolAccounts?: Map<bigint, PoolAccount[]>;
}

interface PoolLike {
  symbol: string;
  pool: string;
  scope: bigint;
}

export function buildHistoryEventsFromAccount(
  account: AccountLike | null | undefined,
  pools: readonly PoolLike[]
): HistoryEvent[] {
  const events: HistoryEvent[] = [];
  const poolAccountsMap = account?.poolAccounts;

  if (!(poolAccountsMap instanceof Map)) return events;

  for (const [scopeKey, poolAccountsList] of poolAccountsMap.entries()) {
    if (!Array.isArray(poolAccountsList)) continue;
    const scopeStr = scopeKey.toString();
    const pool = pools.find((p) => p.scope.toString() === scopeStr);
    if (!pool) continue;

    let paNumber = 1;
    for (const pa of poolAccountsList as PoolAccount[]) {
      const paId = `PA-${paNumber}`;

      if (pa.deposit) {
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
          const withdrawnAmount = prevValue - child.value;
          events.push({
            type: "withdrawal",
            asset: pool.symbol,
            poolAddress: pool.pool,
            paNumber,
            paId,
            value: withdrawnAmount > 0n ? withdrawnAmount : child.value,
            blockNumber: child.blockNumber,
            txHash: child.txHash,
          });
          prevValue = child.value;
        }
      }

      const ragequit = pa.ragequit as RagequitEvent | null | undefined;
      if (
        ragequit &&
        typeof ragequit === "object" &&
        typeof ragequit.blockNumber === "bigint"
      ) {
        const latestCommitment =
          pa.children && pa.children.length > 0
            ? pa.children[pa.children.length - 1]
            : pa.deposit;
        events.push({
          type: "ragequit",
          asset: pool.symbol,
          poolAddress: pool.pool,
          paNumber,
          paId,
          value: latestCommitment?.value ?? 0n,
          blockNumber: ragequit.blockNumber,
          txHash: ragequit.transactionHash,
        });
      }

      paNumber++;
    }
  }

  return events;
}

export function createHistoryCommand(): Command {
  return new Command("history")
    .description("Show chronological event history (deposits, withdrawals, exits)")
    .option("--no-sync", "Skip syncing account state before displaying")
    .option("-n, --limit <n>", "Show last N events", "50")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools history\n  privacy-pools history --limit 10\n  privacy-pools history --no-sync --chain sepolia\n  privacy-pools history --json\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ chain, events: [{ type, asset, poolAddress, poolAccountId, value, blockNumber, txHash, explorerUrl }] }",
        })
    )
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;
      const isVerbose = globalOpts?.verbose ?? false;
      const limit = Math.max(1, parseInt(opts.limit, 10) || 50);

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(
          globalOpts?.chain,
          config.defaultChain
        );
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

        const mnemonic = loadMnemonic();

        const spin = spinner("Loading history...", silent);
        spin.start();

        const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
        verbose(`Discovered ${pools.length} pool(s)`, isVerbose, silent);

        if (pools.length === 0) {
          spin.stop();
          if (isJson) {
            printJsonSuccess({ chain: chainConfig.name, events: [] });
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

        if (opts.noSync !== true) {
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
              `History sync failed for ${syncFailures} pool(s).`,
              "RPC",
              "Retry with a healthy RPC before using history data."
            );
          }
          guardCriticalSection();
          try {
            saveAccount(chainConfig.id, accountService.account);
          } finally {
            releaseCriticalSection();
          }
        }

        // Extract chronological events from local account state.
        const events = buildHistoryEventsFromAccount(accountService.account, pools);

        // Sort chronologically (newest first)
        events.sort((a, b) => {
          if (a.blockNumber > b.blockNumber) return -1;
          if (a.blockNumber < b.blockNumber) return 1;
          return 0;
        });

        const limited = events.slice(0, limit);

        spin.stop();

        if (isJson) {
          printJsonSuccess({
            chain: chainConfig.name,
            events: limited.map((e) => ({
              type: e.type,
              asset: e.asset,
              poolAddress: e.poolAddress,
              poolAccountNumber: e.paNumber,
              poolAccountId: e.paId,
              value: e.value.toString(),
              blockNumber: e.blockNumber.toString(),
              txHash: e.txHash,
              explorerUrl: explorerTxUrl(chainConfig.id, e.txHash),
            })),
          });
          return;
        }

        if (limited.length === 0) {
          process.stderr.write(`\nNo events found on ${chainConfig.name}.\n`);
          return;
        }

        process.stderr.write(`\nHistory on ${chainConfig.name} (last ${limited.length} events):\n\n`);
        const poolByAddress = new Map<string, (typeof pools)[number]>(pools.map((p) => [p.pool, p]));
        printTable(
          ["Block", "Type", "PA", "Amount", "Tx"],
          limited.map((e) => {
            const pool = poolByAddress.get(e.poolAddress);
            const typeLabel =
              e.type === "deposit" ? "Deposit" :
              e.type === "withdrawal" ? "Withdraw" :
              "Ragequit";
            return [
              e.blockNumber.toString(),
              typeLabel,
              e.paId,
              formatAmount(e.value, pool?.decimals ?? 18, e.asset),
              formatTxHash(e.txHash),
            ];
          })
        );
        process.stderr.write("\n");
      } catch (error) {
        printError(error, isJson);
      }
    });
}
