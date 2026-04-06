/**
 * Output renderer for the `guide` command.
 *
 * `src/commands/guide.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, isSilent, guardCsvUnsupported } from "./common.js";
import { guideText } from "../utils/help.js";
import { renderHumanGuideText } from "./discovery.js";

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

  renderHumanGuideText(guideText());
}
