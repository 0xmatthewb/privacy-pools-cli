import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildCapabilitiesPayload,
  getCommandMetadata,
  getDocumentedAgentMarkers,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function expectContainsAll(section: string, markers: readonly string[]): void {
  for (const marker of markers) {
    expect(section).toContain(marker);
  }
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

describe("command docs alignment", () => {
  test("AGENTS command catalog markers stay aligned with documented command metadata", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");

    for (const marker of getDocumentedAgentMarkers()) {
      expect(agents).toContain(marker);
    }
  });

  test("AGENTS documented payload docs preserve curated payload markers", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const markers = getDocumentedAgentMarkers();
    const expectations: Array<{ path: CommandPath; markers: string[] }> = [
      { path: "init", markers: ["signerKeySet", "recoveryPhraseRedacted", "nextActions"] },
      { path: "activity", markers: ["events", "reviewStatus", "chainFiltered"] },
      { path: "stats global", markers: ["perChain", "cacheTimestamp", "allTime"] },
      { path: "stats pool", markers: ["cacheTimestamp", "allTime", "last24h"] },
      { path: "status", markers: ["readyForDeposit", "readyForWithdraw", "nextActions"] },
      { path: "accounts", markers: ["balances", "pendingCount", "nextActions"] },
      { path: "history", markers: ["events", "poolAccountId", "explorerUrl"] },
      {
        path: "sync",
        markers: ["syncedPools", "availablePoolAccounts", "previousAvailablePoolAccounts"],
      },
    ];

    for (const expectation of expectations) {
      const marker = getCommandMetadata(expectation.path).agentsDocMarker;
      expect(marker).toBeDefined();
      const section = normalizeWhitespace(extractDocumentSection(agents, marker!, markers));
      expectContainsAll(section, expectation.markers);
    }
  });

  test("skill reference capabilities example stays explicitly abridged and aligned", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `capabilities`", ["### `capabilities`", "### `init`"]);
    const normalizedSection = normalizeWhitespace(section);
    const payload = buildCapabilitiesPayload();
    const deposit = payload.commands.find((command) => command.name === "deposit");
    const agentFlag = payload.globalFlags.find((flag) => flag.flag === "--agent");
    const flowWorkflowStep =
      payload.agentWorkflow.find((step) => step.includes("flow start")) ?? "";
    const manualPollingStep =
      payload.agentWorkflow.find((step) =>
        step.includes("accounts --agent --chain <chain> --pending-only"),
      ) ?? "";

    expect(normalizedSection).toContain("Representative payload (abridged):");
    expect(normalizedSection).toContain(deposit?.description ?? "");
    expect(normalizedSection).toContain(agentFlag?.description ?? "");
    expectContainsAll(normalizedSection, [
      normalizeWhitespace(flowWorkflowStep),
      normalizeWhitespace(manualPollingStep),
      payload.agentNotes?.statusCheck ?? "",
      "safeReadOnlyCommands",
      "jsonOutputContract",
      "documentation",
      "agentGuide",
      "error.{ code, category, message, hint?, retryable? }",
      "Exception: --unsigned tx emits a raw transaction array without the envelope.",
    ]);

    const safeReadOnlyCommands = normalizedSection.match(
      /"safeReadOnlyCommands": \[(.*?)\]/,
    )?.[1];
    expect(safeReadOnlyCommands).toBeDefined();
    expect(safeReadOnlyCommands).not.toContain('"flow"');
    expect(safeReadOnlyCommands).toContain('"flow status"');
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

  test("human reference documents init stdin flags, compact accounts modes, and describe", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const normalizedReference = normalizeWhitespace(reference);

    expect(normalizedReference).toContain("--mnemonic-stdin");
    expect(normalizedReference).toContain("--private-key-stdin");
    expect(normalizedReference).toContain("--summary");
    expect(normalizedReference).toContain("--pending-only");
    expect(reference).toContain("### `describe`");
  });

  test("human reference uses canonical --agent examples for discovery commands", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const normalizedReference = normalizeWhitespace(reference);

    expect(normalizedReference).toContain("privacy-pools capabilities --agent");
    expect(normalizedReference).toContain("privacy-pools describe withdraw quote --agent");
    expect(normalizedReference).toContain("privacy-pools describe stats global --agent");
  });

  test("AGENTS preflight guidance uses the same signer readiness contract as status metadata", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const section = extractDocumentSection(agents, "## Preflight Check", [
      "## Preflight Check",
      "## Human + Agent Workflow",
    ]);
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain("signerKeyValid: true");
    expect(normalizedSection).toContain("readyForDeposit: true");
    expect(normalizedSection).not.toContain("signerKeySet: true");
  });

  test("skill reference keeps pool default-sort examples aligned with runtime defaults", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `pools`", ["### `pools`", "### `activity`"]);
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain("Default sort is `tvl-desc`");
    expect(normalizedSection).toContain("\"sort\": \"tvl-desc\"");
    expect(normalizedSection).not.toContain("\"sort\": \"default\"");
  });

  test("skill reference unsigned docs describe the configured default-chain behavior", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const normalizedReference = normalizeWhitespace(reference);

    expect(normalizedReference).toContain("default: your configured default chain");
    expect(normalizedReference).not.toContain("default: `mainnet`, chain ID 1");
  });

  test("flow status docs and discovery metadata keep the saved-workflow prerequisite explicit", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const flowMetadata = getCommandMetadata("flow");
    const flowStatusMetadata = getCommandMetadata("flow status");
    const agentsSection = extractDocumentSection(agents, "#### `flow`", getDocumentedAgentMarkers());
    const referenceSection = extractDocumentSection(reference, "### `flow status`", [
      "### `flow status`",
      "### `flow ragequit`",
    ]);

    expect(normalizeWhitespace(agentsSection)).toContain(
      "`flow status` is read-only and works as long as a saved workflow snapshot already exists locally",
    );
    expect(normalizeWhitespace(referenceSection)).toContain(
      "does not require init if the saved workflow already exists locally",
    );
    expect(flowMetadata.help?.prerequisites).toBe(
      "init for start/watch/ragequit; saved workflow for status",
    );
    expect(flowStatusMetadata.help?.prerequisites).toBe(
      "saved workflow (usually created after init)",
    );
    expect(flowStatusMetadata.capabilities.requiresInit).toBe(false);
  });

  test("flow watch docs explain the external-timeout expectation for agents", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const flowWatchMetadata = getCommandMetadata("flow watch");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedReference = normalizeWhitespace(reference);
    const normalizedSkill = normalizeWhitespace(skill);
    const normalizedSkillReference = normalizeWhitespace(skillReference);

    expect(normalizeWhitespace((flowWatchMetadata.help?.overview ?? []).join(" "))).toContain(
      "flow watch is intentionally unbounded",
    );
    expect(normalizeWhitespace((flowWatchMetadata.help?.agentWorkflowNotes ?? []).join(" "))).toContain(
      "wrap the CLI call in your own external timeout",
    );
    expect(normalizedAgents).toContain("is intentionally unbounded");
    expect(normalizedAgents).toContain("external timeout");
    expect(normalizedReference).toContain("is intentionally unbounded");
    expect(normalizedReference).toContain("external timeout");
    expect(normalizedSkill).toContain("is intentionally unbounded");
    expect(normalizedSkill).toContain("external timeout");
    expect(normalizedSkillReference).toContain("is intentionally unbounded");
    expect(normalizedSkillReference).toContain("external timeout");
  });

  test("human reference documents the stats global chain restriction", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `stats global`", [
      "### `stats global`",
      "### `stats pool`",
    ]);

    expect(normalizeWhitespace(section)).toContain(
      "The --chain flag is not supported; use stats pool --asset <symbol> --chain <chain> for chain-specific data",
    );
  });

  test("AGENTS deposit section documents the non-round deposit privacy guard", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const section = extractDocumentSection(agents, "#### `deposit`", getDocumentedAgentMarkers());
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain("non-round");
    expect(normalizedSection).toContain("--ignore-unique-amount");
    expect(normalizedSection).toContain("machine modes");
  });

  test("withdraw docs stay aligned on relayer-minimum remainder guidance", () => {
    const withdrawNotes = getCommandMetadata("withdraw").help?.safetyNotes ?? [];
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");

    expect(withdrawNotes).toContain(
      "Relayed withdrawals must also respect the relayer minimum. If a withdrawal would leave a positive remainder below that minimum, the CLI warns so you can withdraw less, use --all/100%, or choose a public recovery path later.",
    );
    expect(normalizeWhitespace(agents)).toContain("leave a positive remainder below the relayer minimum");
    expect(normalizeWhitespace(reference)).toContain("leave a positive remainder below that minimum");
    expect(normalizeWhitespace(skillReference)).toContain("leave a positive remainder below the relayer minimum");
  });

  test("deposit polling guidance preserves chain scope across metadata and skill docs", () => {
    const depositNotes = getCommandMetadata("deposit").help?.agentWorkflowNotes ?? [];
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const contract = readFileSync(
      `${CLI_ROOT}/docs/contracts/cli-json-contract.v1.5.0.json`,
      "utf8",
    );
    const normalizedSkill = normalizeWhitespace(skill);
    const normalizedContract = normalizeWhitespace(contract);

    expect(depositNotes).toContain(
      `Poll accounts --chain <chain> --pending-only while the Pool Account remains pending; when it disappears from pending results, re-run accounts --chain <chain> to confirm whether aspStatus became approved, declined, or requires Proof of Association. Withdraw only after approval; ragequit if declined; complete Proof of Association at ${POA_PORTAL_URL} first if needed. Always preserve the same --chain scope for both polling and confirmation.`,
    );
    expect(normalizedSkill).toContain(
      "privacy-pools accounts --agent --chain <chain> --pending-only",
    );
    expect(normalizedSkill).toContain("preserve --chain");
    expect(reference).toContain("### `accounts`");
    expect(normalizedContract).toContain(
      "poll accounts --chain <chain> --pending-only while the Pool Account remains pending; then confirm whether it was approved, declined, or poi_required before choosing withdraw or ragequit",
    );
  });

  test("agent discovery and guide preserve chain scope for approval checks", () => {
    const payload = buildCapabilitiesPayload();
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedWorkflowStep = normalizeWhitespace(
      payload.agentWorkflow.find((step) =>
        step.includes("accounts --agent --chain <chain> --pending-only"),
      ) ?? "",
    );
    const statusCheck = payload.agentNotes?.statusCheck ?? "";

    expect(normalizedWorkflowStep).toContain("accounts --agent --chain <chain> --pending-only");
    expect(normalizedWorkflowStep).toContain(
      "confirm approved vs declined vs poi_required with accounts --agent --chain <chain>",
    );
    expect(statusCheck).toContain("accounts --agent --chain <chain>");
    expect(statusCheck).toContain("default multi-chain mainnet dashboard");
    expect(normalizedAgents).toContain(
      "privacy-pools accounts --agent --chain <chain> --pending-only (to verify the deposit landed; preserve chain scope)",
    );
    expect(normalizedAgents).toContain(
      "suggest running `privacy-pools accounts --agent --chain <chain>` to check `aspStatus`, preserving the same chain scope used for the withdrawal attempt.",
    );
  });

  test("published agent guide documents stdout exceptions explicitly", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const normalizedAgents = normalizeWhitespace(agents);

    expect(normalizedAgents).toContain("Human-readable command output goes to");
    expect(normalizedAgents).toContain("built-in help, welcome, and shell completion text");
    expect(normalizedAgents).toContain("which write to");
  });

  test("accounts examples use explicit chain scope for pending-only polling", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const accountsExamples = getCommandMetadata("accounts").help?.examples ?? [];

    expect(accountsExamples).toContain("privacy-pools accounts --chain <name> --pending-only");
    expect(normalizeWhitespace(agents)).toContain(
      "privacy-pools accounts --agent --chain <chain> --pending-only",
    );
    expect(normalizeWhitespace(reference)).toContain(
      "privacy-pools accounts --chain <name> --pending-only",
    );
  });

  test("sync docs do not promise nextActions that the runtime does not emit", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const contract = JSON.parse(
      readFileSync(`${CLI_ROOT}/docs/contracts/cli-json-contract.v1.5.0.json`, "utf8"),
    ) as {
      commands?: { sync?: { successFields?: Record<string, string> } };
    };
    const syncJsonFields = getCommandMetadata("sync").help?.jsonFields ?? "";
    const agentsSection = extractDocumentSection(agents, "#### `sync`", getDocumentedAgentMarkers());
    const skillSection = extractDocumentSection(
      skillReference,
      "### `sync`",
      ["### `sync`", "## Environment variables"],
    );

    expect(syncJsonFields).not.toContain("nextActions");
    expect(normalizeWhitespace(agentsSection)).not.toContain("nextActions");
    expect(normalizeWhitespace(skillSection)).not.toContain("nextActions");
    expect(contract.commands?.sync?.successFields).not.toHaveProperty("nextActions");
  });

  test("skill docs stay aligned on current error handling and install source", () => {
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const normalizedSkill = normalizeWhitespace(skill);
    const normalizedReference = normalizeWhitespace(reference);

    expect(normalizedSkill).toContain("github:0xmatthewb/privacy-pools-cli");
    expect(normalizedReference).toContain("https://github.com/0xmatthewb/privacy-pools-cli");
    expect(normalizedSkill).not.toContain("privacy-pools-cli on npm");
    expect(normalizedReference).not.toContain("npmjs.com/package/privacy-pools-cli");

    expect(normalizedSkill).toContain("RPC_RATE_LIMITED");
    expect(normalizedSkill).toContain("CONTRACT_NONCE_ERROR");
    expect(normalizedSkill).toContain("ACCOUNT_NOT_APPROVED");

    expect(normalizedReference).toContain("RPC_RATE_LIMITED");
    expect(normalizedReference).toContain("CONTRACT_INSUFFICIENT_FUNDS");
    expect(normalizedReference).toContain("CONTRACT_NONCE_ERROR");
    expect(normalizedReference).toContain("ACCOUNT_NOT_APPROVED");
  });

  test("published docs do not contain malformed privacy-pools command examples", () => {
    const docsToCheck = [
      `${CLI_ROOT}/AGENTS.md`,
      `${CLI_ROOT}/docs/reference.md`,
      `${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`,
      `${CLI_ROOT}/skills/privacy-pools-cli/reference.md`,
    ];

    for (const docPath of docsToCheck) {
      const document = readFileSync(docPath, "utf8");
      const malformed = document.match(/\bprivacy-pools[a-z]/g) ?? [];
      expect(malformed, docPath).toEqual([]);
    }
  });
});
