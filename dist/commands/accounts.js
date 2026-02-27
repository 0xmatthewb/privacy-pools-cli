import { Command } from "commander";
import chalk from "chalk";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount, toPoolInfo, withSuppressedSdkStdout, } from "../services/account.js";
import { listPools } from "../services/pools.js";
import { fetchApprovedLabels } from "../services/asp.js";
import { printTable, spinner, formatAmount, formatAddress, formatTxHash, warn, verbose, } from "../utils/format.js";
import { CLIError, printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { buildAllPoolAccountRefs, buildPoolAccountRefs, } from "../utils/pool-accounts.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
export function createAccountsCommand() {
    return new Command("accounts")
        .description("List your Pool Accounts (PA-1, PA-2, ...)")
        .option("--no-sync", "Skip syncing account state before displaying")
        .option("--all", "Include exited and fully spent Pool Accounts")
        .option("--details", "Show low-level commitment details (hash/label/tx)")
        .addHelpText("after", "\nExamples:\n  privacy-pools accounts\n  privacy-pools accounts --all\n  privacy-pools accounts --details\n  privacy-pools accounts --no-sync --chain sepolia\n  privacy-pools accounts --json\n"
        + commandHelpText({
            prerequisites: "init",
            jsonFields: "{ chain, accounts: [{ poolAccountId, status, asset, scope, value, hash, label, ... }] }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const silent = isQuiet || isJson;
        const isVerbose = globalOpts?.verbose ?? false;
        try {
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);
            const mnemonic = loadMnemonic();
            const spin = spinner("Loading accounts...", silent);
            spin.start();
            const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
            verbose(`Discovered ${pools.length} pool(s)`, isVerbose, silent);
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
                    }
                    catch (err) {
                        syncFailures++;
                        warn(`Sync failed for pool ${poolInfo.address}: ${err instanceof Error ? err.message : String(err)}`, silent);
                    }
                }
                if (syncFailures > 0 && isJson) {
                    throw new CLIError(`Account sync failed for ${syncFailures} pool(s).`, "RPC", "Retry with a healthy RPC before using account data.");
                }
                guardCriticalSection();
                try {
                    saveAccount(chainConfig.id, accountService.account);
                }
                finally {
                    releaseCriticalSection();
                }
            }
            const spendable = accountService.getSpendableCommitments();
            const scopeSet = new Set();
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
                if (aa < bb)
                    return -1;
                if (aa > bb)
                    return 1;
                return 0;
            });
            // Fetch ASP approval status (non-fatal if unavailable)
            const approvedLabelsByScope = new Map();
            for (const scopeStr of sortedScopeStrings) {
                const pool = pools.find((p) => p.scope.toString() === scopeStr);
                if (pool) {
                    approvedLabelsByScope.set(scopeStr, await fetchApprovedLabels(chainConfig, pool.scope));
                }
            }
            spin.stop();
            if (isJson) {
                const jsonData = [];
                for (const scopeStr of sortedScopeStrings) {
                    const scopeBigInt = BigInt(scopeStr);
                    const commitments = spendable.get(scopeBigInt) ?? [];
                    const pool = pools.find((p) => p.scope.toString() === scopeStr);
                    if (!pool)
                        continue;
                    const approvedLabels = approvedLabelsByScope.get(scopeStr);
                    const poolAccounts = opts.all
                        ? buildAllPoolAccountRefs(accountService.account, pool.scope, commitments, approvedLabels)
                        : buildPoolAccountRefs(accountService.account, pool.scope, commitments, approvedLabels);
                    poolAccounts.sort((a, b) => a.paNumber - b.paNumber);
                    for (const pa of poolAccounts) {
                        const c = pa.commitment;
                        jsonData.push({
                            poolAccountNumber: pa.paNumber,
                            poolAccountId: pa.paId,
                            status: pa.status,
                            aspStatus: pa.aspStatus,
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
                const pool = pools.find((p) => p.scope.toString() === scopeStr);
                if (!pool)
                    continue;
                const approvedLabels = approvedLabelsByScope.get(scopeStr);
                const poolAccounts = opts.all
                    ? buildAllPoolAccountRefs(accountService.account, pool.scope, commitments, approvedLabels)
                    : buildPoolAccountRefs(accountService.account, pool.scope, commitments, approvedLabels);
                poolAccounts.sort((a, b) => a.paNumber - b.paNumber);
                if (poolAccounts.length === 0)
                    continue;
                renderedAny = true;
                process.stderr.write(`  ${pool.symbol} pool (${formatAddress(pool.pool)}):\n`);
                if (opts.details) {
                    printTable(["PA", "Status", "ASP", "Value", "Commitment", "Label", "Block", "Tx"], poolAccounts.map((pa) => [
                        pa.paId,
                        pa.status.charAt(0).toUpperCase() + pa.status.slice(1),
                        pa.aspStatus === "approved"
                            ? chalk.green("Approved")
                            : pa.aspStatus === "pending"
                                ? chalk.yellow("Pending")
                                : "",
                        formatAmount(pa.value, pool.decimals, pool.symbol),
                        formatAddress(`0x${pa.commitment.hash.toString(16).padStart(64, "0")}`, 8),
                        formatAddress(`0x${pa.label.toString(16).padStart(64, "0")}`, 8),
                        pa.blockNumber.toString(),
                        formatTxHash(pa.txHash),
                    ]));
                }
                else {
                    printTable(["PA", "Balance", "Status", "Last Activity"], poolAccounts.map((pa) => {
                        const statusLabel = pa.status.charAt(0).toUpperCase() + pa.status.slice(1);
                        const aspSuffix = pa.aspStatus === "approved"
                            ? ` (${chalk.green("Approved")})`
                            : pa.aspStatus === "pending"
                                ? ` (${chalk.yellow("Pending")})`
                                : "";
                        return [
                            pa.paId,
                            formatAmount(pa.value, pool.decimals, pool.symbol),
                            `${statusLabel}${aspSuffix}`,
                            `block ${pa.blockNumber.toString()} • ${formatTxHash(pa.txHash)}`,
                        ];
                    }));
                }
                process.stderr.write("\n");
            }
            if (!renderedAny) {
                process.stderr.write(opts.all
                    ? "No Pool Accounts found.\n\n"
                    : `No spendable Pool Accounts found. Deposit first, then run 'privacy-pools accounts --chain ${chainConfig.name}'.\n\n`);
            }
        }
        catch (error) {
            printError(error, isJson);
        }
    });
}
