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

/**
 * Render the status command output.
 */
export function renderStatus(ctx: OutputContext, result: StatusCheckResult): void {
  guardCsvUnsupported(ctx, "status");

  const readyForDeposit = result.configExists && result.recoveryPhraseSet && result.signerKeyValid;
  const readyForUnsigned = result.configExists && result.recoveryPhraseSet;
  const workflowChain = result.selectedChain ?? result.defaultChain;
  const notReady = !result.configExists || !result.recoveryPhraseSet;
  const unsignedOnly = readyForUnsigned && !readyForDeposit;
  // When a specific chain is selected, only consider accounts on that chain
  // for next-step guidance — suggesting `accounts` when the user has deposits
  // on a different chain is misleading.
  const hasAccountsOnChain = result.selectedChain
    ? result.accountFiles.some(([name]) => name === result.selectedChain)
    : result.accountFiles.length > 0;
  const chainOverridden = result.selectedChain !== null && result.selectedChain !== result.defaultChain;

  // ── Build state-aware next-step guidance ──────────────────────────────
  // Five states:
  //   1. Not ready (no config or mnemonic)        → init
  //   2. Unsigned-only, no accounts on chain       → pools (read-only)
  //   3. Unsigned-only, has accounts on chain      → accounts (read-only)
  //   4. Fully ready, no accounts on chain         → pools
  //   5. Fully ready, has accounts on chain        → accounts
  const agentChainOpts: Record<string, string> = workflowChain ? { chain: workflowChain } : {};
  const humanChainOpts: Record<string, string> | undefined =
    chainOverridden && workflowChain ? { chain: workflowChain } : undefined;

  let agentNextActions: ReturnType<typeof createNextAction>[];
  let humanNextActions: ReturnType<typeof createNextAction>[];

  if (notReady) {
    agentNextActions = [createNextAction("init", "Complete CLI setup before transacting.", "status_not_ready",
      { options: { agent: true, showMnemonic: true, ...agentChainOpts } })];
    humanNextActions = [createNextAction("init", "Complete CLI setup before transacting.", "status_not_ready",
      { options: humanChainOpts })];
  } else if (unsignedOnly && !hasAccountsOnChain) {
    agentNextActions = [createNextAction(
      "pools",
      "Browse pools in read-only mode. Configure a valid signer key before depositing.",
      "status_unsigned_no_accounts",
      { options: { agent: true, ...agentChainOpts } },
    )];
    humanNextActions = [createNextAction(
      "pools",
      "Browse pools in read-only mode. Configure a valid signer key before depositing.",
      "status_unsigned_no_accounts",
      { options: humanChainOpts }),
    ];
  } else if (unsignedOnly) {
    agentNextActions = [createNextAction(
      "accounts",
      "Review existing deposits. Configure a valid signer key before depositing or withdrawing.",
      "status_unsigned_has_accounts",
      { options: { agent: true, ...agentChainOpts } },
    )];
    humanNextActions = [createNextAction(
      "accounts",
      "Review existing deposits. Configure a valid signer key before depositing or withdrawing.",
      "status_unsigned_has_accounts",
      { options: humanChainOpts },
    )];
  } else if (!hasAccountsOnChain) {
    agentNextActions = [createNextAction("pools", "Browse pools to make your first deposit.", "status_ready_no_accounts",
      { options: { agent: true, ...agentChainOpts } })];
    humanNextActions = [createNextAction("pools", "Browse pools to make your first deposit.", "status_ready_no_accounts",
      { options: humanChainOpts })];
  } else {
    agentNextActions = [
      createNextAction("accounts", "Check on your existing deposits.", "status_ready_has_accounts",
        { options: { agent: true, ...agentChainOpts } }),
    ];
    humanNextActions = [
      createNextAction("accounts", "Check on your existing deposits.", "status_ready_has_accounts",
        { options: humanChainOpts }),
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
    // NOT that spendable funds exist. Agents must check `accounts` to verify
    // fund availability before attempting withdrawals.
    status.readyForDeposit = readyForDeposit;
    status.readyForWithdraw = readyForDeposit;
    status.readyForUnsigned = readyForUnsigned;
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
      info("Setup complete (unsigned mode only — no signer key).", silent);
    } else {
      warn("Not ready: run 'privacy-pools init' to get started.", silent);
    }
  }
  renderNextSteps(ctx, humanNextActions);
}
