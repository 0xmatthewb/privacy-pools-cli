import type {
  CapabilitiesPayload,
  CommandGroup,
  DetailedCommandDescriptor,
} from "../types.js";
import { listRelatedEnvelopePaths } from "../utils/describe-schema.js";
import { accentBold } from "../utils/theme.js";
import {
  formatKeyValueRows,
  formatSectionHeading,
  formatSectionList,
} from "./layout.js";

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function isGuideSectionHeading(line: string): boolean {
  const plain = stripAnsi(line);
  return plain.trim().length > 0 && !/^\s/.test(plain);
}

export function renderHumanGuideText(text: string): void {
  const lines = text.split("\n");
  const [rawTitle = "", ...body] = lines;
  const title = stripAnsi(rawTitle).trim();

  process.stderr.write("\n");
  if (title.length > 0) {
    process.stderr.write(`${accentBold(title)}\n`);
  }

  let sectionCount = 0;
  let lastLineWasBlank = title.length === 0;
  for (const line of body) {
    const plain = stripAnsi(line).trim();
    if (plain.length === 0) {
      process.stderr.write("\n");
      lastLineWasBlank = true;
      continue;
    }

    if (isGuideSectionHeading(line)) {
      process.stderr.write(formatSectionHeading(plain, {
        divider: sectionCount > 0,
        padTop: !lastLineWasBlank,
      }));
      sectionCount += 1;
      lastLineWasBlank = false;
      continue;
    }

    process.stderr.write(`${line}\n`);
    lastLineWasBlank = false;
  }

  process.stderr.write("\n");
}

export function renderHumanCapabilities(
  payload: CapabilitiesPayload,
): void {
  const commandsByGroup = new Map<
    CommandGroup,
    CapabilitiesPayload["commands"]
  >();
  for (const command of payload.commands) {
    const commands = commandsByGroup.get(command.group) ?? [];
    commands.push(command);
    commandsByGroup.set(command.group, commands);
  }

  const groupLabels: Array<{ id: CommandGroup; label: string }> = [
    { id: "getting-started", label: "Getting started" },
    { id: "transaction", label: "Transactions" },
    { id: "monitoring", label: "Monitoring" },
    { id: "advanced", label: "Advanced" },
  ];

  process.stderr.write(`\n${accentBold("Privacy Pools CLI: Agent Capabilities")}\n`);
  process.stderr.write(formatSectionHeading("Commands", { divider: true }));
  for (const group of groupLabels) {
    const commands = commandsByGroup.get(group.id) ?? [];
    if (commands.length === 0) continue;
    process.stderr.write(`  ${group.label}\n`);
    for (const command of commands) {
      const aliasStr = command.aliases ? ` (alias: ${command.aliases.join(", ")})` : "";
      process.stderr.write(`    ${command.name}${aliasStr}: ${command.description}\n`);
      if (command.agentFlags) {
        process.stderr.write(
          `      Agent usage: privacy-pools ${command.usage ?? command.name} ${command.agentFlags}\n`,
        );
      }
    }
  }

  process.stderr.write(formatSectionHeading("Global flags", { divider: true }));
  for (const flag of payload.globalFlags) {
    process.stderr.write(`  ${flag.flag}: ${flag.description}\n`);
  }

  process.stderr.write(formatSectionHeading("Exit codes", { divider: true }));
  for (const exitCode of payload.exitCodes) {
    process.stderr.write(
      `  ${exitCode.code} ${exitCode.category} (${exitCode.errorCode}): ${exitCode.description}\n`,
    );
  }

  process.stderr.write(formatSectionHeading("Environment variables", { divider: true }));
  for (const envVar of payload.envVars) {
    const aliases = envVar.aliases?.length
      ? ` (aliases: ${envVar.aliases.join(", ")})`
      : "";
    process.stderr.write(`  ${envVar.name}${aliases}: ${envVar.description}\n`);
  }

  process.stderr.write(
    formatSectionList("Typical agent workflow", payload.agentWorkflow, {
      divider: true,
    }),
  );
  process.stderr.write(formatSectionHeading("Protocol profile", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      {
        label: "Profile",
        value: `${payload.protocol.displayName} (${payload.protocol.profile})`,
      },
      {
        label: "SDK",
        value: `${payload.protocol.coreSdkPackage}@${payload.protocol.coreSdkVersion}`,
      },
    ]),
  );

  process.stderr.write(
    formatSectionHeading("Runtime compatibility", { divider: true }),
  );
  process.stderr.write(
    formatKeyValueRows([
      { label: "CLI", value: payload.runtime.cliVersion },
      { label: "JSON", value: payload.runtime.jsonSchemaVersion },
      { label: "Runtime", value: payload.runtime.runtimeVersion },
      { label: "Worker", value: payload.runtime.workerProtocolVersion },
      { label: "Manifest", value: payload.runtime.manifestVersion },
      { label: "Bridge", value: payload.runtime.nativeBridgeVersion },
    ]),
  );
}

function writeListSection(label: string, values: string[]): void {
  const block = formatSectionList(label, values, { divider: true });
  if (block.length > 0) {
    process.stderr.write(block);
  }
}

function writeParagraphSection(label: string, paragraphs: string[]): void {
  if (paragraphs.length === 0) {
    return;
  }

  process.stderr.write(formatSectionHeading(label, { divider: true }));
  for (const paragraph of paragraphs) {
    process.stderr.write(`  ${paragraph}\n`);
  }
}

function writeStructuredExamplesSection(
  descriptor: DetailedCommandDescriptor,
): void {
  if (!descriptor.structuredExamples?.length) {
    writeListSection(
      "Examples",
      descriptor.examples.map((example) => {
        if (typeof example === "string") {
          return example;
        }
        if ("command" in example) {
          return `${example.description}: ${example.command}`;
        }
        const commands = example.commands.map((command) =>
          typeof command === "string" ? command : command.command,
        );
        return `${example.category}: ${commands.join(" | ")}`;
      }),
    );
    return;
  }

  process.stderr.write(formatSectionHeading("Structured examples", { divider: true }));
  let previousDescription: string | null = null;
  for (const example of descriptor.structuredExamples) {
    const description = example.description ?? example.name ?? "Example";
    const commands = example.command
      ? [example.command]
      : Array.isArray(example.value)
        ? example.value
        : example.value
          ? [example.value]
          : [];
    if (description !== previousDescription) {
      process.stderr.write(formatSectionHeading(description, { padTop: false }));
      previousDescription = description;
    }
    for (const command of commands) {
      process.stderr.write(`  ${command}\n`);
    }
  }
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

export function renderHumanCommandDescription(
  descriptor: DetailedCommandDescriptor,
): void {
  const relatedEnvelopePaths = listRelatedEnvelopePaths(descriptor.command);

  process.stderr.write(`\n${accentBold(`Command: ${descriptor.command}`)}\n`);
  process.stderr.write(formatSectionHeading("Summary", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      { label: "Description", value: descriptor.description },
      { label: "Group", value: formatGroupLabel(descriptor.group) },
      { label: "Usage", value: `privacy-pools ${descriptor.usage}` },
      { label: "Requires init", value: descriptor.requiresInit ? "yes" : "no" },
      { label: "Safe read-only", value: descriptor.safeReadOnly ? "yes" : "no" },
      { label: "Expected latency", value: descriptor.expectedLatencyClass },
      ...(descriptor.aliases.length > 0
        ? [{ label: "Aliases", value: descriptor.aliases.join(", ") }]
        : []),
    ]),
  );

  writeParagraphSection("When to use", descriptor.agentWorkflowNotes);
  if (descriptor.prerequisites.length > 0) {
    process.stderr.write(formatSectionHeading("Prerequisites", { divider: true }));
    process.stderr.write(
      "  Before you run this command, make sure these prerequisites are satisfied:\n",
    );
    for (const prerequisite of descriptor.prerequisites) {
      process.stderr.write(`  - ${prerequisite}\n`);
    }
  }

  writeListSection("Flags", descriptor.flags);
  writeListSection("Global flags", descriptor.globalFlags);
  writeStructuredExamplesSection(descriptor);

  if (descriptor.jsonFields) {
    process.stderr.write(formatSectionHeading("JSON fields", { divider: true }));
    process.stderr.write(`  ${descriptor.jsonFields}\n`);
  }

  writeListSection("JSON variants", descriptor.jsonVariants);
  writeListSection("Safety notes", descriptor.safetyNotes);
  if (descriptor.agentRequiredFlags && descriptor.agentRequiredFlags.length > 0) {
    writeListSection("Agent-required flags", descriptor.agentRequiredFlags);
  }

  const additionalModes: string[] = [];
  if (descriptor.supportsUnsigned) {
    additionalModes.push(
      "--unsigned builds transaction payloads without signing or submitting; implies --yes.",
    );
  }
  if (descriptor.supportsDryRun) {
    additionalModes.push(
      "--dry-run previews only; confirmations still apply in human mode.",
    );
  }
  if (additionalModes.length > 0) {
    additionalModes.unshift(
      "--yes skips confirmation prompts.",
      "--agent is shorthand for --json --yes --quiet.",
    );
  }
  writeListSection("Modes", additionalModes);
  writeListSection("Related envelope paths", relatedEnvelopePaths);
  process.stderr.write("\n");
}
