/**
 * Output renderer for the `describe` command.
 */

import type { CommandGroup, DetailedCommandDescriptor } from "../types.js";
import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  guardCsvUnsupported,
  isSilent,
  printJsonSuccess,
  renderNextSteps,
} from "./common.js";
import { renderHumanCommandDescription } from "./discovery.js";
import { accentBold } from "../utils/theme.js";
import { formatSectionHeading } from "./layout.js";

export type { DetailedCommandDescriptor } from "../types.js";

export interface DescribeIndexEntry {
  command: string;
  description: string;
  group: CommandGroup;
}

function parseUsageParameters(
  usage: string,
  command: string,
): Array<{ name: string; type: string; required: boolean }> {
  const usageTail = usage.startsWith(command)
    ? usage.slice(command.length).trim()
    : usage;
  const matches = Array.from(usageTail.matchAll(/(<[^>]+>|\[[^\]]+\])/g));
  return matches.map(([token]) => {
    const required = token.startsWith("<");
    const rawName = token.slice(1, -1).trim();
    const normalizedName = rawName
      .replace(/\|latest$/i, "")
      .replace(/[|/]/g, "_or_")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return {
      name: normalizedName || "value",
      type: "text",
      required,
    };
  });
}

function buildDescribeCommandNextActions(
  descriptor: DetailedCommandDescriptor,
  agent: boolean,
) {
  const parameters = parseUsageParameters(descriptor.usage, descriptor.command);
  return [
    createNextAction(
      descriptor.command,
      "Run this command path now that its contract and prerequisites are loaded.",
      "after_describe",
      {
        options: agent ? { agent: true } : undefined,
        ...(parameters.length > 0 ? { parameters, runnable: false } : {}),
      },
    ),
  ];
}

export function renderCommandDescription(
  ctx: OutputContext,
  descriptor: DetailedCommandDescriptor,
): void {
  guardCsvUnsupported(ctx, "describe");
  const agentNextActions = buildDescribeCommandNextActions(descriptor, true);
  const humanNextActions = buildDescribeCommandNextActions(descriptor, false);

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({ ...descriptor }, agentNextActions));
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  renderHumanCommandDescription(descriptor);
  renderNextSteps(ctx, humanNextActions);
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
  const nextActions = [
    createNextAction(
      "describe",
      "Inspect one concrete command path in detail after browsing the index.",
      "after_describe",
      {
        options: ctx.mode.isJson ? { agent: true } : undefined,
        parameters: [{ name: "commandPath", type: "command_path", required: true }],
        runnable: false,
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      mode: "describe-index",
      commands,
    }, nextActions));
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
  renderNextSteps(ctx, [
    createNextAction(
      "describe",
      "Inspect one concrete command path in detail.",
      "after_describe",
      {
        parameters: [{ name: "commandPath", type: "command_path", required: true }],
        runnable: false,
      },
    ),
  ]);
}

export function renderSchemaDescription(
  ctx: OutputContext,
  descriptor: {
    path: string;
    schema: unknown;
  },
): void {
  guardCsvUnsupported(ctx, "describe");
  const nextActions = [
    createNextAction(
      "capabilities",
      "Inspect the shared runtime schemas after reviewing this envelope path.",
      "after_describe",
      {
        options: ctx.mode.isJson ? { agent: true } : undefined,
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      path: descriptor.path,
      schema: descriptor.schema,
    }, nextActions));
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  process.stderr.write(`\n${accentBold(`Schema: ${descriptor.path}`)}\n`);
  process.stderr.write(formatSectionHeading("Value", { divider: true }));
  process.stderr.write(`${JSON.stringify(descriptor.schema, null, 2)}\n\n`);
  renderNextSteps(ctx, [
    createNextAction(
      "capabilities",
      "Inspect the shared runtime schemas after reviewing this envelope path.",
      "after_describe",
    ),
  ]);
}
