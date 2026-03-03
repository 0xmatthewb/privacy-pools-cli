/**
 * Output renderer for the `init` command.
 *
 * Handles final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { printJsonSuccess, success, info, warn, isSilent, guardCsvUnsupported } from "./common.js";
import { accent } from "../utils/theme.js";

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
  guardCsvUnsupported(ctx, "init");

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
    jsonOutput.nextSteps = {
      requiresMnemonicCapture: !result.mnemonicImported,
      requiresSignerKey: !result.signerKeySet,
      suggestedCommands: [
        ...(result.signerKeySet ? [] : ["export PRIVACY_POOLS_PRIVATE_KEY=0x..."]),
        "privacy-pools status --agent",
        "privacy-pools pools --agent",
      ],
    };
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
  success("Setup complete! Here's what to do next:", silent);
  if (!silent) {
    process.stderr.write("\n");
    process.stderr.write(`  ${chalk.dim("1.")} Browse pools          ${accent("privacy-pools pools")}\n`);
    process.stderr.write(`  ${chalk.dim("2.")} Make a deposit         ${accent("privacy-pools deposit 0.1 --asset ETH")}\n`);
    process.stderr.write(`  ${chalk.dim("3.")} Check your accounts    ${accent("privacy-pools accounts")}\n`);
    process.stderr.write(`  ${chalk.dim("4.")} Withdraw funds         ${accent("privacy-pools withdraw 0.05 --asset ETH --to 0x...")}\n`);
    process.stderr.write("\n");
    info(`Full guide: ${accent("privacy-pools guide")}`, silent);
  }
}
