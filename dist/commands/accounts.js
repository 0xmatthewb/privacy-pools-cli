import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount, toPoolInfo } from "../services/account.js";
import { listPools } from "../services/pools.js";
import { printTable, spinner, formatAmount, formatAddress, formatTxHash, warn, } from "../utils/format.js";
import { CLIError, printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";
export function createAccountsCommand() {
    return new Command("accounts")
        .description("List pool accounts and commitment details")
        .option("--sync", "Sync account state before displaying")
        .addHelpText("after", "\nExamples:\n  privacy-pools accounts\n  privacy-pools accounts --sync --chain sepolia\n  privacy-pools accounts --json\n"
        + commandHelpText({
            prerequisites: "init",
            jsonFields: "{ chain, accounts: [{ asset, scope, value, hash, label, ... }] }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const silent = isQuiet || isJson;
        try {
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            const mnemonic = loadMnemonic();
            const spin = spinner("Loading accounts...", silent);
            spin.start();
            const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
            if (pools.length === 0) {
                spin.stop();
                if (isJson) {
                    printJsonSuccess({ chain: chainConfig.name, accounts: [] });
                }
                else {
                    process.stderr.write(`No pools found on ${chainConfig.name}.\n`);
                }
                return;
            }
            const poolInfos = pools.map((p) => ({
                chainId: chainConfig.id,
                address: p.pool,
                scope: p.scope,
                deploymentBlock: chainConfig.startBlock,
            }));
            const dataService = getDataService(chainConfig, pools[0].pool, globalOpts?.rpcUrl);
            const accountService = await initializeAccountService(dataService, mnemonic, poolInfos, chainConfig.id, false, silent, true);
            if (opts.sync) {
                spin.text = "Syncing...";
                let syncFailures = 0;
                for (const poolInfo of poolInfos) {
                    const pi = toPoolInfo(poolInfo);
                    try {
                        await accountService.getDepositEvents(pi);
                        await accountService.getWithdrawalEvents(pi);
                        await accountService.getRagequitEvents(pi);
                    }
                    catch (err) {
                        syncFailures++;
                        warn(`Sync failed for pool ${poolInfo.address}: ${err instanceof Error ? err.message : String(err)}`, silent);
                    }
                }
                if (syncFailures > 0 && isJson) {
                    throw new CLIError(`Account sync failed for ${syncFailures} pool(s).`, "RPC", "Retry with a healthy RPC before using account data.");
                }
                saveAccount(chainConfig.id, accountService.account);
            }
            const spendable = accountService.getSpendableCommitments();
            spin.stop();
            if (isJson) {
                const jsonData = [];
                for (const [scopeBigInt, commitments] of spendable.entries()) {
                    const pool = pools.find((p) => p.scope.toString() === scopeBigInt.toString());
                    if (!pool)
                        continue;
                    for (const c of commitments) {
                        jsonData.push({
                            asset: pool.symbol,
                            scope: scopeBigInt.toString(),
                            value: c.value.toString(),
                            hash: c.hash.toString(),
                            label: c.label.toString(),
                            blockNumber: c.blockNumber.toString(),
                            txHash: c.txHash,
                        });
                    }
                }
                printJsonSuccess({ chain: chainConfig.name, accounts: jsonData });
                return;
            }
            process.stderr.write(`\nAccounts on ${chainConfig.name}:\n\n`);
            for (const [scopeBigInt, commitments] of spendable.entries()) {
                const pool = pools.find((p) => p.scope.toString() === scopeBigInt.toString());
                if (!pool || commitments.length === 0)
                    continue;
                process.stderr.write(`  ${pool.symbol} pool (${formatAddress(pool.pool)}):\n`);
                printTable(["Value", "Commitment", "Label", "Block", "Tx"], commitments.map((c) => [
                    formatAmount(c.value, pool.decimals, pool.symbol),
                    formatAddress(`0x${c.hash.toString(16).padStart(64, "0")}`, 8),
                    formatAddress(`0x${c.label.toString(16).padStart(64, "0")}`, 8),
                    c.blockNumber.toString(),
                    formatTxHash(c.txHash),
                ]));
                process.stderr.write("\n");
            }
        }
        catch (error) {
            printError(error, isJson);
        }
    });
}
