import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Command, Option } from "commander";
import { createRootProgram } from "../../src/program.ts";
import {
  buildCapabilitiesPayload,
  COMMAND_PATHS,
  type CommandPath,
  getCommandMetadata,
  getDocumentedAgentMarkers,
  GLOBAL_FLAG_METADATA,
} from "../../src/utils/command-metadata.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

interface RuntimeCommandEntry {
  path: string;
  description: string;
  aliases: string[];
}

function collectRuntimeCommands(command: Command, prefix: string = ""): RuntimeCommandEntry[] {
  const entries: RuntimeCommandEntry[] = [];

  for (const subcommand of command.commands) {
    const path = prefix ? `${prefix} ${subcommand.name()}` : subcommand.name();
    entries.push({
      path,
      description: subcommand.description(),
      aliases: subcommand.aliases(),
    });
    entries.push(...collectRuntimeCommands(subcommand, path));
  }

  return entries;
}

function collectRootOptions(command: Command): Array<{ flag: string; description: string }> {
  return command.options
    .filter((option: Option) => option.flags !== "-h, --help" && option.flags !== "-V, --version")
    .map((option: Option) => ({
      flag: option.flags,
      description: option.description,
    }))
    .sort((left, right) => left.flag.localeCompare(right.flag));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractFieldTokens(summary: string): string[] {
  const tokens = summary.match(/\b[a-zA-Z][a-zA-Z0-9]*\b/g) ?? [];
  return Array.from(new Set(tokens));
}

function extractDocumentSection(document: string, marker: string, orderedMarkers: readonly string[]): string {
  const start = document.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing AGENTS marker '${marker}'.`);
  }

  let end = document.length;
  for (const nextMarker of orderedMarkers) {
    if (nextMarker === marker) continue;
    const nextIndex = document.indexOf(nextMarker, start + marker.length);
    if (nextIndex !== -1 && nextIndex < end) {
      end = nextIndex;
    }
  }

  return document.slice(start, end);
}

describe("command metadata conformance", () => {
  test("runtime command tree matches command metadata paths, descriptions, and aliases", () => {
    const runtimeCommands = collectRuntimeCommands(createRootProgram("0.0.0"))
      .sort((left, right) => left.path.localeCompare(right.path));

    expect(runtimeCommands.map((entry) => entry.path)).toEqual([...COMMAND_PATHS].sort());

    for (const entry of runtimeCommands) {
      const metadata = getCommandMetadata(entry.path as (typeof COMMAND_PATHS)[number]);
      expect(entry.description).toBe(metadata.description);
      expect(entry.aliases).toEqual(metadata.aliases ?? []);
    }
  });

  test("capabilities payload command catalog is derived from command metadata", () => {
    const payload = buildCapabilitiesPayload();

    for (const command of payload.commands) {
      const metadata = getCommandMetadata(command.name as (typeof COMMAND_PATHS)[number]);
      expect(command.description).toBe(metadata.description);
      expect(command.aliases ?? []).toEqual(metadata.aliases ?? []);
    }

    expect(payload.commands.map((command) => command.name)).toContain("stats global");
    expect(payload.commands.map((command) => command.name)).toContain("stats pool");
    expect(payload.commands.map((command) => command.name)).toContain("describe");
    expect(payload.commandDetails["withdraw quote"]?.command).toBe("withdraw quote");
    expect(payload.commandDetails["describe"]?.globalFlags).toContain("--agent");
    expect(payload.commandDetails["guide"]?.safeReadOnly).toBe(true);
    expect(payload.commandDetails["completion"]?.safeReadOnly).toBe(true);
    expect(payload.safeReadOnlyCommands).toContain("guide");
    expect(payload.safeReadOnlyCommands).toContain("completion");
  });

  test("root global flags match capabilities metadata", () => {
    const rootOptions = collectRootOptions(createRootProgram("0.0.0"));
    const metadata = [...GLOBAL_FLAG_METADATA].sort((left, right) => left.flag.localeCompare(right.flag));

    expect(rootOptions).toEqual(metadata);
  });

  test("capabilities omit hidden completion plumbing flags", () => {
    const completion = buildCapabilitiesPayload().commands.find((command) => command.name === "completion");

    expect(completion).toBeDefined();
    expect(completion?.flags).toEqual(["[shell]", "--shell <shell>"]);
    expect(completion?.flags ?? []).not.toContain("--query");
    expect(completion?.flags ?? []).not.toContain("--cword <index>");
  });

  test("metadata preserves key UX contract details for pools, withdraw, and history", () => {
    const payload = buildCapabilitiesPayload();
    const withdraw = payload.commands.find((command) => command.name === "withdraw");
    const history = payload.commands.find((command) => command.name === "history");
    const poolsJsonFields = getCommandMetadata("pools").help?.jsonFields;

    expect(withdraw?.flags ?? []).toContain("--all");
    expect(withdraw?.flags ?? []).toContain("--extra-gas");
    expect(withdraw?.flags ?? []).toContain("--no-extra-gas");
    expect(history?.expectedLatencyClass).toBe("slow");
    expect(poolsJsonFields).toContain("chain?");
    expect(poolsJsonFields).toContain("allChains?");
    expect(poolsJsonFields).toContain("chains?");
  });

  test("AGENTS command catalog markers stay aligned with documented command metadata", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");

    for (const marker of getDocumentedAgentMarkers()) {
      expect(agents).toContain(marker);
    }
  });

  test("AGENTS documented payload docs stay aligned with metadata summaries", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const markers = getDocumentedAgentMarkers();
    const documentedPayloadPaths = COMMAND_PATHS.filter((path) => {
      const metadata = getCommandMetadata(path);
      return Boolean(metadata.agentsDocMarker && metadata.help?.jsonFields);
    });

    for (const path of documentedPayloadPaths) {
      const metadata = getCommandMetadata(path);
      const marker = metadata.agentsDocMarker;
      const jsonFields = metadata.help?.jsonFields;

      expect(marker).toBeDefined();
      expect(jsonFields).toBeDefined();

      const section = extractDocumentSection(agents, marker!, markers);
      const normalizedSection = normalizeWhitespace(section);
      for (const token of extractFieldTokens(jsonFields!)) {
        expect(normalizedSection).toContain(token);
      }
    }
  });

  test("skill reference capabilities example stays explicitly abridged and aligned", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `capabilities`", ["### `capabilities`", "### `init`"]);
    const normalizedSection = normalizeWhitespace(section);
    const payload = buildCapabilitiesPayload();
    const deposit = payload.commands.find((command) => command.name === "deposit");
    const agentFlag = payload.globalFlags.find((flag) => flag.flag === "--agent");

    expect(normalizedSection).toContain("Representative payload (abridged):");
    expect(normalizedSection).toContain(deposit?.description ?? "");
    expect(normalizedSection).toContain(agentFlag?.description ?? "");
    expect(normalizedSection).toContain(normalizeWhitespace(payload.agentWorkflow[2] ?? ""));
    expect(normalizedSection).toContain(normalizeWhitespace(payload.agentWorkflow[3] ?? ""));
    expect(normalizedSection).toContain(normalizeWhitespace(payload.agentWorkflow[4] ?? ""));
    expect(normalizedSection).toContain(payload.agentNotes?.polling ?? "");
    expect(normalizedSection).toContain(payload.agentNotes?.withdrawQuote ?? "");
    expect(normalizedSection).toContain(payload.agentNotes?.firstRun ?? "");
    expect(normalizedSection).toContain(payload.agentNotes?.unsignedMode ?? "");
    expect(normalizedSection).toContain(payload.agentNotes?.metaFlag ?? "");
    expect(normalizedSection).toContain(payload.agentNotes?.statusCheck ?? "");
    expect(normalizedSection).toContain("safeReadOnlyCommands");
    expect(normalizedSection).toContain("jsonOutputContract");
    expect(normalizedSection).toContain("category");
    expect(normalizedSection).toContain("hint");
    expect(normalizedSection).toContain("retryable");
    expect(normalizedSection).toContain("Exception: --unsigned tx emits a raw transaction array without the envelope.");
  });

  test("skill reference accounts section documents unknown ASP status", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `accounts`", ["### `accounts`", "### `history`"]);
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain("aspStatus");
    expect(normalizedSection).toContain("\"unknown\"");
    expect(normalizedSection).toContain("spent or exited accounts");
  });

  test("AGENTS and skill reference activity docs describe all-mainnets global mode", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");

    const agentsSection = extractDocumentSection(agents, "#### `activity`", getDocumentedAgentMarkers());
    const referenceSection = extractDocumentSection(reference, "### `activity`", ["### `activity`", "### `stats global`"]);

    expect(normalizeWhitespace(agentsSection)).toContain("\"all-mainnets\"");
    expect(normalizeWhitespace(referenceSection)).toContain("\"chain\": \"all-mainnets\"");
    expect(normalizeWhitespace(referenceSection)).toContain("\"all-mainnets\"");
  });
});
