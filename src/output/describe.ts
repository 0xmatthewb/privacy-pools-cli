/**
 * Output renderer for the `describe` command.
 */

import type { DetailedCommandDescriptor } from "../types.js";
import type { OutputContext } from "./common.js";
import { guardCsvUnsupported, isSilent, printJsonSuccess } from "./common.js";
import { renderHumanCommandDescription } from "./discovery.js";
import { accentBold } from "../utils/theme.js";
import { formatSectionHeading } from "./layout.js";

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

export function renderSchemaDescription(
  ctx: OutputContext,
  descriptor: {
    path: string;
    schema: unknown;
  },
): void {
  guardCsvUnsupported(ctx, "describe");

  if (ctx.mode.isJson) {
    printJsonSuccess({
      path: descriptor.path,
      schema: descriptor.schema,
    });
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  process.stderr.write(`\n${accentBold(`Schema: ${descriptor.path}`)}\n`);
  process.stderr.write(formatSectionHeading("Value", { divider: true }));
  process.stderr.write(`${JSON.stringify(descriptor.schema, null, 2)}\n\n`);
}
