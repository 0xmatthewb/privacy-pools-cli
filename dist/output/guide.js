/**
 * Output renderer for the `guide` command.
 *
 * Phase 1 stub – delegates to existing output calls.
 * Phase 2 will move inline output from src/commands/guide.ts here.
 */
import { printJsonSuccess, isSilent } from "./common.js";
import { guideText } from "../utils/help.js";
/**
 * Render guide output.
 */
export function renderGuide(ctx) {
    if (ctx.mode.isJson) {
        printJsonSuccess({
            guide: "Run 'privacy-pools guide' without --json for the full guide.",
        });
        return;
    }
    if (isSilent(ctx))
        return;
    process.stderr.write("\n");
    process.stderr.write(guideText() + "\n");
    process.stderr.write("\n");
}
