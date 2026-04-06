/**
 * Output renderer for the `describe` command.
 */

import type { DetailedCommandDescriptor } from "../types.js";
import type { OutputContext } from "./common.js";
import { guardCsvUnsupported, isSilent, printJsonSuccess } from "./common.js";
import { renderHumanCommandDescription } from "./discovery.js";

export type { DetailedCommandDescriptor } from "../types.js";

export function renderCommandDescription(
  ctx: OutputContext,
  descriptor: DetailedCommandDescriptor,
): void {
  guardCsvUnsupported(ctx, "describe");

  if (ctx.mode.isJson) {
    printJsonSuccess(descriptor);
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  renderHumanCommandDescription(descriptor);
}
