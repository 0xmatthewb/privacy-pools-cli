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
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";

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

  // Agent path: new wallet → status (verify readiness); restore → migrate status first.
  // Imported website accounts can require legacy migration or website recovery before the
  // CLI can safely restore them, so migrate status is the canonical first check.
  const isTestnet = isTestnetChain(result.defaultChain);
  const agentNextActions = result.mnemonicImported
    ? [
        createNextAction(
          "migrate status",
          "Check migration or website-recovery readiness across all chains before restoring imported account state in the CLI.",
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
  //   Restore     → "check migration readiness first" with --all-chains for broadest coverage
  const humanNextActions = result.mnemonicImported
    ? [
        createNextAction(
          "migrate status",
          "Check migration or website-recovery readiness across all chains before restoring imported account state in the CLI.",
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
  success("Setup complete!", silent);
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Default chain", value: result.defaultChain },
        {
          label: "Recovery phrase",
          value: result.mnemonicImported ? "imported" : "generated",
        },
        {
          label: "Signer key",
          value: result.signerKeySet ? "configured" : "not set",
          valueTone: result.signerKeySet ? "success" : "warning",
        },
      ]),
    );
    if (result.mnemonicImported) {
      process.stderr.write(
        formatCallout(
          "recovery",
          "Your signer key pays gas; your recovery phrase is still the only way to recover deposited funds.",
        ),
      );
    } else if (ctx.mode.skipPrompts) {
      process.stderr.write(
        formatCallout(
          "danger",
          "You skipped the backup confirmation step. Make sure your recovery phrase is securely stored before depositing funds.",
        ),
      );
    }
  }
  renderNextSteps(ctx, humanNextActions);
}
