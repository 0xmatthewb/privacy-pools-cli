import type { Command } from "commander";
import type { Address } from "viem";
import {
  configExists,
  hasCustomRpcOverride,
  loadConfig,
  mnemonicExists,
  getRpcUrl,
  getConfigDir,
  loadSignerKey,
} from "../services/config.js";
import { CHAINS } from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { printError, sanitizeEndpointForDisplay } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderStatus } from "../output/status.js";
import type { StatusCheckResult } from "../output/status.js";
import { createCliPackageInfoResolver } from "../package-info.js";
import { detectNativeRuntimeAdvisory } from "../native-runtime-advisory.js";

const resolveCliPackageInfo = createCliPackageInfoResolver(import.meta.url);

interface StatusCommandOptions {
  check?: boolean;
  checkAsp?: boolean;
  checkRpc?: boolean;
}

export { createStatusCommand } from "../command-shells/status.js";

export async function handleStatusCommand(
  opts: StatusCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const ctx = createOutputContext(mode, isVerbose);

  try {
    const configReady = configExists();
    const config = configReady ? loadConfig() : null;
    const hasMnemonic = mnemonicExists();
    const signerKey = loadSignerKey();
    const selectedChainKey =
      globalOpts?.chain?.toLowerCase() ?? config?.defaultChain ?? null;
    const selectedChainConfig = selectedChainKey
      ? resolveChain(selectedChainKey)
      : null;

    let signerAddress: string | null = null;
    let signerKeyValid = false;
    if (signerKey) {
      try {
        const { privateKeyToAccount } = await import("viem/accounts");
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

    const rpcIsCustom = Boolean(
      selectedChainConfig
      && hasCustomRpcOverride(selectedChainConfig.id, globalOpts?.rpcUrl),
    );

    const result: StatusCheckResult = {
      configExists: configReady,
      configDir: configReady ? getConfigDir() : null,
      defaultChain: config?.defaultChain ?? null,
      selectedChain: selectedChainConfig?.name ?? null,
      rpcUrl: selectedChainConfig
        ? sanitizeEndpointForDisplay(
            getRpcUrl(selectedChainConfig.id, globalOpts?.rpcUrl),
          )
        : null,
      rpcIsCustom,
      recoveryPhraseSet: hasMnemonic,
      signerKeySet: !!signerKey,
      signerKeyValid,
      signerAddress,
      entrypoint: selectedChainConfig?.entrypoint ?? null,
      aspHost: selectedChainConfig
        ? sanitizeEndpointForDisplay(selectedChainConfig.aspHost)
        : null,
      accountFiles: [],
      nativeRuntimeAdvisory: detectNativeRuntimeAdvisory(resolveCliPackageInfo()),
    };

    // Health checks — run by default when a chain is selected.
    // --check, --check-rpc, and --check-asp still work for explicit control.
    if (selectedChainConfig) {
      const explicitOpt =
        opts.check !== undefined ||
        opts.checkAsp !== undefined ||
        opts.checkRpc !== undefined;
      const shouldCheckAll = explicitOpt ? opts.check === true : true;
      const shouldCheckAsp = shouldCheckAll || opts.checkAsp === true;
      const shouldCheckRpc = shouldCheckAll || opts.checkRpc === true;

      result.healthChecksEnabled = { rpc: shouldCheckRpc, asp: shouldCheckAsp };

      const aspCheck = shouldCheckAsp
        ? (async () => {
            const { checkLiveness } = await import("../services/asp.js");
            return checkLiveness(selectedChainConfig);
          })()
        : Promise.resolve<null | boolean>(null);
      const rpcCheck = shouldCheckRpc
        ? (async () => {
            try {
              const { getReadOnlyRpcSession } = await import("../services/sdk.js");
              const rpcSession = await getReadOnlyRpcSession(
                selectedChainConfig,
                globalOpts?.rpcUrl,
              );
              const blockNumber = await rpcSession.getLatestBlockNumber();
              let signerBalance: bigint | undefined;
              if (signerAddress) {
                try {
                  signerBalance = await rpcSession.runRead(
                    `signer-balance:${signerAddress.toLowerCase()}`,
                    () =>
                      rpcSession.publicClient.getBalance({
                        address: signerAddress as Address,
                      }),
                  );
                } catch {
                  signerBalance = undefined;
                }
              }
              return { live: true, blockNumber, signerBalance };
            } catch {
              return {
                live: false,
                blockNumber: undefined,
                signerBalance: undefined,
              };
            }
          })()
        : Promise.resolve<null | {
            live: boolean;
            blockNumber?: bigint;
            signerBalance?: bigint;
          }>(null);

      const [aspLive, rpcStatus] = await Promise.all([aspCheck, rpcCheck]);

      if (aspLive !== null) {
        result.aspLive = aspLive;
      }

      if (rpcStatus !== null) {
        result.rpcLive = rpcStatus.live;
        result.rpcBlockNumber = rpcStatus.blockNumber;
        if (rpcStatus.signerBalance !== undefined) {
          result.signerBalance = rpcStatus.signerBalance;
          result.signerBalanceDecimals =
            selectedChainConfig.chain.nativeCurrency.decimals;
          result.signerBalanceSymbol =
            selectedChainConfig.chain.nativeCurrency.symbol;
        }
      }
    }

    // Account files — only include chains where the user actually has deposits.
    // accountHasDeposits() inspects the commitments map inside the file,
    // not just file existence (the SDK creates empty files during init).
    const { accountHasDeposits } =
      await import("../services/account-storage.js");
    for (const [name, chain] of Object.entries(CHAINS)) {
      try {
        if (!accountHasDeposits(chain.id)) continue;
        result.accountFiles.push([name, chain.id]);
      } catch {
        // Keep status usable even if one chain-local cache file is corrupt.
        // Other commands can still surface the targeted repair guidance when
        // they actually need to load that account state.
      }
    }

    renderStatus(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
