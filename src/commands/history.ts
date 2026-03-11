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
  syncAccountEvents,
} from "../services/account.js";
import { listPools } from "../services/pools.js";
import { explorerTxUrl } from "../config/chains.js";
import { getPublicClient } from "../services/sdk.js";
import { spinner, verbose } from "../utils/format.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderHistoryNoPools, renderHistory } from "../output/history.js";

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
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option("-n, --limit <n>", "Show last N events", "50")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools history\n  privacy-pools history --limit 10\n  privacy-pools history --json\n  privacy-pools history --no-sync --chain mainnet\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ chain, events: [{ type, asset, poolAddress, poolAccountId, value, blockNumber, txHash, explorerUrl }] }",
        })
    )
    .action(async (opts, cmd) => {
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
            "--limit must be a positive integer."
          ),
          mode.isJson,
        );
        return;
      }
      const limit = parsedLimit;

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
          renderHistoryNoPools(ctx, chainConfig.name);
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
          skip: opts.sync === false,
          force: false,
          silent,
          isJson: mode.isJson,
          isVerbose,
          errorLabel: "History",
        });

        // Extract chronological events from local account state.
        const events = buildHistoryEventsFromAccount(accountService.account, pools);

        // Sort chronologically (newest first)
        events.sort((a, b) => {
          if (a.blockNumber > b.blockNumber) return -1;
          if (a.blockNumber < b.blockNumber) return 1;
          return 0;
        });

        const limited = events.slice(0, limit);

        // Fetch current block for approximate relative timestamps (non-fatal).
        let currentBlock: bigint | null = null;
        try {
          const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
          currentBlock = await publicClient.getBlockNumber();
        } catch { /* non-fatal — fall back to block numbers */ }

        spin.stop();

        const poolByAddress = new Map(
          pools.map((p) => [p.pool, { pool: p.pool, decimals: p.decimals }])
        );

        renderHistory(ctx, {
          chain: chainConfig.name,
          chainId: chainConfig.id,
          events: limited,
          poolByAddress,
          explorerTxUrl,
          currentBlock,
        });
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
