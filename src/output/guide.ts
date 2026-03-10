/**
 * Output renderer for the `guide` command.
 *
 * `src/commands/guide.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, isSilent, guardCsvUnsupported } from "./common.js";
import { guideText } from "../utils/help.js";

/**
 * Render guide output.
 */
export function renderGuide(ctx: OutputContext): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "help",
      help: guideText(),
    });
    return;
  }

  guardCsvUnsupported(ctx, "guide");
  if (isSilent(ctx)) return;

  process.stderr.write("\n");
  process.stderr.write(guideText() + "\n");
  process.stderr.write("\n");
}
