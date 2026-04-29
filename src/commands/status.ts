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
import {
  CLIError,
  printError,
  sanitizeEndpointForDisplay,
} from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderStatus } from "../output/status.js";
import type { StatusCheckResult } from "../output/status.js";
import { createCliPackageInfoResolver } from "../package-info.js";
import {
  detectActiveRuntimeKind,
  detectNativeRuntimeAdvisory,
} from "../native-runtime-advisory.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import { probeConfigHomeWritability } from "../runtime/config-paths.js";

const resolveCliPackageInfo = createCliPackageInfoResolver(import.meta.url);

interface StatusCommandOptions {
  check?: boolean | string;
  checkAsp?: boolean;
  checkRpc?: boolean;
  checkRelayer?: boolean;
  aggregated?: boolean;
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
    if (await maybeRenderPreviewScenario("status")) {
      return;
    }

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
      relayerHost: selectedChainConfig
        ? sanitizeEndpointForDisplay(selectedChainConfig.relayerHost)
        : null,
      accountFiles: [],
      configHomeWritabilityIssue: probeConfigHomeWritability(process.env),
      nativeRuntimeAdvisory: detectNativeRuntimeAdvisory(resolveCliPackageInfo()),
      runtime: detectActiveRuntimeKind(),
    };

    // Health checks — run by default when a chain is selected.
    // --check, --check-rpc, --check-asp, and --check-relayer still work for explicit control.
    if (selectedChainConfig) {
      const checkScope = typeof opts.check === "string"
        ? opts.check.trim().toLowerCase()
        : opts.check === true
          ? "all"
          : opts.check === false
            ? "none"
            : undefined;
      if (
        checkScope &&
        checkScope !== "all" &&
        checkScope !== "rpc" &&
        checkScope !== "asp" &&
        checkScope !== "relayer" &&
        checkScope !== "none"
      ) {
        throw new CLIError(
          `Unknown --check scope: ${checkScope}.`,
          "INPUT",
          "Use one of: all, rpc, asp, relayer, none.",
        );
      }
      const explicitOpt =
        opts.check !== undefined ||
        opts.checkAsp !== undefined ||
        opts.checkRpc !== undefined ||
        opts.checkRelayer !== undefined;
      const shouldCheckAll = explicitOpt
        ? checkScope === "all"
        : true;
      const shouldCheckAsp = checkScope === "none"
        ? false
        : checkScope === "asp"
          ? true
          : shouldCheckAll || opts.checkAsp === true;
      const shouldCheckRpc = checkScope === "none"
        ? false
        : checkScope === "rpc"
          ? true
          : shouldCheckAll || opts.checkRpc === true;
      const shouldCheckRelayer = checkScope === "none"
        ? false
        : checkScope === "relayer"
          ? true
          : shouldCheckAll || opts.checkRelayer === true;

      result.healthChecksEnabled = {
        rpc: shouldCheckRpc,
        asp: shouldCheckAsp,
        relayer: shouldCheckRelayer,
      };
      const shouldShowProgress =
        !mode.isQuiet &&
        !mode.isJson &&
        !mode.isCsv &&
        (shouldCheckRpc || shouldCheckAsp || shouldCheckRelayer);

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
      const relayerCheck = shouldCheckRelayer
        ? (async () => {
            const { checkRelayerLiveness } = await import("../services/relayer.js");
            return checkRelayerLiveness(selectedChainConfig);
          })()
        : Promise.resolve<null | boolean>(null);

      const healthCheckLabel =
        shouldCheckRpc && shouldCheckAsp && shouldCheckRelayer
          ? "Checking chain health"
          : shouldCheckRelayer && !shouldCheckRpc && !shouldCheckAsp
          ? "Checking relayer health"
          : shouldCheckRpc
          ? "Checking RPC health"
          : "Checking ASP health";
      const [aspLive, rpcStatus, relayerLive] = shouldShowProgress
        ? await (async () => {
            if (
              await maybeRenderPreviewProgressStep("status.health-check", {
                spinnerText: `${healthCheckLabel}...`,
                doneText: `${healthCheckLabel} complete.`,
              })
            ) {
              return [null, null, null];
            }
            const [{ spinner }, { withSpinnerProgress }] = await Promise.all([
              import("../utils/format.js"),
              import("../utils/proof-progress.js"),
            ]);
            const spin = spinner(`${healthCheckLabel}...`, false);
            spin.start();
            try {
              return await withSpinnerProgress(spin, healthCheckLabel, () =>
                Promise.all([aspCheck, rpcCheck, relayerCheck])
              );
            } finally {
              spin.stop();
            }
          })()
        : await Promise.all([aspCheck, rpcCheck, relayerCheck]);

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

      if (relayerLive !== null) {
        result.relayerLive = relayerLive;
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

    if (opts.aggregated) {
      const { serializeErrorRecoveryTable } = await import("../utils/error-recovery-table.js");
      const { listSavedWorkflowIds, loadWorkflowSnapshot, isTerminalFlowPhase } =
        await import("../services/workflow.js");
      const { listSubmissionIds, loadSubmissionRecord } =
        await import("../services/submissions.js");
      const { loadPendingPoolAccountSummariesForStatus } =
        await import("./accounts.js");
      const workflows = listSavedWorkflowIds()
        .map((workflowId) => {
          try {
            return loadWorkflowSnapshot(workflowId);
          } catch {
            return null;
          }
        })
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> =>
          snapshot !== null && !isTerminalFlowPhase(snapshot.phase),
        );
      const submissions = listSubmissionIds()
        .map((submissionId) => {
          try {
            return loadSubmissionRecord(submissionId);
          } catch {
            return null;
          }
        })
        .filter((submission): submission is NonNullable<typeof submission> =>
          submission !== null && submission.status === "submitted",
        );
      let poolAccounts: Awaited<ReturnType<typeof loadPendingPoolAccountSummariesForStatus>> = [];
      if (selectedChainConfig && hasMnemonic) {
        try {
          poolAccounts = await loadPendingPoolAccountSummariesForStatus({
            chainConfig: selectedChainConfig,
            rpcUrl: globalOpts?.rpcUrl,
            mode,
            isVerbose,
          });
        } catch {
          poolAccounts = [];
        }
      }
      result.aggregated = {
        pending: {
          workflows,
          submissions,
          poolAccounts,
        },
        recoveryTable: serializeErrorRecoveryTable({
          chain: selectedChainConfig?.name,
        }),
        phaseGraphRef: "flow",
      };
    }

    renderStatus(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
