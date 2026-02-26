import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount, toPoolInfo } from "../services/account.js";
import { listPools } from "../services/pools.js";
import { printTable, spinner, formatAmount, warn } from "../utils/format.js";
import { printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
export function createBalanceCommand() {
    return new Command("balance")
        .description("Show balances across pools")
        .option("--sync", "Sync account state from on-chain events before displaying")
        .addHelpText("after", "\nExamples:\n  privacy-pools balance\n  privacy-pools balance --sync --chain sepolia\n  privacy-pools balance --json\n"
        + commandHelpText({
            prerequisites: "init",
            jsonFields: "{ chain, balances: [{ asset, assetAddress, balance, commitments }] }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const isJson = globalOpts?.json ?? false;
        const isQuiet = globalOpts?.quiet ?? false;
        const silent = isQuiet || isJson;
        try {
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            const mnemonic = loadMnemonic();
            const spin = spinner("Loading balances...", silent);
            spin.start();
            // Discover pools
            const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
            if (pools.length === 0) {
                spin.stop();
                if (isJson) {
                    printJsonSuccess({ chain: chainConfig.name, balances: [] });
                }
                else {
                    process.stderr.write(`No pools found on ${chainConfig.name}.\n`);
                }
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
            const accountService = await initializeAccountService(dataService, mnemonic, poolInfos, chainConfig.id);
            if (opts.sync) {
                spin.text = "Syncing account state...";
                for (const poolInfo of poolInfos) {
                    const pi = toPoolInfo(poolInfo);
                    try {
                        await accountService.getDepositEvents(pi);
                        await accountService.getWithdrawalEvents(pi);
                        await accountService.getRagequitEvents(pi);
                    }
                    catch (err) {
                        warn(`Sync failed for pool ${poolInfo.address}: ${err instanceof Error ? err.message : String(err)}`, silent);
                    }
                }
                saveAccount(chainConfig.id, accountService.account);
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
                rows.push([
                    pool.symbol,
                    formatAmount(totalValue, pool.decimals, pool.symbol),
                    commitments.length.toString(),
                ]);
                jsonData.push({
                    asset: pool.symbol,
                    assetAddress: pool.asset,
                    balance: totalValue.toString(),
                    commitments: commitments.length,
                });
            }
            if (rows.length === 0) {
                if (isJson) {
                    printJsonSuccess({ chain: chainConfig.name, balances: [] }, false);
                }
                else {
                    process.stderr.write(`\nNo balances found on ${chainConfig.name}.\n`);
                }
                return;
            }
            if (isJson) {
                printJsonSuccess({ chain: chainConfig.name, balances: jsonData }, false);
                return;
            }
            process.stderr.write(`\nBalances on ${chainConfig.name}:\n\n`);
            printTable(["Asset", "Balance", "Commitments"], rows);
        }
        catch (error) {
            printError(error, isJson);
        }
    });
}
