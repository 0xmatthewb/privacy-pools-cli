/**
 * Output renderer for the `guide` command.
 *
 * `src/commands/guide.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, isSilent, guardCsvUnsupported } from "./common.js";
import { guideText, resolveGuideTopic } from "../utils/help.js";
import { renderHumanGuideText } from "./discovery.js";

/**
 * Render guide output, optionally filtered to a single topic.
 */
export function renderGuide(ctx: OutputContext, topic?: string): void {
  const resolvedTopic = resolveGuideTopic(topic) ?? topic;
  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "help",
      ...(resolvedTopic ? { topic: resolvedTopic } : {}),
      help: guideText(topic),
    });
    return;
  }

  guardCsvUnsupported(ctx, "guide");
  if (isSilent(ctx)) return;

  renderHumanGuideText(guideText(topic));
}
