import { Command } from "commander";
import chalk from "chalk";
import { configExists, loadConfig, mnemonicExists, getRpcUrl, getConfigDir, loadSignerKey, } from "../services/config.js";
import { CHAINS } from "../config/chains.js";
import { checkLiveness } from "../services/asp.js";
import { getPublicClient } from "../services/sdk.js";
import { accountExists } from "../services/account.js";
import { success, warn, info } from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { privateKeyToAccount } from "viem/accounts";
import { resolveGlobalMode } from "../utils/mode.js";
export function createStatusCommand() {
    return new Command("status")
        .description("Show configuration and connection status")
        .option("--check-rpc", "Actively test RPC connectivity")
        .option("--check-asp", "Actively test ASP liveness")
        .addHelpText("after", "\nExamples:\n  privacy-pools status\n  privacy-pools status --check-rpc --check-asp\n  privacy-pools status --json --check-rpc\n  privacy-pools status --chain sepolia --rpc-url https://...\n"
        + commandHelpText({
            jsonFields: "{ configExists, defaultChain, selectedChain, rpcUrl, mnemonicSet, signerKeySet, signerAddress, aspLive?, rpcLive? }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const silent = isQuiet || isJson;
        const isVerbose = globalOpts?.verbose ?? false;
        try {
            const configReady = configExists();
            const config = configReady ? loadConfig() : null;
            const hasMnemonic = mnemonicExists();
            const signerKey = loadSignerKey();
            const selectedChainKey = globalOpts?.chain?.toLowerCase() ?? config?.defaultChain ?? null;
            if (globalOpts?.chain && (!selectedChainKey || !CHAINS[selectedChainKey])) {
                throw new CLIError(`Unknown chain: ${globalOpts.chain}`, "INPUT");
            }
            const selectedChainConfig = selectedChainKey
                ? CHAINS[selectedChainKey]
                : null;
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
                const resolvedRpcUrl = selectedChainConfig
                    ? getRpcUrl(selectedChainConfig.id, globalOpts?.rpcUrl)
                    : null;
                const status = {
                    configExists: configReady,
                    defaultChain: config?.defaultChain ?? null,
                    selectedChain: selectedChainConfig?.name ?? null,
                    rpcUrl: resolvedRpcUrl,
                    mnemonicSet: hasMnemonic,
                    signerKeySet: !!signerKey,
                    signerKeyValid,
                    signerAddress,
                };
                // Optional health checks
                if (selectedChainConfig) {
                    const shouldCheckAsp = opts.checkAsp === true;
                    const shouldCheckRpc = opts.checkRpc === true;
                    if (shouldCheckAsp) {
                        status.aspLive = await checkLiveness(selectedChainConfig);
                    }
                    if (shouldCheckRpc) {
                        try {
                            const client = getPublicClient(selectedChainConfig, globalOpts?.rpcUrl);
                            await client.getBlockNumber();
                            status.rpcLive = true;
                        }
                        catch {
                            status.rpcLive = false;
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
            if (selectedChainConfig) {
                info(`Selected chain: ${selectedChainConfig.name}`, silent);
            }
            // Chain details
            if (selectedChainConfig) {
                info(`Entrypoint: ${selectedChainConfig.entrypoint}`, silent);
                info(`RPC: ${getRpcUrl(selectedChainConfig.id, globalOpts?.rpcUrl)}`, silent);
                const shouldCheckAsp = opts.checkAsp === true;
                const shouldCheckRpc = opts.checkRpc === true;
                if (isVerbose) {
                    info(`Health checks: rpc=${shouldCheckRpc ? "enabled" : "disabled"}, asp=${shouldCheckAsp ? "enabled" : "disabled"}`, silent);
                }
                if (shouldCheckAsp) {
                    const aspLive = await checkLiveness(selectedChainConfig);
                    if (aspLive) {
                        success(`ASP (${selectedChainConfig.aspHost}): healthy`, silent);
                    }
                    else {
                        warn(`ASP (${selectedChainConfig.aspHost}): unreachable`, silent);
                    }
                }
                if (shouldCheckRpc) {
                    try {
                        const client = getPublicClient(selectedChainConfig, globalOpts?.rpcUrl);
                        const blockNumber = await client.getBlockNumber();
                        success(`RPC: connected (block ${blockNumber})`, silent);
                    }
                    catch {
                        warn("RPC: unreachable", silent);
                    }
                }
                if (!shouldCheckAsp && !shouldCheckRpc) {
                    info("Health checks skipped. Use --check-rpc and/or --check-asp.", silent);
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
