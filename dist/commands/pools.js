import { Command } from "commander";
import chalk from "chalk";
import { CHAINS, CHAIN_NAMES } from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { listPools } from "../services/pools.js";
import { printTable, spinner, formatAddress, formatAmount, formatBPS } from "../utils/format.js";
import { CLIError, classifyError, printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";
const SUPPORTED_SORT_MODES = [
    "default",
    "asset-asc",
    "asset-desc",
    "tvl-desc",
    "tvl-asc",
    "deposits-desc",
    "deposits-asc",
    "chain-asset",
];
function formatStatAmount(value, decimals, symbol) {
    if (value === undefined)
        return "-";
    return formatAmount(value, decimals, symbol);
}
function formatDepositsSummary(pool) {
    const count = pool.totalDepositsCount !== undefined
        ? pool.totalDepositsCount.toLocaleString("en-US")
        : null;
    const value = pool.totalDepositsValue !== undefined
        ? formatAmount(pool.totalDepositsValue, pool.decimals, pool.symbol)
        : null;
    if (count && value)
        return `${count} (${value})`;
    return count ?? value ?? "-";
}
function poolToJson(pool, chain) {
    const payload = {
        symbol: pool.symbol,
        asset: pool.asset,
        pool: pool.pool,
        scope: pool.scope.toString(),
        minimumDeposit: pool.minimumDepositAmount.toString(),
        vettingFeeBPS: pool.vettingFeeBPS.toString(),
        maxRelayFeeBPS: pool.maxRelayFeeBPS.toString(),
        totalInPoolValue: pool.totalInPoolValue?.toString() ?? null,
        totalInPoolValueUsd: pool.totalInPoolValueUsd ?? null,
        totalDepositsValue: pool.totalDepositsValue?.toString() ?? null,
        totalDepositsValueUsd: pool.totalDepositsValueUsd ?? null,
        acceptedDepositsValue: pool.acceptedDepositsValue?.toString() ?? null,
        acceptedDepositsValueUsd: pool.acceptedDepositsValueUsd ?? null,
        pendingDepositsValue: pool.pendingDepositsValue?.toString() ?? null,
        pendingDepositsValueUsd: pool.pendingDepositsValueUsd ?? null,
        totalDepositsCount: pool.totalDepositsCount ?? null,
        acceptedDepositsCount: pool.acceptedDepositsCount ?? null,
        pendingDepositsCount: pool.pendingDepositsCount ?? null,
        growth24h: pool.growth24h ?? null,
        pendingGrowth24h: pool.pendingGrowth24h ?? null,
    };
    if (chain)
        payload.chain = chain;
    return payload;
}
function parseSortMode(raw) {
    const normalized = raw?.trim().toLowerCase() ?? "default";
    if (SUPPORTED_SORT_MODES.includes(normalized)) {
        return normalized;
    }
    throw new CLIError(`Invalid --sort value: ${raw}.`, "INPUT", `Use one of: ${SUPPORTED_SORT_MODES.join(", ")}.`);
}
function poolFundsMetric(pool) {
    return pool.acceptedDepositsValue ?? pool.totalInPoolValue ?? 0n;
}
function poolDepositsMetric(pool) {
    return pool.totalDepositsCount ?? 0;
}
function withChainMeta(chainConfig, pools) {
    return pools.map((pool) => ({
        chain: chainConfig.name,
        chainId: chainConfig.id,
        pool,
    }));
}
function applySearch(pools, query) {
    const terms = (query ?? "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    if (terms.length === 0)
        return pools;
    return pools.filter((entry) => {
        const haystack = [
            entry.chain,
            entry.chainId.toString(),
            entry.pool.symbol,
            entry.pool.asset,
            entry.pool.pool,
            entry.pool.scope.toString(),
        ]
            .join(" ")
            .toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
}
function sortPools(pools, mode) {
    if (mode === "default")
        return pools;
    const sorted = [...pools];
    sorted.sort((left, right) => {
        let diff = 0;
        switch (mode) {
            case "asset-asc":
                diff = left.pool.symbol.localeCompare(right.pool.symbol);
                break;
            case "asset-desc":
                diff = right.pool.symbol.localeCompare(left.pool.symbol);
                break;
            case "tvl-desc": {
                const l = poolFundsMetric(left.pool);
                const r = poolFundsMetric(right.pool);
                diff = l === r ? 0 : l > r ? -1 : 1;
                break;
            }
            case "tvl-asc": {
                const l = poolFundsMetric(left.pool);
                const r = poolFundsMetric(right.pool);
                diff = l === r ? 0 : l < r ? -1 : 1;
                break;
            }
            case "deposits-desc":
                diff = poolDepositsMetric(right.pool) - poolDepositsMetric(left.pool);
                break;
            case "deposits-asc":
                diff = poolDepositsMetric(left.pool) - poolDepositsMetric(right.pool);
                break;
            case "chain-asset": {
                diff = left.chain.localeCompare(right.chain);
                if (diff === 0)
                    diff = left.pool.symbol.localeCompare(right.pool.symbol);
                break;
            }
            default:
                diff = 0;
        }
        if (diff !== 0)
            return diff;
        const byChain = left.chain.localeCompare(right.chain);
        if (byChain !== 0)
            return byChain;
        const bySymbol = left.pool.symbol.localeCompare(right.pool.symbol);
        if (bySymbol !== 0)
            return bySymbol;
        return left.pool.pool.localeCompare(right.pool.pool);
    });
    return sorted;
}
export function createPoolsCommand() {
    return new Command("pools")
        .description("List available pools and assets")
        .option("--all-chains", "List pools across all supported chains")
        .option("--search <query>", "Filter by chain/symbol/address/scope")
        .option("--sort <mode>", `Sort mode (${SUPPORTED_SORT_MODES.join(", ")})`, "default")
        .addHelpText("after", "\nExamples:\n  privacy-pools pools\n  privacy-pools pools --chain sepolia\n  privacy-pools pools --all-chains --sort tvl-desc\n  privacy-pools pools --search usdc --sort asset-asc\n  privacy-pools pools --json --chain ethereum\n"
        + commandHelpText({
            jsonFields: "{ chain|allChains, search, sort, pools: [{ chain?, symbol, asset, pool, scope, totalDepositsCount, totalDepositsValue, acceptedDepositsValue, pendingDepositsValue, ... }], warnings? }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const silent = isQuiet || isJson;
        try {
            if (opts.allChains && globalOpts?.rpcUrl) {
                throw new CLIError("--rpc-url cannot be combined with --all-chains.", "INPUT", "Use per-chain RPC overrides via 'privacy-pools init', or run a single-chain query.");
            }
            const config = loadConfig();
            const sortMode = parseSortMode(opts.sort);
            const searchQuery = opts.search?.trim();
            const chainsToQuery = opts.allChains
                ? CHAIN_NAMES.map((name) => CHAINS[name])
                : [resolveChain(globalOpts?.chain, config.defaultChain)];
            const spin = spinner(opts.allChains
                ? "Fetching pools across chains..."
                : `Fetching pools for ${chainsToQuery[0].name}...`, silent);
            spin.start();
            const chainResults = await Promise.all(chainsToQuery.map(async (chainConfig) => {
                try {
                    const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
                    return { chainConfig, pools };
                }
                catch (error) {
                    return { chainConfig, pools: [], error };
                }
            }));
            spin.stop();
            const warnings = chainResults
                .filter((result) => result.error !== undefined)
                .map((result) => {
                const classified = classifyError(result.error);
                return {
                    chain: result.chainConfig.name,
                    category: classified.category,
                    message: classified.message,
                };
            });
            const rawPools = chainResults.flatMap((result) => withChainMeta(result.chainConfig, result.pools));
            if (rawPools.length === 0) {
                const firstFailure = chainResults.find((result) => result.error !== undefined);
                if (firstFailure?.error !== undefined) {
                    throw firstFailure.error;
                }
                if (isJson) {
                    if (opts.allChains) {
                        printJsonSuccess({ allChains: true, search: searchQuery ?? null, sort: sortMode, pools: [] });
                    }
                    else {
                        printJsonSuccess({ chain: chainsToQuery[0].name, search: searchQuery ?? null, sort: sortMode, pools: [] });
                    }
                }
                else {
                    if (opts.allChains) {
                        process.stderr.write("No pools found across supported chains.\n");
                    }
                    else {
                        process.stderr.write(`No pools found on ${chainsToQuery[0].name}.\n`);
                    }
                }
                return;
            }
            const filteredPools = sortPools(applySearch(rawPools, searchQuery), sortMode);
            if (isJson) {
                if (opts.allChains) {
                    printJsonSuccess({
                        allChains: true,
                        search: searchQuery ?? null,
                        sort: sortMode,
                        chains: chainResults.map((result) => ({
                            chain: result.chainConfig.name,
                            pools: result.pools.length,
                            error: result.error ? classifyError(result.error).message : null,
                        })),
                        pools: filteredPools.map((entry) => poolToJson(entry.pool, entry.chain)),
                        warnings: warnings.length > 0 ? warnings : undefined,
                    });
                }
                else {
                    printJsonSuccess({
                        chain: chainsToQuery[0].name,
                        search: searchQuery ?? null,
                        sort: sortMode,
                        pools: filteredPools.map((entry) => poolToJson(entry.pool)),
                    });
                }
                return;
            }
            if (opts.allChains) {
                process.stderr.write("\nPools across supported chains:\n\n");
            }
            else {
                process.stderr.write(`\nPools on ${chainsToQuery[0].name}:\n\n`);
            }
            if (warnings.length > 0) {
                for (const warning of warnings) {
                    process.stderr.write(chalk.yellow(`Warning (${warning.chain}, ${warning.category}): ${warning.message}\n`));
                }
                process.stderr.write("\n");
            }
            if (filteredPools.length === 0) {
                if (searchQuery && searchQuery.length > 0) {
                    process.stderr.write(`No pools matched search query "${searchQuery}".\n`);
                }
                else {
                    process.stderr.write("No pools found.\n");
                }
                return;
            }
            printTable(opts.allChains
                ? ["Chain", "Asset", "Address", "Pool", "Accepted Funds", "Pending Funds", "Total Deposits", "Min Deposit", "Vetting Fee", "Max Relay Fee"]
                : ["Asset", "Address", "Pool", "Accepted Funds", "Pending Funds", "Total Deposits", "Min Deposit", "Vetting Fee", "Max Relay Fee"], filteredPools.map(({ chain, pool }) => {
                const baseRow = [
                    pool.symbol,
                    formatAddress(pool.asset),
                    formatAddress(pool.pool),
                    formatStatAmount(pool.acceptedDepositsValue ?? pool.totalInPoolValue, pool.decimals, pool.symbol),
                    formatStatAmount(pool.pendingDepositsValue, pool.decimals, pool.symbol),
                    formatDepositsSummary(pool),
                    formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol),
                    formatBPS(pool.vettingFeeBPS),
                    formatBPS(pool.maxRelayFeeBPS),
                ];
                return opts.allChains ? [chain, ...baseRow] : baseRow;
            }));
            process.stderr.write(chalk.dim("\nAccepted/Pending funds and deposit counts come from ASP pool statistics. Vetting fees are deducted on deposit. Relay fees apply to relayed withdrawals.\n"));
        }
        catch (error) {
            printError(error, isJson);
        }
    });
}
