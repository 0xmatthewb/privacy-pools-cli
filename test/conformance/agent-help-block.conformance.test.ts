import { describe, expect, test } from "bun:test";
import { STATIC_COMMAND_PATHS } from "../../src/utils/command-discovery-static.ts";
import { getCommandMetadata } from "../../src/utils/command-metadata.ts";
import { runBuiltCli } from "../helpers/cli.ts";
import { normalizeSemanticText } from "../helpers/contract-assertions.ts";

function normalize(value: string): string {
  return normalizeSemanticText(value).replace(/\s+/g, " ").trim();
}

function linesForSection(help: string, heading: string): string[] {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => normalize(line) === normalize(heading));
  if (start === -1) return [];

  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().length === 0) {
      if (section.length > 0) break;
      continue;
    }
    section.push(line);
  }
  return section;
}

function standaloneFlagPattern(flag: string): RegExp {
  return new RegExp(
    `(^|[\\s,;(|\\[])${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s,;)|\\]])`,
  );
}

function expectHelpFlagTableIncludesFlag(
  help: string,
  flag: string,
): void {
  const documentedFlagLines = [
    ...linesForSection(help, "Options:"),
    ...linesForSection(help, "Flag guide:"),
    ...linesForSection(help, "Modes:"),
  ];
  const matchingLine = documentedFlagLines.find((line) =>
    standaloneFlagPattern(flag).test(line),
  );

  expect(
    matchingLine,
    `${flag} should appear in the command help flag table or mode table`,
  ).toBeDefined();
}

function expectRequiredAgentFlagInAgentWorkflow(
  help: string,
  flag: string,
): void {
  const agentWorkflow = linesForSection(help, "Agent workflow:");
  const requiredLine = agentWorkflow.find((line) =>
    normalize(line).startsWith("Required for agents:"),
  );

  expect(requiredLine, "required agent flags should be isolated in Agent workflow").toBeDefined();
  expect(requiredLine!).toMatch(standaloneFlagPattern(flag));
}

describe("agent help block conformance", () => {
  for (const path of STATIC_COMMAND_PATHS) {
    const metadata = getCommandMetadata(path);
    const agentFlags = metadata.capabilities?.agentFlags;
    const agentFlagNames = metadata.capabilities?.agentFlagNames ?? [];
    const agentWorkflowNotes = metadata.help?.agentWorkflowNotes ?? [];
    const agentRequiredFlags = metadata.capabilities?.agentRequiredFlags ?? [];
    const agentsDocMarker = metadata.agentsDocMarker;

    if (
      !agentFlags &&
      agentFlagNames.length === 0 &&
      agentWorkflowNotes.length === 0 &&
      agentRequiredFlags.length === 0 &&
      !agentsDocMarker
    ) {
      continue;
    }

    test(`${path} help derives agent block from metadata`, () => {
      const result = runBuiltCli([...path.split(" "), "--help-full", "--help"], {
        env: {
          PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
        },
      });
      expect(result.status).toBe(0);

      const rawHelp = result.stdout;
      const help = normalize(rawHelp);
      // agentFlags and agentWorkflowNotes are intentionally prose fields, so
      // they stay semantic fragment checks. The typed sibling arrays below are
      // matched against their distinct help surfaces instead.
      if (agentFlags) {
        expect(help).toContain(normalize(agentFlags));
      }
      for (const flag of agentFlagNames) {
        expectHelpFlagTableIncludesFlag(rawHelp, flag);
      }
      for (const note of agentWorkflowNotes) {
        expect(help).toContain(normalize(note));
      }
      for (const flag of agentRequiredFlags) {
        expectRequiredAgentFlagInAgentWorkflow(rawHelp, flag);
      }
      if (agentsDocMarker) {
        expect(help).toContain(normalize(agentsDocMarker));
      }
    });
  }
});
