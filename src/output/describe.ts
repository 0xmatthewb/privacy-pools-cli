/**
 * Output renderer for the `describe` command.
 */

import type { DetailedCommandDescriptor } from "../types.js";
import { accentBold } from "../utils/theme.js";
import type { OutputContext } from "./common.js";
import { guardCsvUnsupported, isSilent, printJsonSuccess } from "./common.js";

export type { DetailedCommandDescriptor } from "../types.js";

function writeList(label: string, values: string[]): void {
  if (values.length === 0) return;
  process.stderr.write(`\n${label}:\n`);
  for (const value of values) {
    process.stderr.write(`  ${value}\n`);
  }
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

  process.stderr.write(`\n${accentBold(`Command: ${descriptor.command}`)}\n\n`);
  process.stderr.write(`Description: ${descriptor.description}\n`);
  process.stderr.write(`Usage: privacy-pools ${descriptor.usage}\n`);
  process.stderr.write(`Requires init: ${descriptor.requiresInit ? "yes" : "no"}\n`);
  process.stderr.write(`Safe read-only: ${descriptor.safeReadOnly ? "yes" : "no"}\n`);
  process.stderr.write(`Expected latency: ${descriptor.expectedLatencyClass}\n`);

  if (descriptor.aliases.length > 0) {
    process.stderr.write(`Aliases: ${descriptor.aliases.join(", ")}\n`);
  }

  writeList("Flags", descriptor.flags);
  writeList("Global flags", descriptor.globalFlags);
  writeList("Prerequisites", descriptor.prerequisites);
  writeList("Examples", descriptor.examples);

  if (descriptor.jsonFields) {
    process.stderr.write(`\nJSON fields:\n  ${descriptor.jsonFields}\n`);
  }

  writeList("JSON variants", descriptor.jsonVariants);
  writeList("Safety notes", descriptor.safetyNotes);
  writeList("Agent workflow", descriptor.agentWorkflowNotes);

  if (descriptor.supportsUnsigned || descriptor.supportsDryRun) {
    process.stderr.write("\nAdditional modes:\n");
    if (descriptor.supportsUnsigned) {
      process.stderr.write("  --unsigned builds transaction payloads without submitting.\n");
    }
    if (descriptor.supportsDryRun) {
      process.stderr.write("  --dry-run validates the operation without submitting it.\n");
    }
  }

  process.stderr.write("\n");
}
