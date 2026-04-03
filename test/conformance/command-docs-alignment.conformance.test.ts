import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  getCommandMetadata,
  getDocumentedAgentMarkers,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";
import { jsonContractDocRelativePath } from "../../src/utils/json.ts";
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
const REFERENCE = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
const SKILL_REFERENCE = readFileSync(
  `${CLI_ROOT}/skills/privacy-pools-cli/reference.md`,
  "utf8",
);
const README = readFileSync(`${CLI_ROOT}/README.md`, "utf8");
const JSON_CONTRACT = readFileSync(
  `${CLI_ROOT}/${jsonContractDocRelativePath()}`,
  "utf8",
);
const AGENT_MARKERS = getDocumentedAgentMarkers();

describe("command docs alignment", () => {
  test("AGENTS command markers stay aligned with documented metadata", () => {
    for (const marker of AGENT_MARKERS) {
      expect(AGENTS).toContain(marker);
    }
  });

  test("AGENTS command sections preserve required payload markers", () => {
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

  test("discovery docs keep the structural machine-contract anchors", () => {
    const capabilitiesSection = extractDocumentSection(SKILL_REFERENCE, "### `capabilities`", [
      "### `capabilities`",
      "### `init`",
    ]);
    const agentsCapabilitiesSection = extractDocumentSection(
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
      expect(agentsCapabilitiesSection).toContain(requiredMarker);
    }
  });

  test("reference docs keep the stable command and init contract anchors", () => {
    const normalizedReference = normalizeWhitespace(REFERENCE);
    const initAgentsSection = extractDocumentSection(AGENTS, "#### `init`", AGENT_MARKERS);
    const initReferenceSection = extractDocumentSection(REFERENCE, "### `init`", [
      "### `init`",
      "### `flow`",
    ]);

    expect(normalizedReference).toContain("privacy-pools capabilities --agent");
    expect(normalizedReference).toContain("privacy-pools describe withdraw quote --agent");
    expect(normalizedReference).toContain("### `describe`");
    expect(normalizedReference).toContain("--mnemonic-stdin");
    expect(normalizedReference).toContain("--private-key-stdin");
    expect(normalizedReference).toContain("--summary");
    expect(normalizedReference).toContain("--pending-only");
    expect(initAgentsSection).toContain("bundled checksum-verified circuit artifacts");
    expect(initReferenceSection).toContain("bundled checksum-verified circuit artifacts");
    expect(initAgentsSection).not.toContain("npm run circuits:provision");
    expect(initReferenceSection).not.toContain("npm run circuits:provision");
  });

  test("legacy migration and contract error codes remain documented for agents", () => {
    const normalizedAgents = normalizeWhitespace(AGENTS);
    const normalizedSkillReference = normalizeWhitespace(SKILL_REFERENCE);

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
      expect(normalizedSkillReference).toContain(code);
    }
  });

  test("flow status docs keep the saved-workflow prerequisite explicit", () => {
    const agentsFlowSection = extractDocumentSection(AGENTS, "#### `flow`", AGENT_MARKERS);
    const referenceFlowStatusSection = extractDocumentSection(REFERENCE, "### `flow status`", [
      "### `flow status`",
      "### `flow ragequit`",
    ]);
    const flowStatusMetadata = getCommandMetadata("flow status");

    expect(agentsFlowSection).toContain("saved workflow");
    expect(referenceFlowStatusSection).toContain("persisted workflow snapshot");
    expect((flowStatusMetadata.help?.overview ?? []).join(" ")).toContain("saved workflow");
  });

  test("README and shipped contract doc point at the current structured-output contract", () => {
    const normalizedReadme = normalizeWhitespace(README);

    expect(normalizedReadme).toContain("versioned envelope");
    expect(normalizedReadme).toContain("raw transaction array");
    expect(JSON_CONTRACT).toContain('"schemaVersion": "1.7.0"');
  });
});
