/**
 * Output renderer for the `status` command.
 *
 * `src/commands/status.ts` delegates final output here.
 * Health-check execution and config loading remain in the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { printJsonSuccess, success, warn, info, isSilent } from "./common.js";

export interface StatusCheckResult {
  configExists: boolean;
  configDir: string | null;
  defaultChain: string | null;
  selectedChain: string | null;
  rpcUrl: string | null;
  rpcIsCustom: boolean;
  mnemonicSet: boolean;
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
  /** Account files that exist, as [chainName, chainId] tuples. */
  accountFiles: [string, number][];
}

/**
 * Render the status command output.
 */
export function renderStatus(ctx: OutputContext, result: StatusCheckResult): void {
  if (ctx.mode.isJson) {
    const status: Record<string, unknown> = {
      configExists: result.configExists,
      configDir: result.configDir,
      defaultChain: result.defaultChain,
      selectedChain: result.selectedChain,
      rpcUrl: result.rpcUrl,
      rpcIsCustom: result.rpcIsCustom,
      mnemonicSet: result.mnemonicSet,
      signerKeySet: result.signerKeySet,
      signerKeyValid: result.signerKeyValid,
      signerAddress: result.signerAddress,
      entrypoint: result.entrypoint,
      aspHost: result.aspHost,
      accountFiles: result.accountFiles.map(([name, chainId]) => ({ chain: name, chainId })),
    };
    if (result.aspLive !== undefined) status.aspLive = result.aspLive;
    if (result.rpcLive !== undefined) status.rpcLive = result.rpcLive;
    if (result.rpcBlockNumber !== undefined) status.rpcBlockNumber = result.rpcBlockNumber.toString();
    // Convenience fields for agents: can I transact right now?
    status.readyForDeposit = result.configExists && result.mnemonicSet && result.signerKeyValid;
    status.readyForWithdraw = result.configExists && result.mnemonicSet && result.signerKeyValid;
    status.readyForUnsigned = result.configExists && result.mnemonicSet;
    printJsonSuccess(status);
    return;
  }

  const silent = isSilent(ctx);

  if (!silent) process.stderr.write(chalk.bold("\nPrivacy Pools CLI Status\n") + "\n");

  // Config
  if (result.configExists) {
    success(`Config: ${result.configDir}/config.json`, silent);
  } else {
    warn("Config not found. Run 'privacy-pools init'.", silent);
  }

  // Mnemonic
  if (result.mnemonicSet) {
    success("Recovery phrase: set", silent);
  } else {
    warn("Recovery phrase: not set", silent);
  }

  // Signer
  if (result.signerAddress && result.signerKeyValid) {
    success(`Signer: ${result.signerAddress}`, silent);
  } else if (result.signerKeySet && !result.signerKeyValid) {
    warn("Signer key is set but invalid. Re-run 'privacy-pools init' to reconfigure.", silent);
  } else {
    warn("Signer: not set", silent);
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
      for (const [name, _chainId] of result.accountFiles) {
        process.stderr.write(`  ${chalk.green("●")} ${name} (chain ${_chainId})\n`);
      }
    } else {
      info("No account files found.", silent);
    }
    process.stderr.write("\n");
  }
}
