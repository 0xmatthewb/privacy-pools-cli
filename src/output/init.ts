/**
 * Output renderer for the `init` command.
 *
 * Handles final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */

import type { OutputContext } from "./common.js";
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

  const agentNextActions = [
    createNextAction(
      "status",
      "Verify wallet readiness and chain health before transacting.",
      "after_init",
      { options: { agent: true, chain: result.defaultChain } },
    ),
  ];

  // Human hint omits --chain (uses the default they just configured).
  const humanNextActions = [
    createNextAction(
      "pools",
      "Browse available pools before depositing.",
      "after_init",
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
    info("If migrating from the website, run 'privacy-pools accounts' to sync your onchain state.", silent);
    process.stderr.write("\n");
  }
  if (!result.mnemonicImported && ctx.mode.skipPrompts) {
    warn("You skipped backup confirmation (--yes mode). Ensure your recovery phrase is securely stored.", silent);
  }
  success("Setup complete!", silent);
  renderNextSteps(ctx, humanNextActions);
}
