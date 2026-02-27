import { Command } from "commander";
import { configExists, loadConfig, mnemonicExists, getRpcUrl, getConfigDir, loadSignerKey, } from "../services/config.js";
import { CHAINS } from "../config/chains.js";
import { checkLiveness } from "../services/asp.js";
import { getPublicClient } from "../services/sdk.js";
import { accountExists } from "../services/account.js";
import { printError, CLIError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { privateKeyToAccount } from "viem/accounts";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderStatus } from "../output/status.js";
export function createStatusCommand() {
    return new Command("status")
        .description("Show configuration and connection status")
        .option("--check", "Run both RPC and ASP health checks")
        .option("--check-rpc", "Actively test RPC connectivity")
        .option("--check-asp", "Actively test ASP liveness")
        .addHelpText("after", "\nExamples:\n  privacy-pools status\n  privacy-pools status --check\n  privacy-pools status --check-rpc --check-asp\n  privacy-pools status --json --check-rpc\n  privacy-pools status --chain sepolia --rpc-url https://...\n"
        + commandHelpText({
            jsonFields: "{ configExists, defaultChain, selectedChain, rpcUrl, mnemonicSet, signerKeySet, signerAddress, aspLive?, rpcLive? }",
        }))
        .action(async (opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isVerbose = globalOpts?.verbose ?? false;
        const ctx = createOutputContext(mode, isVerbose);
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
            const result = {
                configExists: configReady,
                configDir: configReady ? getConfigDir() : null,
                defaultChain: config?.defaultChain ?? null,
                selectedChain: selectedChainConfig?.name ?? null,
                rpcUrl: selectedChainConfig
                    ? getRpcUrl(selectedChainConfig.id, globalOpts?.rpcUrl)
                    : null,
                mnemonicSet: hasMnemonic,
                signerKeySet: !!signerKey,
                signerKeyValid,
                signerAddress,
                entrypoint: selectedChainConfig?.entrypoint ?? null,
                aspHost: selectedChainConfig?.aspHost ?? null,
                accountFiles: [],
            };
            // Health checks
            if (selectedChainConfig) {
                const shouldCheckAll = opts.check === true;
                const shouldCheckAsp = shouldCheckAll || opts.checkAsp === true;
                const shouldCheckRpc = shouldCheckAll || opts.checkRpc === true;
                result.healthChecksEnabled = { rpc: shouldCheckRpc, asp: shouldCheckAsp };
                if (shouldCheckAsp) {
                    result.aspLive = await checkLiveness(selectedChainConfig);
                }
                if (shouldCheckRpc) {
                    try {
                        const client = getPublicClient(selectedChainConfig, globalOpts?.rpcUrl);
                        const blockNumber = await client.getBlockNumber();
                        result.rpcLive = true;
                        result.rpcBlockNumber = blockNumber;
                    }
                    catch {
                        result.rpcLive = false;
                    }
                }
            }
            // Account files
            for (const [name, chain] of Object.entries(CHAINS)) {
                if (accountExists(chain.id)) {
                    result.accountFiles.push([name, chain.id]);
                }
            }
            renderStatus(ctx, result);
        }
        catch (error) {
            printError(error, mode.isJson);
        }
    });
}
