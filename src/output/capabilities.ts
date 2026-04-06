/**
 * Output renderer for the `capabilities` command.
 *
 * `src/commands/capabilities.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import {
  printJsonSuccess,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import type { CapabilitiesPayload } from "../types.js";
import { renderHumanCapabilities } from "./discovery.js";

export type { CapabilitiesPayload } from "../types.js";

/**
 * Render capabilities output.
 */
export function renderCapabilities(
  ctx: OutputContext,
  payload: CapabilitiesPayload,
): void {
  guardCsvUnsupported(ctx, "capabilities");

  if (ctx.mode.isJson) {
    printJsonSuccess(payload);
    return;
  }

  if (isSilent(ctx)) return;

  renderHumanCapabilities(payload);
}
