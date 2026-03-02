/**
 * Output renderer for the `init` command.
 *
 * Handles final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, success, info, isSilent } from "./common.js";

export interface InitRenderResult {
  defaultChain: string;
  signerKeySet: boolean;
  /** True when mnemonic was imported (not generated). */
  mnemonicImported: boolean;
  /** True when --show-mnemonic was passed. */
  showMnemonic: boolean;
  /** The mnemonic phrase (included only when showMnemonic && !mnemonicImported). */
  mnemonic?: string;
  /** Warning message to include in JSON output (e.g. for agent mnemonic capture). */
  warning?: string;
}

/**
 * Render the init command final output.
 */
export function renderInitResult(ctx: OutputContext, result: InitRenderResult): void {
  if (ctx.mode.isJson) {
    const jsonOutput: Record<string, unknown> = {
      defaultChain: result.defaultChain,
      signerKeySet: result.signerKeySet,
    };
    if (!result.mnemonicImported) {
      if (result.showMnemonic) {
        jsonOutput.mnemonic = result.mnemonic;
      } else {
        jsonOutput.mnemonicRedacted = true;
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
  success("Initialization complete.", silent);
  info("Next: run 'privacy-pools pools' to see available pools.", silent);
}
