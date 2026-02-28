/**
 * Output renderer for the `init` command.
 *
 * Handles final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */
import { printJsonSuccess, success, info, isSilent } from "./common.js";
/**
 * Render the init command final output.
 */
export function renderInitResult(ctx, result) {
    if (ctx.mode.isJson) {
        const jsonOutput = {
            defaultChain: result.defaultChain,
            signerKeySet: result.signerKeySet,
        };
        if (!result.mnemonicImported) {
            if (result.showMnemonic) {
                jsonOutput.mnemonic = result.mnemonic;
            }
            else {
                jsonOutput.mnemonicRedacted = true;
            }
        }
        printJsonSuccess(jsonOutput, false);
        return;
    }
    const silent = isSilent(ctx);
    if (!silent)
        process.stderr.write("\n");
    success("Initialization complete.", silent);
    info("Next: run 'privacy-pools pools' to see available pools.", silent);
}
