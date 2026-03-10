import { Command } from "commander";
import {
  configExists,
  loadConfig,
  mnemonicExists,
  getRpcUrl,
  resolveRpcEnvVar,
  getConfigDir,
  loadSignerKey,
} from "../services/config.js";
import { CHAINS } from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { checkLiveness } from "../services/asp.js";
import { getPublicClient } from "../services/sdk.js";
import { accountExists } from "../services/account.js";
import { printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import type { GlobalOptions } from "../types.js";
import { privateKeyToAccount } from "viem/accounts";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderStatus } from "../output/status.js";
import type { StatusCheckResult } from "../output/status.js";

export function createStatusCommand(): Command {
  const metadata = getCommandMetadata("status");
  return new Command("status")
    .description(metadata.description)
    .option("--check", "Run both RPC and ASP health checks")
    .option("--no-check", "Suppress default health checks")
    .option("--check-rpc", "Actively test RPC connectivity")
    .option("--check-asp", "Actively test ASP liveness")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isVerbose = globalOpts?.verbose ?? false;
      const ctx = createOutputContext(mode, isVerbose);

      try {
        const configReady = configExists();
        const config = configReady ? loadConfig() : null;
        const hasMnemonic = mnemonicExists();
        const signerKey = loadSignerKey();
        const selectedChainKey = globalOpts?.chain?.toLowerCase() ?? config?.defaultChain ?? null;
        const selectedChainConfig = selectedChainKey
          ? resolveChain(selectedChainKey)
          : null;

        let signerAddress: string | null = null;
        let signerKeyValid = false;
        if (signerKey) {
          try {
            const normalized = (
              signerKey.startsWith("0x") ? signerKey : `0x${signerKey}`
            ) as `0x${string}`;
            signerAddress = privateKeyToAccount(normalized).address;
            signerKeyValid = true;
          } catch {
            signerAddress = null;
            signerKeyValid = false;
          }
        }

        const rpcIsCustom = !!(
          globalOpts?.rpcUrl ||
          (selectedChainConfig && resolveRpcEnvVar(selectedChainConfig.id)) ||
          (selectedChainConfig && config?.rpcOverrides?.[selectedChainConfig.id])
        );

        const result: StatusCheckResult = {
          configExists: configReady,
          configDir: configReady ? getConfigDir() : null,
          defaultChain: config?.defaultChain ?? null,
          selectedChain: selectedChainConfig?.name ?? null,
          rpcUrl: selectedChainConfig
            ? getRpcUrl(selectedChainConfig.id, globalOpts?.rpcUrl)
            : null,
          rpcIsCustom,
          recoveryPhraseSet: hasMnemonic,
          signerKeySet: !!signerKey,
          signerKeyValid,
          signerAddress,
          entrypoint: selectedChainConfig?.entrypoint ?? null,
          aspHost: selectedChainConfig?.aspHost ?? null,
          accountFiles: [],
        };

        // Health checks — run by default when a chain is selected.
        // --check, --check-rpc, and --check-asp still work for explicit control.
        if (selectedChainConfig) {
          const explicitOpt = opts.check !== undefined || opts.checkAsp !== undefined || opts.checkRpc !== undefined;
          const shouldCheckAll = explicitOpt ? opts.check === true : true;
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
            } catch {
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
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
