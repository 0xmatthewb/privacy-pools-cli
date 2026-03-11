/**
 * Output renderer for the `guide` command.
 *
 * `src/commands/guide.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, isSilent } from "./common.js";
import { guideText } from "../utils/help.js";

/**
 * Render guide output.
 */
export function renderGuide(ctx: OutputContext): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      guide: "For agent integration, use 'privacy-pools capabilities --json' for full schema discovery. For human-readable guide, run without --json.",
      agentCommand: "privacy-pools capabilities --json",
    });
    return;
  }

  if (isSilent(ctx)) return;

  process.stderr.write("\n");
  process.stderr.write(guideText() + "\n");
  process.stderr.write("\n");
}
