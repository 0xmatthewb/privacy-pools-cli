/**
 * Output renderer for the `init` command.
 *
 * Handles final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import type { NextActionOptionValue } from "../types.js";
import {
  appendNextActions,
  createNextAction,
  renderNextSteps,
  printJsonSuccess,
  success,
  info,
  warn,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import { isTestnetChain } from "../config/chains.js";

export interface InitRenderResult {
  defaultChain: string;
  signerKeySet: boolean;
  /** True when mnemonic was imported (not generated). */
  mnemonicImported: boolean;
  /** True when --show-mnemonic was passed. */
  showMnemonic: boolean;
  /** The recovery phrase (included only when showMnemonic && !mnemonicImported). */
  mnemonic?: string;
  /** Warning message to include in JSON output (e.g. for agent recovery phrase capture). */
  warning?: string;
}

/**
 * Render the init command final output.
 */
export function renderInitResult(ctx: OutputContext, result: InitRenderResult): void {
  guardCsvUnsupported(ctx, "init");

  // Agent path: new wallet → status (verify readiness); restore → accounts (sync onchain state).
  // Restore always uses --all-chains so the first post-restore screen shows every chain,
  // including testnets — we don't know which chains hold recoverable state.
  const isTestnet = isTestnetChain(result.defaultChain);
  const agentNextActions = result.mnemonicImported
    ? [
        createNextAction(
          "accounts",
          "Sync and review your restored onchain Pool Accounts across all chains.",
          "after_restore",
          { options: { agent: true, allChains: true } },
        ),
      ]
    : [
        createNextAction(
          "status",
          "Verify wallet readiness and chain health before transacting.",
          "after_init",
          { options: { agent: true, chain: result.defaultChain } },
        ),
      ];

  // Differentiate new-wallet vs restore/migration:
  //   New wallet  → "browse pools before depositing" (testnet needs --chain)
  //   Restore     → "check your onchain state" with --all-chains for broadest coverage
  const humanNextActions = result.mnemonicImported
    ? [
        createNextAction(
          "accounts",
          "Sync and review your onchain Pool Accounts across all chains.",
          "after_restore",
          { options: { allChains: true } },
        ),
      ]
    : [
        createNextAction(
          "pools",
          "Browse available pools before depositing.",
          "after_init",
          isTestnet ? { options: { chain: result.defaultChain } } : undefined,
        ),
      ];

  if (ctx.mode.isJson) {
    const jsonOutput: Record<string, unknown> = appendNextActions({
      defaultChain: result.defaultChain,
      signerKeySet: result.signerKeySet,
    }, agentNextActions) as Record<string, unknown>;
    if (!result.mnemonicImported) {
      if (result.showMnemonic) {
        jsonOutput.recoveryPhrase = result.mnemonic;
      } else {
        jsonOutput.recoveryPhraseRedacted = true;
      }
    }
    if (result.warning) {
      jsonOutput.warning = result.warning;
    }
    printJsonSuccess(jsonOutput, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  if (result.mnemonicImported && !silent) {
    info("Reminder: your signer key pays gas; your recovery phrase controls private account state.", silent);
    process.stderr.write("\n");
  }
  if (!result.mnemonicImported && ctx.mode.skipPrompts) {
    warn("You skipped backup confirmation (--yes mode). Ensure your recovery phrase is securely stored.", silent);
  }
  success("Setup complete!", silent);
  renderNextSteps(ctx, humanNextActions);
}
