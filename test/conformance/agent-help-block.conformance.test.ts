import { describe, expect, test } from "bun:test";
import { STATIC_COMMAND_PATHS } from "../../src/utils/command-discovery-static.ts";
import { getCommandMetadata } from "../../src/utils/command-metadata.ts";
import { runCli } from "../helpers/cli.ts";
import { normalizeSemanticText } from "../helpers/contract-assertions.ts";

function normalize(value: string): string {
  return normalizeSemanticText(value).replace(/\s+/g, " ").trim();
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
      const result = runCli([...path.split(" "), "--help-full", "--help"], {
        env: {
          PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
        },
      });
      expect(result.status).toBe(0);

      const help = normalize(result.stdout);
      if (agentFlags) {
        expect(help).toContain(normalize(agentFlags));
      }
      for (const flag of agentFlagNames) {
        expect(help).toContain(normalize(flag));
      }
      for (const note of agentWorkflowNotes) {
        expect(help).toContain(normalize(note));
      }
      for (const flag of agentRequiredFlags) {
        expect(help).toContain(normalize(`Required for agents: ${flag}`));
      }
      if (agentsDocMarker) {
        expect(help).toContain(normalize(agentsDocMarker));
      }
    });
  }
});
