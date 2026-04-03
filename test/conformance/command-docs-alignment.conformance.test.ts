import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  getCommandMetadata,
  getDocumentedAgentMarkers,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractDocumentSection(
  document: string,
  marker: string,
  orderedMarkers: readonly string[],
): string {
  const start = document.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing document marker '${marker}'.`);
  }

  let end = document.length;
  for (const nextMarker of orderedMarkers) {
    if (nextMarker === marker) continue;
    const nextIndex = document.indexOf(nextMarker, start + marker.length);
    if (nextIndex !== -1 && nextIndex < end) {
      end = nextIndex;
    }
  }

  return normalizeWhitespace(document.slice(start, end));
}

const AGENTS = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
const AGENT_MARKERS = getDocumentedAgentMarkers();

describe("command docs alignment", () => {
  test("AGENTS command markers stay aligned with documented metadata", () => {
    for (const marker of AGENT_MARKERS) {
      expect(AGENTS).toContain(marker);
    }
  });

  test("AGENTS machine sections preserve required payload markers", () => {
    const expectations: Array<{ path: CommandPath; markers: string[] }> = [
      { path: "init", markers: ["signerKeySet", "recoveryPhrase", "nextActions"] },
      { path: "activity", markers: ["events", "reviewStatus", "chainFiltered"] },
      { path: "status", markers: ["recommendedMode", "blockingIssues", "nextActions"] },
      { path: "accounts", markers: ["balances", "pendingCount", "nextActions"] },
      { path: "migrate status", markers: ["readiness", "warnings", "submissionSupported"] },
      { path: "history", markers: ["events", "poolAccountId", "explorerUrl"] },
      { path: "sync", markers: ["syncedPools", "availablePoolAccounts"] },
      { path: "withdraw quote", markers: ["baseFeeBPS", "relayTxCost", "nextActions"] },
    ];

    for (const expectation of expectations) {
      const marker = getCommandMetadata(expectation.path).agentsDocMarker;
      expect(marker).toBeDefined();
      const section = extractDocumentSection(AGENTS, marker!, AGENT_MARKERS);

      for (const field of expectation.markers) {
        expect(section).toContain(field);
      }
    }
  });

  test("AGENTS capabilities docs keep the structural machine-contract anchors", () => {
    const capabilitiesSection = extractDocumentSection(
      AGENTS,
      "#### `capabilities`",
      AGENT_MARKERS,
    );

    for (const requiredMarker of [
      "executionRoutes",
      "safeReadOnlyCommands",
      "jsonOutputContract",
      "documentation",
      "runtime",
      "protocol",
    ]) {
      expect(capabilitiesSection).toContain(requiredMarker);
    }
  });

  test("AGENTS keeps current migration and contract error codes for agents", () => {
    const normalizedAgents = normalizeWhitespace(AGENTS);

    for (const code of [
      "ACCOUNT_MIGRATION_REQUIRED",
      "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
      "CONTRACT_UNKNOWN_STATE_ROOT",
      "CONTRACT_CONTEXT_MISMATCH",
      "CONTRACT_INVALID_COMMITMENT",
      "CONTRACT_INVALID_WITHDRAWAL_AMOUNT",
    ]) {
      expect(normalizedAgents).toContain(code);
    }
  });
});
