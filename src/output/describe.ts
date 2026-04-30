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

function extractAvailableJsonFields(jsonFields: string | undefined): string[] {
  if (!jsonFields) return [];
  const source = jsonFields.trim();
  const start = source.indexOf("{");
  const end = source.indexOf("}");
  if (start === -1 || end === -1 || end <= start) return [];
  const body = source.slice(start + 1, end);
  const fields = new Set<string>();
  let depth = 0;
  let token = "";

  const flushToken = () => {
    const trimmed = token.trim();
    token = "";
    if (!trimmed || depth !== 0) return;
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_?]*)/);
    if (!match) return;
    fields.add(match[1]!.replace(/\?$/, ""));
  };

  for (const char of body) {
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      flushToken();
      continue;
    }
    token += char;
  }
  flushToken();
  return [...fields].sort();
}

export function renderCommandDescription(
  ctx: OutputContext,
  descriptor: DetailedCommandDescriptor,
): void {
  guardCsvUnsupported(ctx, "describe");
  const agentNextActions = buildDescribeCommandNextActions(descriptor, true);
  const humanNextActions = buildDescribeCommandNextActions(descriptor, false);

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      mode: "describe",
      operation: "describe",
      ...descriptor,
      availableJsonFields: extractAvailableJsonFields(descriptor.jsonFields ?? undefined),
    }, agentNextActions));
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
  envelopeRoots: string[],
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
      mode: "describe",
      action: "index",
      operation: "describe.index",
      commands,
      envelopeRoots,
    }, nextActions));
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  process.stderr.write(`\n${accentBold("Describe: commands")}\n`);
  process.stderr.write(formatSectionHeading("Available command paths", { divider: true }));
  const maxCommandWidth = Math.max(
    20,
    ...commands.map((command) => command.command.length),
  );
  for (const command of commands) {
    const commandLabel = command.command.padEnd(maxCommandWidth + 2);
    process.stderr.write(
      `  ${commandLabel}${command.description} ${command.group ? `(${formatGroupLabel(command.group)})` : ""}\n`,
    );
  }
  process.stderr.write(
    formatSectionHeading("Envelope schema roots", { divider: true }),
  );
  process.stderr.write("  envelope\n");
  for (const root of envelopeRoots) {
    process.stderr.write(`  envelope.${root}\n`);
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
      mode: "describe",
      action: "schema",
      operation: "describe.schema",
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
