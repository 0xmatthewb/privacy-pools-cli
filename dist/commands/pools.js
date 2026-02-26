import { Command } from "commander";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { listPools } from "../services/pools.js";
import { printTable, spinner, formatAddress, formatAmount, formatBPS } from "../utils/format.js";
import { printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";
export function createPoolsCommand() {
    return new Command("pools")
        .description("List available pools and assets")
        .addHelpText("after", "\nExamples:\n  privacy-pools pools\n  privacy-pools pools --chain sepolia\n  privacy-pools pools --json --chain ethereum\n"
        + commandHelpText({
            jsonFields: "{ chain, pools: [{ symbol, asset, pool, scope, ... }] }",
        }))
        .action(async (_opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const silent = isQuiet || isJson;
        try {
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            const spin = spinner(`Fetching pools for ${chainConfig.name}...`, silent);
            spin.start();
            const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
            spin.stop();
            if (pools.length === 0) {
                if (isJson) {
                    printJsonSuccess({ chain: chainConfig.name, pools: [] });
                }
                else {
                    process.stderr.write(`No pools found on ${chainConfig.name}.\n`);
                }
                return;
            }
            if (isJson) {
                printJsonSuccess({
                    chain: chainConfig.name,
                    pools: pools.map((p) => ({
                        symbol: p.symbol,
                        asset: p.asset,
                        pool: p.pool,
                        scope: p.scope.toString(),
                        minimumDeposit: p.minimumDepositAmount.toString(),
                        vettingFeeBPS: p.vettingFeeBPS.toString(),
                        maxRelayFeeBPS: p.maxRelayFeeBPS.toString(),
                    })),
                });
                return;
            }
            process.stderr.write(`\nPools on ${chainConfig.name}:\n\n`);
            printTable(["Asset", "Address", "Pool", "Min Deposit", "Vetting Fee", "Max Relay Fee"], pools.map((p) => [
                p.symbol,
                formatAddress(p.asset),
                formatAddress(p.pool),
                formatAmount(p.minimumDepositAmount, p.decimals, p.symbol),
                formatBPS(p.vettingFeeBPS),
                formatBPS(p.maxRelayFeeBPS),
            ]));
        }
        catch (error) {
            printError(error, isJson);
        }
    });
}
