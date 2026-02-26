import { Command } from "commander";
import chalk from "chalk";
import { configExists, loadConfig, mnemonicExists, getRpcUrl, getConfigDir, } from "../services/config.js";
import { loadSignerKey } from "../services/config.js";
import { CHAINS } from "../config/chains.js";
import { checkLiveness } from "../services/asp.js";
import { getPublicClient } from "../services/sdk.js";
import { accountExists } from "../services/account.js";
import { success, warn, info } from "../utils/format.js";
import { printError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { privateKeyToAccount } from "viem/accounts";
export function createStatusCommand() {
    return new Command("status")
        .description("Show configuration and connection status")
        .option("--check-rpc", "Actively test RPC connectivity")
        .option("--check-asp", "Actively test ASP liveness")
        .addHelpText("after", "\nExamples:\n  privacy-pools status\n  privacy-pools status --check-rpc --check-asp\n  privacy-pools status --json --check-rpc\n  privacy-pools status --chain sepolia --rpc-url https://...\n"
        + commandHelpText({
            jsonFields: "{ configExists, defaultChain, mnemonicSet, signerKeySet, signerAddress }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const isJson = globalOpts?.json ?? false;
        const isQuiet = globalOpts?.quiet ?? false;
        const silent = isQuiet || isJson;
        const isVerbose = globalOpts?.verbose ?? false;
        try {
            const configReady = configExists();
            const config = configReady ? loadConfig() : null;
            const hasMnemonic = mnemonicExists();
            const signerKey = loadSignerKey();
            let signerAddress = null;
            let signerKeyValid = false;
            if (signerKey) {
                try {
                    const normalized = (signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`);
                    signerAddress = privateKeyToAccount(normalized).address;
                    signerKeyValid = true;
                }
                catch {
                    signerAddress = null;
                    signerKeyValid = false;
                }
            }
            if (isJson) {
                const status = {
                    configExists: configReady,
                    defaultChain: config?.defaultChain ?? null,
                    mnemonicSet: hasMnemonic,
                    signerKeySet: !!signerKey,
                    signerKeyValid,
                    signerAddress,
                };
                // Check ASP liveness for default chain
                if (config?.defaultChain) {
                    const chainConfig = CHAINS[config.defaultChain];
                    if (chainConfig) {
                        const shouldCheckAsp = opts.checkAsp || (!opts.checkAsp && !opts.checkRpc);
                        const shouldCheckRpc = opts.checkRpc || (!opts.checkAsp && !opts.checkRpc);
                        if (shouldCheckAsp) {
                            status.aspLive = await checkLiveness(chainConfig);
                        }
                        if (shouldCheckRpc) {
                            try {
                                const client = getPublicClient(chainConfig, globalOpts?.rpcUrl);
                                await client.getBlockNumber();
                                status.rpcLive = true;
                            }
                            catch {
                                status.rpcLive = false;
                            }
                        }
                    }
                }
                printJsonSuccess(status);
                return;
            }
            process.stderr.write(chalk.bold("\nPrivacy Pools CLI Status\n") + "\n");
            // Config
            if (configReady) {
                success(`Config: ${getConfigDir()}/config.json`, silent);
            }
            else {
                warn("Config not found. Run 'privacy-pools init'.", silent);
            }
            // Mnemonic
            if (hasMnemonic) {
                success("Mnemonic: set", silent);
            }
            else {
                warn("Mnemonic: not set", silent);
            }
            // Signer
            if (signerAddress && signerKeyValid) {
                success(`Signer: ${signerAddress}`, silent);
            }
            else if (signerKey && !signerKeyValid) {
                warn("Signer key is set but invalid. Re-run 'privacy-pools init --private-key ...'.", silent);
            }
            else {
                warn("Signer: not set", silent);
            }
            // Default chain
            const defaultChain = config?.defaultChain ?? "none";
            info(`Default chain: ${defaultChain}`, silent);
            // Chain details
            if (config?.defaultChain) {
                const chainConfig = CHAINS[config.defaultChain];
                if (chainConfig) {
                    info(`Entrypoint: ${chainConfig.entrypoint}`, silent);
                    info(`RPC: ${getRpcUrl(chainConfig.id, globalOpts?.rpcUrl)}`, silent);
                    const shouldCheckAsp = opts.checkAsp || (!opts.checkAsp && !opts.checkRpc);
                    const shouldCheckRpc = opts.checkRpc || (!opts.checkAsp && !opts.checkRpc);
                    if (isVerbose) {
                        info(`Health checks: rpc=${shouldCheckRpc ? "enabled" : "disabled"}, asp=${shouldCheckAsp ? "enabled" : "disabled"}`, silent);
                    }
                    if (shouldCheckAsp) {
                        const aspLive = await checkLiveness(chainConfig);
                        if (aspLive) {
                            success(`ASP (${chainConfig.aspHost}): healthy`, silent);
                        }
                        else {
                            warn(`ASP (${chainConfig.aspHost}): unreachable`, silent);
                        }
                    }
                    if (shouldCheckRpc) {
                        try {
                            const client = getPublicClient(chainConfig, globalOpts?.rpcUrl);
                            const blockNumber = await client.getBlockNumber();
                            success(`RPC: connected (block ${blockNumber})`, silent);
                        }
                        catch {
                            warn("RPC: unreachable", silent);
                        }
                    }
                }
            }
            // Account files
            process.stderr.write("\n");
            info("Account files:", silent);
            for (const [name, chain] of Object.entries(CHAINS)) {
                const exists = accountExists(chain.id);
                if (exists) {
                    process.stderr.write(`  ${chalk.green("●")} ${name} (chain ${chain.id})\n`);
                }
            }
            process.stderr.write("\n");
        }
        catch (error) {
            printError(error, isJson);
        }
    });
}
