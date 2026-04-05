import type { GlobalOptions } from "../types.js";
import { CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { guardStaticCsvUnsupported, isQuietMode } from "./guards.js";

function writeList(label: string, values: string[]): void {
  if (values.length === 0) return;
  process.stderr.write(`\n${label}:\n`);
  for (const value of values) {
    process.stderr.write(`  ${value}\n`);
  }
}

export async function renderStaticCapabilities(
  globalOpts: GlobalOptions,
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "capabilities");
  const { STATIC_CAPABILITIES_PAYLOAD } = await import(
    "../utils/command-discovery-static.js"
  );
  const payload = STATIC_CAPABILITIES_PAYLOAD;
  const mode = resolveGlobalMode(globalOpts);

  if (mode.isJson) {
    printJsonSuccess(payload);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  process.stderr.write("\nPrivacy Pools CLI: Agent Capabilities\n\n");
  process.stderr.write("Commands:\n");
  for (const command of payload.commands) {
    const aliasStr = command.aliases
      ? ` (alias: ${command.aliases.join(", ")})`
      : "";
    process.stderr.write(
      `  ${command.name}${aliasStr}: ${command.description}\n`,
    );
    if (command.agentFlags) {
      process.stderr.write(
        `    Agent usage: privacy-pools ${command.usage ?? command.name} ${command.agentFlags}\n`,
      );
    }
  }

  process.stderr.write("\nGlobal Flags:\n");
  for (const flag of payload.globalFlags) {
    process.stderr.write(`  ${flag.flag}: ${flag.description}\n`);
  }

  process.stderr.write("\nTypical Agent Workflow:\n");
  for (const step of payload.agentWorkflow) {
    process.stderr.write(`  ${step}\n`);
  }
  process.stderr.write("\n");
}

export async function renderStaticGuide(
  globalOpts: GlobalOptions,
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "guide");
  const mode = resolveGlobalMode(globalOpts);
  const { guideText } = await import("../utils/help.js");

  if (mode.isJson) {
    printJsonSuccess({
      mode: "help",
      help: guideText(),
    });
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  process.stderr.write("\n");
  process.stderr.write(`${guideText()}\n`);
  process.stderr.write("\n");
}

export async function renderStaticDescribe(
  globalOpts: GlobalOptions,
  commandTokens: string[],
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "describe");
  const mode = resolveGlobalMode(globalOpts);
  const {
    listStaticCommandPaths,
    resolveStaticCommandPath,
    STATIC_CAPABILITIES_PAYLOAD,
  } = await import("../utils/command-discovery-static.js");
  const commandPath = resolveStaticCommandPath(commandTokens);
  if (!commandPath) {
    throw new CLIError(
      `Unknown command path: ${commandTokens.join(" ")}`,
      "INPUT",
      `Valid command paths: ${listStaticCommandPaths().join(", ")}`,
    );
  }

  const descriptor = STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath];
  if (mode.isJson) {
    printJsonSuccess(descriptor);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  const { accentBold } = await import("../utils/theme.js");
  process.stderr.write(`\n${accentBold(`Command: ${descriptor.command}`)}\n\n`);
  process.stderr.write(`Description: ${descriptor.description}\n`);
  process.stderr.write(`Usage: privacy-pools ${descriptor.usage}\n`);
  process.stderr.write(
    `Requires init: ${descriptor.requiresInit ? "yes" : "no"}\n`,
  );
  process.stderr.write(
    `Safe read-only: ${descriptor.safeReadOnly ? "yes" : "no"}\n`,
  );
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
      process.stderr.write(
        "  --unsigned builds transaction payloads without submitting.\n",
      );
    }
    if (descriptor.supportsDryRun) {
      process.stderr.write(
        "  --dry-run validates the operation without submitting it.\n",
      );
    }
  }

  process.stderr.write("\n");
}

export async function renderStaticRootHelp(
  isMachineMode: boolean,
): Promise<void> {
  const {
    rootHelpBaseText,
    rootHelpFooter,
    rootHelpText,
    styleCommanderHelp,
  } = await import("../utils/root-help.js");

  if (isMachineMode) {
    printJsonSuccess({
      mode: "help",
      help: rootHelpText(),
    });
    return;
  }

  process.stdout.write(
    `${styleCommanderHelp(rootHelpBaseText())}\n${rootHelpFooter()}\n`,
  );
}
