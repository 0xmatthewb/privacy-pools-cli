/**
 * Output renderer for the `status` command.
 *
 * `src/commands/status.ts` delegates final output here.
 * Health-check execution and config loading remain in the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  renderNextSteps,
  printJsonSuccess,
  success,
  warn,
  info,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import { highlight, accentBold } from "../utils/theme.js";
import { CHAINS, MAINNET_CHAIN_NAMES, isTestnetChain } from "../config/chains.js";
import type {
  NextActionOptionValue,
  StatusIssue,
  StatusIssueAffect,
  StatusRecommendedMode,
} from "../types.js";

export interface StatusCheckResult {
  configExists: boolean;
  configDir: string | null;
  defaultChain: string | null;
  selectedChain: string | null;
  rpcUrl: string | null;
  rpcIsCustom: boolean;
  recoveryPhraseSet: boolean;
  signerKeySet: boolean;
  signerKeyValid: boolean;
  signerAddress: string | null;
  entrypoint: string | null;
  aspHost: string | null;
  /** Health check results (only present when checks are run). */
  aspLive?: boolean;
  rpcLive?: boolean;
  rpcBlockNumber?: bigint;
  /** Whether each health check was enabled. */
  healthChecksEnabled?: { rpc: boolean; asp: boolean };
  /**
   * Account files that exist, as [chainName, chainId] tuples.
   * Non-empty means the user has deposited before (lightweight proxy for
   * "has pool accounts" without loading full account state).
   */
  accountFiles: [string, number][];
}

interface StatusPreflightGuidance {
  recommendedMode: StatusRecommendedMode;
  blockingIssues?: StatusIssue[];
  warnings?: StatusIssue[];
}

function makeStatusIssue(
  code: string,
  message: string,
  affects: StatusIssueAffect[],
): StatusIssue {
  return { code, message, affects };
}

export function deriveStatusPreflightGuidance(
  result: StatusCheckResult,
): StatusPreflightGuidance {
  const readyForDeposit =
    result.configExists && result.recoveryPhraseSet && result.signerKeyValid;
  const readyForUnsigned = result.configExists && result.recoveryPhraseSet;
  const transactingHealthDegraded =
    result.rpcLive === false || result.aspLive === false;
  const blockingIssues: StatusIssue[] = [];
  const warnings: StatusIssue[] = [];

  if (!result.configExists) {
    blockingIssues.push(
      makeStatusIssue(
        "config_missing",
        "CLI configuration is missing. Run init before building or submitting wallet-dependent commands.",
        ["deposit", "withdraw", "unsigned"],
      ),
    );
  }

  if (!result.recoveryPhraseSet) {
    blockingIssues.push(
      makeStatusIssue(
        "recovery_phrase_missing",
        "No recovery phrase is configured. Wallet-dependent commands cannot run safely.",
        ["deposit", "withdraw", "unsigned"],
      ),
    );
  }

  if (result.configExists && result.recoveryPhraseSet && !result.signerKeySet) {
    blockingIssues.push(
      makeStatusIssue(
        "signer_key_missing",
        "No signer key is configured. Read-only commands remain safe, but deposits and withdrawals require a signer.",
        ["deposit", "withdraw"],
      ),
    );
  }

  if (result.signerKeySet && !result.signerKeyValid) {
    blockingIssues.push(
      makeStatusIssue(
        "signer_key_invalid",
        "The configured signer key is invalid. Reconfigure it before signing deposit or withdrawal transactions.",
        ["deposit", "withdraw"],
      ),
    );
  }

  if (result.rpcLive === false) {
    warnings.push(
      makeStatusIssue(
        "rpc_unreachable",
        "The configured RPC endpoint is unreachable. Read-only discovery and transaction preparation may be degraded.",
        ["deposit", "withdraw", "unsigned", "discovery"],
      ),
    );
  }

  if (result.aspLive === false) {
    warnings.push(
      makeStatusIssue(
        "asp_unreachable",
        "The ASP is unreachable. Review status, pool discovery, and private withdrawal readiness may be degraded.",
        ["deposit", "withdraw", "unsigned", "discovery"],
      ),
    );
  }

  if (
    result.configExists &&
    result.recoveryPhraseSet &&
    result.accountFiles.length === 0
  ) {
    warnings.push(
      makeStatusIssue(
        "restore_discovery_recommended",
        "If this recovery phrase was imported, check migration or website-recovery readiness across all chains before assuming the wallet is empty or fully restorable in the CLI.",
        ["discovery"],
      ),
    );
  }

  let recommendedMode: StatusRecommendedMode = "read-only";
  if (!result.configExists || !result.recoveryPhraseSet) {
    recommendedMode = "setup-required";
  } else if (transactingHealthDegraded) {
    recommendedMode = "read-only";
  } else if (readyForDeposit) {
    recommendedMode = "ready";
  } else if (readyForUnsigned) {
    recommendedMode = "unsigned-only";
  }

  return {
    recommendedMode,
    ...(blockingIssues.length > 0 ? { blockingIssues } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Render the status command output.
 */
export function renderStatus(ctx: OutputContext, result: StatusCheckResult): void {
  guardCsvUnsupported(ctx, "status");

  const readyForDeposit = result.configExists && result.recoveryPhraseSet && result.signerKeyValid;
  const readyForUnsigned = result.configExists && result.recoveryPhraseSet;
  const preflight = deriveStatusPreflightGuidance(result);
  const workflowChain = result.selectedChain ?? result.defaultChain;
  const notReady = !result.configExists || !result.recoveryPhraseSet;
  const unsignedOnly = readyForUnsigned && !readyForDeposit;
  const degradedReadOnly = preflight.recommendedMode === "read-only";
  const rpcDegraded = result.rpcLive === false;
  const aspOnlyDegraded = result.aspLive === false && !rpcDegraded;
  const chainOverridden = result.selectedChain !== null && result.selectedChain !== result.defaultChain;

  // ── Deposit reachability for next-step guidance ───────────────────────
  //
  // `hasAccountsReachable` decides whether to suggest `accounts` vs `pools`.
  // `accountsChainOpt` sets the --chain flag so the suggested command
  // actually reaches the deposits that triggered the suggestion.
  //
  // Key constraint: bare `accounts` (no --chain) shows all mainnets only.
  // Testnet deposits require an explicit --chain flag.
  const mainnetNames = new Set(MAINNET_CHAIN_NAMES);
  const hasOnSelected = result.selectedChain
    ? result.accountFiles.some(([name]) => name === result.selectedChain)
    : false;
  const hasOnMainnets = result.accountFiles.some(([name]) => mainnetNames.has(name));

  let hasAccountsReachable: boolean;
  let accountsChainOpt: string | undefined;
  let accountsNeedsAllChains = false;

  if (chainOverridden) {
    // Explicit --chain override: only the overridden chain matters.
    hasAccountsReachable = hasOnSelected;
    accountsChainOpt = result.selectedChain ?? undefined;
  } else if (hasOnSelected) {
    // Deposits on the user's default/selected chain.
    // If it's a mainnet, bare `accounts` (dashboard) includes it — no flag needed.
    // If it's a testnet AND there are also mainnet deposits, --all-chains is needed
    // so neither set is hidden. If testnet-only, --chain <testnet> suffices.
    const selectedIsMainnet = result.selectedChain ? mainnetNames.has(result.selectedChain) : false;
    hasAccountsReachable = true;
    if (selectedIsMainnet) {
      accountsChainOpt = undefined;
    } else if (hasOnMainnets) {
      // Mixed: testnet selected + mainnet deposits elsewhere → --all-chains
      accountsChainOpt = undefined;
      accountsNeedsAllChains = true;
    } else {
      // Testnet-only deposits, all on the selected chain → --chain <testnet>
      accountsChainOpt = result.selectedChain ?? undefined;
    }
  } else if (hasOnMainnets) {
    // No deposits on the selected chain, but deposits on other mainnets.
    // Bare `accounts` (dashboard) will show them.
    hasAccountsReachable = true;
    accountsChainOpt = undefined;
  } else if (result.accountFiles.length > 0) {
    // Testnet-only deposits not on the selected chain.
    // Bare `accounts` won't show them, but `accounts --all-chains` will.
    hasAccountsReachable = true;
    accountsChainOpt = undefined;
    // Signal that --all-chains is needed (handled below).
    accountsNeedsAllChains = true;
  } else {
    // Genuinely no deposits anywhere.
    hasAccountsReachable = false;
    accountsChainOpt = undefined;
  }

  // ── Build state-aware next-step guidance ──────────────────────────────
  // Six states:
  //   1. Not ready (no config or mnemonic)         → init
  //   2. Degraded health                           → pools (stay on public discovery)
  //   3. Unsigned-only, no reachable accounts      → pools (read-only)
  //   4. Unsigned-only, has reachable accounts     → accounts (read-only)
  //   5. Fully ready, no reachable accounts        → pools
  //   6. Fully ready, has reachable accounts       → accounts
  //
  // "Reachable" includes testnet-only deposits via --all-chains.
  //
  // Chain options:
  //   - `init`: uses `defaultChain` (init's flag is --default-chain, NOT --chain).
  //   - `pools`: uses `chain`; humans get --chain when overridden OR default is testnet.
  //   - `accounts`: use accountsChainOpt or --all-chains (derived above).
  const isDefaultTestnet = isTestnetChain(result.defaultChain);
  const initAgentChainOpts: Record<string, string> = workflowChain ? { defaultChain: workflowChain } : {};
  const initHumanChainOpts: Record<string, string> | undefined =
    workflowChain ? { defaultChain: workflowChain } : undefined;
  const poolsAgentChainOpts: Record<string, string> = workflowChain ? { chain: workflowChain } : {};
  const poolsHumanChainOpts: Record<string, string> | undefined =
    (chainOverridden || isDefaultTestnet) && workflowChain ? { chain: workflowChain } : undefined;
  const accountsAgentChainOpts: Record<string, NextActionOptionValue> = accountsNeedsAllChains
    ? { allChains: true }
    : accountsChainOpt
      ? { chain: accountsChainOpt }
      : {};
  const accountsHumanChainOpts: Record<string, NextActionOptionValue> | undefined = accountsNeedsAllChains
    ? { allChains: true }
    : accountsChainOpt
      ? { chain: accountsChainOpt }
      : undefined;

  let agentNextActions: ReturnType<typeof createNextAction>[];
  let humanNextActions: ReturnType<typeof createNextAction>[];
  const restoreDiscoveryAgentAction = createNextAction(
    "migrate status",
    "If this recovery phrase was imported, check migration or website-recovery readiness across all chains before assuming the wallet is empty or fully restorable in the CLI.",
    "status_restore_discovery",
    { options: { agent: true, allChains: true } },
  );
  const restoreDiscoveryHumanAction = createNextAction(
    "migrate status",
    "If this recovery phrase was imported, check migration or website-recovery readiness across all chains before assuming the wallet is empty or fully restorable in the CLI.",
    "status_restore_discovery",
    { options: { allChains: true } },
  );
  const shouldSuggestRestoreDiscovery =
    result.configExists &&
    result.recoveryPhraseSet &&
    result.accountFiles.length === 0;

  if (notReady) {
    agentNextActions = [createNextAction("init", "Complete CLI setup before transacting.", "status_not_ready",
      { options: { agent: true, showMnemonic: true, ...initAgentChainOpts } })];
    humanNextActions = [createNextAction("init", "Complete CLI setup before transacting.", "status_not_ready",
      { options: initHumanChainOpts })];
  } else if (degradedReadOnly) {
    if (aspOnlyDegraded) {
      agentNextActions = [
        createNextAction(
          "pools",
          "ASP checks are degraded. Stay on public discovery until private-review connectivity recovers.",
          "status_degraded_health",
          { options: { agent: true, ...poolsAgentChainOpts } },
        ),
        createNextAction(
          "ragequit",
          "Public recovery still works while the ASP is down when RPC is healthy, including unsigned ragequit payloads, but you must supply --asset and --from-pa.",
          "status_degraded_health",
          { options: { agent: true }, runnable: false },
        ),
        createNextAction(
          "flow ragequit",
          "Saved workflows can still use the public recovery path while the ASP is down.",
          "status_degraded_health",
          { args: ["latest"], options: { agent: true }, runnable: false },
        ),
      ];
      humanNextActions = [
        createNextAction(
          "pools",
          "ASP checks are degraded. Stay on public discovery until private-review connectivity recovers.",
          "status_degraded_health",
          { options: poolsHumanChainOpts },
        ),
      ];
    } else {
      agentNextActions = [
        createNextAction(
          "pools",
          "Connectivity checks are degraded. Stay on public pool discovery until RPC and ASP health recover.",
          "status_degraded_health",
          { options: { agent: true, ...poolsAgentChainOpts } },
        ),
      ];
      humanNextActions = [
        createNextAction(
          "pools",
          "Connectivity checks are degraded. Stay on public pool discovery until RPC and ASP health recover.",
          "status_degraded_health",
          { options: poolsHumanChainOpts },
        ),
      ];
    }
  } else if (unsignedOnly && !hasAccountsReachable) {
    agentNextActions = [
      ...(shouldSuggestRestoreDiscovery ? [restoreDiscoveryAgentAction] : []),
      createNextAction(
        "pools",
        "Browse pools in read-only mode. Configure a valid signer key before depositing.",
        "status_unsigned_no_accounts",
        { options: { agent: true, ...poolsAgentChainOpts } },
      ),
    ];
    humanNextActions = [
      ...(shouldSuggestRestoreDiscovery ? [restoreDiscoveryHumanAction] : []),
      createNextAction(
        "pools",
        "Browse pools in read-only mode. Configure a valid signer key before depositing.",
        "status_unsigned_no_accounts",
        { options: poolsHumanChainOpts }),
    ];
  } else if (unsignedOnly) {
    agentNextActions = [createNextAction(
      "accounts",
      "Review existing deposits. Configure a valid signer key before depositing or withdrawing.",
      "status_unsigned_has_accounts",
      { options: { agent: true, ...accountsAgentChainOpts } },
    )];
    humanNextActions = [createNextAction(
      "accounts",
      "Review existing deposits. Configure a valid signer key before depositing or withdrawing.",
      "status_unsigned_has_accounts",
      { options: accountsHumanChainOpts },
    )];
  } else if (!hasAccountsReachable) {
    agentNextActions = [
      ...(shouldSuggestRestoreDiscovery ? [restoreDiscoveryAgentAction] : []),
      createNextAction("pools", "Browse pools to make your first deposit.", "status_ready_no_accounts",
        { options: { agent: true, ...poolsAgentChainOpts } }),
    ];
    humanNextActions = [
      ...(shouldSuggestRestoreDiscovery ? [restoreDiscoveryHumanAction] : []),
      createNextAction("pools", "Browse pools to make your first deposit.", "status_ready_no_accounts",
        { options: poolsHumanChainOpts }),
    ];
  } else {
    agentNextActions = [
      createNextAction("accounts", "Check on your existing deposits.", "status_ready_has_accounts",
        { options: { agent: true, ...accountsAgentChainOpts } }),
    ];
    humanNextActions = [
      createNextAction("accounts", "Check on your existing deposits.", "status_ready_has_accounts",
        { options: accountsHumanChainOpts }),
    ];
  }

  if (ctx.mode.isJson) {
    const status: Record<string, unknown> = appendNextActions({
      configExists: result.configExists,
      configDir: result.configDir,
      defaultChain: result.defaultChain,
      selectedChain: result.selectedChain,
      rpcUrl: result.rpcUrl,
      rpcIsCustom: result.rpcIsCustom,
      recoveryPhraseSet: result.recoveryPhraseSet,
      signerKeySet: result.signerKeySet,
      signerKeyValid: result.signerKeyValid,
      signerAddress: result.signerAddress,
      entrypoint: result.entrypoint,
      aspHost: result.aspHost,
      accountFiles: result.accountFiles.map(([name, chainId]) => ({ chain: name, chainId })),
    }, agentNextActions) as Record<string, unknown>;
    if (result.aspLive !== undefined) status.aspLive = result.aspLive;
    if (result.rpcLive !== undefined) status.rpcLive = result.rpcLive;
    if (result.rpcBlockNumber !== undefined) status.rpcBlockNumber = result.rpcBlockNumber.toString();
    // Capability flags: indicate the wallet is *configured* for these operations,
    // NOT that withdrawable funds exist. Agents must check `accounts` to verify
    // fund availability before attempting withdrawals.
    status.readyForDeposit = readyForDeposit;
    status.readyForWithdraw = readyForDeposit;
    status.readyForUnsigned = readyForUnsigned;
    status.recommendedMode = preflight.recommendedMode;
    if (preflight.blockingIssues) status.blockingIssues = preflight.blockingIssues;
    if (preflight.warnings) status.warnings = preflight.warnings;
    printJsonSuccess(status);
    return;
  }

  const silent = isSilent(ctx);

  if (!silent) process.stderr.write(`\n${accentBold("Privacy Pools CLI Status")}\n\n`);

  // Config
  if (result.configExists) {
    success(`Config: ${result.configDir}/config.json`, silent);
  } else {
    warn("Config not found. Run 'privacy-pools init'.", silent);
  }

  // Mnemonic
  if (result.recoveryPhraseSet) {
    success("Recovery phrase: set", silent);
  } else {
    warn("Recovery phrase: not set", silent);
  }

  // Signer
  if (result.signerAddress && result.signerKeyValid) {
    success(`Signer key: ${result.signerAddress}`, silent);
  } else if (result.signerKeySet && !result.signerKeyValid) {
    warn("Signer key is set but invalid. Re-run 'privacy-pools init' to reconfigure.", silent);
  } else {
    warn("Signer key: not set", silent);
  }

  // Default chain
  const defaultChain = result.defaultChain ?? "none";
  info(`Default chain: ${defaultChain}`, silent);
  if (result.selectedChain) {
    info(`Selected chain: ${result.selectedChain}`, silent);
  }

  // Chain details
  if (result.selectedChain) {
    info(`Contract: ${result.entrypoint}`, silent);
    info(`RPC: ${result.rpcUrl}${result.rpcIsCustom ? "" : chalk.dim(" (default)")}`, silent);

    const checks = result.healthChecksEnabled;
    if (ctx.isVerbose && checks) {
      info(
        `Health checks: rpc=${checks.rpc ? "enabled" : "disabled"}, asp=${checks.asp ? "enabled" : "disabled"}`,
        silent,
      );
    }

    if (result.aspLive !== undefined) {
      if (result.aspLive) {
        success(`ASP (${result.aspHost}): healthy`, silent);
      } else {
        warn(`ASP (${result.aspHost}): unreachable`, silent);
      }
    }

    if (result.rpcLive !== undefined) {
      if (result.rpcLive) {
        success(`RPC: connected (block ${result.rpcBlockNumber})`, silent);
      } else {
        warn("RPC: unreachable", silent);
      }
    }

    if (result.aspLive === undefined && result.rpcLive === undefined) {
      info("Health checks skipped. Use --check-rpc and/or --check-asp.", silent);
    }
  }

  // Account files
  if (!silent) {
    process.stderr.write("\n");
    if (result.accountFiles.length > 0) {
      info("Account files:", silent);
      for (const [name, chainId] of result.accountFiles) {
        process.stderr.write(`  ${highlight("●")} ${name} (chain ${chainId})\n`);
      }
    } else {
      info("No account files found.", silent);
    }
    // Readiness summary — describes configuration, not fund availability.
    if (readyForDeposit) {
      success("Setup complete.", silent);
    } else if (readyForUnsigned) {
      info("Setup complete (unsigned mode only, no signer key).", silent);
    } else {
      warn("Not ready: run 'privacy-pools init' to get started.", silent);
    }
    if (aspOnlyDegraded) {
      process.stderr.write("\n");
      info(
        "ASP checks are down, so private review status may be stale. Public recovery remains available while RPC is healthy: use ragequit (or flow ragequit for saved workflows) if you already know the affected account/workflow.",
        silent,
      );
    }
  }
  renderNextSteps(ctx, humanNextActions);
}
