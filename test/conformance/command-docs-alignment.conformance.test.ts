import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  getCommandMetadata,
  getDocumentedAgentMarkers,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";
import { NEXT_ACTION_WHEN_VALUES } from "../../src/types.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatJsonVariantDocLine(variant: string): string {
  const separator = ": ";
  const separatorIndex = variant.indexOf(separator);
  if (separatorIndex === -1) {
    throw new Error(`Invalid json variant '${variant}'.`);
  }

  const flag = variant.slice(0, separatorIndex);
  const payload = variant.slice(separatorIndex + separator.length);
  return normalizeWhitespace(`\`${flag}\` JSON payload: \`${payload}\``);
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
const SKILL = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
const SKILL_REFERENCE = readFileSync(
  `${CLI_ROOT}/skills/privacy-pools-cli/reference.md`,
  "utf8",
);
const AGENT_MARKERS = getDocumentedAgentMarkers();

describe("command docs alignment", () => {
  test("AGENTS command markers stay aligned with documented metadata", () => {
    for (const marker of AGENT_MARKERS) {
      expect(AGENTS).toContain(marker);
    }
  });

  test("AGENTS machine sections keep critical machine-contract anchors", () => {
    const expectations: Array<{ path: CommandPath; markers: string[] }> = [
      {
        path: "init",
        markers: ["setupMode", "readiness", "restoreDiscovery", "nextActions"],
      },
      { path: "activity", markers: ["reviewStatus"] },
      { path: "status", markers: ["recommendedMode", "nextActions"] },
      { path: "accounts", markers: ["balances", "nextActions"] },
      { path: "migrate status", markers: ["readiness"] },
      { path: "history", markers: ["events"] },
      { path: "sync", markers: ["syncedPools"] },
      { path: "withdraw quote", markers: ["relayTxCost"] },
    ];

    for (const expectation of expectations) {
      const marker = getCommandMetadata(expectation.path).agentsDocMarker;
      expect(typeof marker).toBe("string");
      const section = extractDocumentSection(AGENTS, marker!, AGENT_MARKERS);

      for (const field of expectation.markers) {
        expect(section).toContain(field);
      }
    }
  });

  test("AGENTS accounts variants keep executable nextActions guidance", () => {
    const metadata = getCommandMetadata("accounts");
    const marker = metadata.agentsDocMarker;
    expect(typeof marker).toBe("string");

    const section = extractDocumentSection(AGENTS, marker!, AGENT_MARKERS);
    const jsonVariants = metadata.help?.jsonVariants ?? [];
    const summaryVariant = jsonVariants.find((variant) =>
      variant.startsWith("--summary:"),
    );
    const pendingOnlyVariant = jsonVariants.find((variant) =>
      variant.startsWith("--pending-only:"),
    );

    expect(section).toContain(formatJsonVariantDocLine(summaryVariant!));
    expect(section).toContain(formatJsonVariantDocLine(pendingOnlyVariant!));
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

  test("AGENTS nextActions when table stays aligned with the typed contract", () => {
    for (const whenValue of NEXT_ACTION_WHEN_VALUES) {
      expect(AGENTS).toContain(`| \`${whenValue}\` |`);
    }
  });

  test("AGENTS keeps async submission examples aligned with the shipped contract", () => {
    const normalizedAgents = normalizeWhitespace(AGENTS);

    for (const requiredMarker of [
      "privacy-pools deposit 0.1 ETH --agent --no-wait",
      "privacy-pools withdraw --all ETH --to 0xRecipient --agent --no-wait",
      "privacy-pools broadcast ./signed-envelope.json --agent --no-wait",
      "privacy-pools tx-status <submissionId> --agent",
    ]) {
      expect(normalizedAgents).toContain(normalizeWhitespace(requiredMarker));
    }

    expect(AGENTS).not.toContain(
      "privacy-pools broadcast ./signed-envelope.json --agent\n",
    );
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

  test("skill doc keeps the current async agent orchestration contract", () => {
    const normalizedSkill = normalizeWhitespace(SKILL);

    for (const requiredMarker of [
      "privacy-pools flow status [workflowId|latest] --agent",
      "privacy-pools flow step [workflowId|latest] --agent",
      "privacy-pools tx-status <submissionId> --agent",
      "privacy-pools broadcast ./signed-envelope.json --agent --no-wait",
      "privacy-pools deposit 0.1 ETH --agent --no-wait",
      "privacy-pools withdraw --all ETH --to <addr> --agent --no-wait",
      "Agents should orchestrate saved workflows with `flow status` plus `flow step`.",
      "`flow status` is the canonical read-only polling surface and `flow step` is the canonical one-shot advance surface for agents.",
    ]) {
      expect(normalizedSkill).toContain(normalizeWhitespace(requiredMarker));
    }

    expect(normalizedSkill).not.toContain(
      normalizeWhitespace("flow watch is the canonical happy-path resume command"),
    );
  });

  test("skill reference keeps async submission and flow polling examples current", () => {
    const normalizedReference = normalizeWhitespace(SKILL_REFERENCE);

    for (const requiredMarker of [
      "privacy-pools broadcast ./signed-envelope.json --agent --no-wait",
      "cat ./signed-envelope.json | privacy-pools broadcast - --agent --no-wait",
      "privacy-pools tx-status <submissionId> --agent",
      "For agents, `flow status` is the read-only polling primitive and `flow step` is the one-shot advance primitive.",
    ]) {
      expect(normalizedReference).toContain(normalizeWhitespace(requiredMarker));
    }

    expect(SKILL_REFERENCE).not.toContain(
      "privacy-pools broadcast ./signed-envelope.json --agent\n",
    );
  });
});
