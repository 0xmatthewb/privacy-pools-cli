import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount, toPoolInfo, withSuppressedSdkStdout, } from "../services/account.js";
import { listPools } from "../services/pools.js";
import { spinner, formatAmount, warn, verbose } from "../utils/format.js";
import { CLIError, printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import { createOutputContext, isSilent } from "../output/common.js";
import { renderBalanceNoPools, renderBalanceEmpty, renderBalance } from "../output/balance.js";
export function createBalanceCommand() {
    return new Command("balance")
        .description("Show balances across pools")
        .option("--no-sync", "Skip syncing account state before displaying")
        .addHelpText("after", "\nExamples:\n  privacy-pools balance\n  privacy-pools balance --no-sync --chain sepolia\n  privacy-pools balance --json\n"
        + commandHelpText({
            prerequisites: "init",
            jsonFields: "{ chain, balances: [{ asset, assetAddress, balance, commitments, poolAccounts }] }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isVerbose = globalOpts?.verbose ?? false;
        const ctx = createOutputContext(mode, isVerbose);
        const silent = isSilent(ctx);
        try {
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);
            const mnemonic = loadMnemonic();
            const spin = spinner("Loading balances...", silent);
            spin.start();
            // Discover pools
            const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
            verbose(`Discovered ${pools.length} pool(s)`, isVerbose, silent);
            if (pools.length === 0) {
                spin.stop();
                renderBalanceNoPools(ctx, chainConfig.name);
                return;
            }
            // Set up data service for all pools
            const poolInfos = pools.map((p) => ({
                chainId: chainConfig.id,
                address: p.pool,
                scope: p.scope,
                deploymentBlock: chainConfig.startBlock,
            }));
            // Use the first pool's data service (covers the chain)
            const dataService = getDataService(chainConfig, pools[0].pool, globalOpts?.rpcUrl);
            const accountService = await initializeAccountService(dataService, mnemonic, poolInfos, chainConfig.id, false, silent, true);
            if (opts.noSync !== true) {
                spin.text = "Syncing account state...";
                let syncFailures = 0;
                for (const poolInfo of poolInfos) {
                    const pi = toPoolInfo(poolInfo);
                    try {
                        await withSuppressedSdkStdout(async () => {
                            await accountService.getDepositEvents(pi);
                            await accountService.getWithdrawalEvents(pi);
                            await accountService.getRagequitEvents(pi);
                        });
                    }
                    catch (err) {
                        syncFailures++;
                        const symbol = pools.find((p) => p.pool.toLowerCase() === poolInfo.address.toLowerCase())?.symbol ?? poolInfo.address;
                        warn(`Sync failed for ${symbol} pool: ${err instanceof Error ? err.message : String(err)}`, silent);
                    }
                }
                if (syncFailures > 0 && mode.isJson) {
                    throw new CLIError(`Balance sync failed for ${syncFailures} pool(s).`, "RPC", "Retry with a healthy RPC before using balance data.");
                }
                guardCriticalSection();
                try {
                    saveAccount(chainConfig.id, accountService.account);
                }
                finally {
                    releaseCriticalSection();
                }
            }
            // Get spendable commitments
            const spendable = accountService.getSpendableCommitments();
            spin.stop();
            const rows = [];
            const jsonData = [];
            for (const [scopeBigInt, commitments] of spendable.entries()) {
                const pool = pools.find((p) => p.scope.toString() === scopeBigInt.toString());
                if (!pool || commitments.length === 0)
                    continue;
                const totalValue = commitments.reduce((sum, c) => sum + c.value, 0n);
                rows.push({
                    symbol: pool.symbol,
                    formattedBalance: formatAmount(totalValue, pool.decimals, pool.symbol),
                    commitments: commitments.length,
                });
                jsonData.push({
                    asset: pool.symbol,
                    assetAddress: pool.asset,
                    balance: totalValue.toString(),
                    commitments: commitments.length,
                    poolAccounts: commitments.length,
                });
            }
            rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
            jsonData.sort((a, b) => a.asset.localeCompare(b.asset));
            if (rows.length === 0) {
                renderBalanceEmpty(ctx, chainConfig.name);
                return;
            }
            renderBalance(ctx, {
                chain: chainConfig.name,
                rows,
                jsonData,
            });
        }
        catch (error) {
            printError(error, mode.isJson);
        }
    });
}
