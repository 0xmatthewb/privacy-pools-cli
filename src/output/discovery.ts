import type {
  CapabilitiesPayload,
  DetailedCommandDescriptor,
} from "../types.js";
import { accentBold } from "../utils/theme.js";
import {
  formatKeyValueRows,
  formatSectionHeading,
  formatSectionList,
} from "./layout.js";

export function renderHumanGuideText(text: string): void {
  process.stderr.write("\n");
  process.stderr.write(`${text}\n\n`);
}

export function renderHumanCapabilities(
  payload: CapabilitiesPayload,
): void {
  process.stderr.write(`\n${accentBold("Privacy Pools CLI: Agent Capabilities")}\n`);
  process.stderr.write(formatSectionHeading("Commands", { divider: true }));
  for (const command of payload.commands) {
    const aliasStr = command.aliases ? ` (alias: ${command.aliases.join(", ")})` : "";
    process.stderr.write(`  ${command.name}${aliasStr}: ${command.description}\n`);
    if (command.agentFlags) {
      process.stderr.write(
        `    Agent usage: privacy-pools ${command.usage ?? command.name} ${command.agentFlags}\n`,
      );
    }
  }

  process.stderr.write(formatSectionHeading("Global flags", { divider: true }));
  for (const flag of payload.globalFlags) {
    process.stderr.write(`  ${flag.flag}: ${flag.description}\n`);
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

export function renderHumanCommandDescription(
  descriptor: DetailedCommandDescriptor,
): void {
  process.stderr.write(`\n${accentBold(`Command: ${descriptor.command}`)}\n`);
  process.stderr.write(formatSectionHeading("Summary", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      { label: "Description", value: descriptor.description },
      { label: "Usage", value: `privacy-pools ${descriptor.usage}` },
      { label: "Requires init", value: descriptor.requiresInit ? "yes" : "no" },
      { label: "Safe read-only", value: descriptor.safeReadOnly ? "yes" : "no" },
      { label: "Expected latency", value: descriptor.expectedLatencyClass },
      ...(descriptor.aliases.length > 0
        ? [{ label: "Aliases", value: descriptor.aliases.join(", ") }]
        : []),
    ]),
  );

  writeListSection("Flags", descriptor.flags);
  writeListSection("Global flags", descriptor.globalFlags);
  writeListSection("Prerequisites", descriptor.prerequisites);
  writeListSection("Examples", descriptor.examples);

  if (descriptor.jsonFields) {
    process.stderr.write(formatSectionHeading("JSON fields", { divider: true }));
    process.stderr.write(`  ${descriptor.jsonFields}\n`);
  }

  writeListSection("JSON variants", descriptor.jsonVariants);
  writeListSection("Safety notes", descriptor.safetyNotes);
  writeListSection("Agent workflow", descriptor.agentWorkflowNotes);

  const additionalModes: string[] = [];
  if (descriptor.supportsUnsigned) {
    additionalModes.push(
      "--unsigned builds transaction payloads without submitting.",
    );
  }
  if (descriptor.supportsDryRun) {
    additionalModes.push(
      "--dry-run validates the operation without submitting it.",
    );
  }
  writeListSection("Additional modes", additionalModes);
  process.stderr.write("\n");
}
