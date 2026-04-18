/**
 * Output renderer for the `describe` command.
 */

import type { CommandGroup, DetailedCommandDescriptor } from "../types.js";
import type { OutputContext } from "./common.js";
import { guardCsvUnsupported, isSilent, printJsonSuccess } from "./common.js";
import { renderHumanCommandDescription } from "./discovery.js";
import { accentBold } from "../utils/theme.js";
import { formatSectionHeading } from "./layout.js";

export type { DetailedCommandDescriptor } from "../types.js";

export interface DescribeIndexEntry {
  command: string;
  description: string;
  group: CommandGroup;
}

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

function formatGroupLabel(group: CommandGroup): string {
  switch (group) {
    case "getting-started":
      return "Getting started";
    case "transaction":
      return "Transactions";
    case "monitoring":
      return "Monitoring";
    case "advanced":
      return "Advanced";
  }
}

export function renderCommandDescriptionIndex(
  ctx: OutputContext,
  commands: DescribeIndexEntry[],
): void {
  guardCsvUnsupported(ctx, "describe");

  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "describe-index",
      commands,
    });
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  process.stderr.write(`\n${accentBold("Describe: commands")}\n`);
  process.stderr.write(formatSectionHeading("Available command paths", { divider: true }));
  for (const command of commands) {
    process.stderr.write(
      `  ${command.command.padEnd(20)}${command.description} ${command.group ? `(${formatGroupLabel(command.group)})` : ""}\n`,
    );
  }
  process.stderr.write("\n");
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
