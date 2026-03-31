import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildCapabilitiesPayload,
  getCommandMetadata,
  getDocumentedAgentMarkers,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";
import { jsonContractDocRelativePath } from "../../src/utils/json.ts";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const JSON_CONTRACT_DOC_PATH = `${CLI_ROOT}/${jsonContractDocRelativePath()}`;

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
      {
        path: "status",
        markers: [
          "readyForDeposit",
          "readyForWithdraw",
          "recommendedMode",
          "blockingIssues",
          "warnings",
          "nextActions",
        ],
      },
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
      "executionRoutes",
      "protocol",
      "runtime",
      "safeReadOnlyCommands",
      "jsonOutputContract",
      "documentation",
      "agentGuide",
      "runtimeUpgrades",
      "jsonContract",
      "sideEffectClass",
      "requiresHumanReview",
      "preferredSafeVariant",
      "error.{ code, category, message, hint?, retryable? }",
      "Exception: --unsigned tx emits a raw transaction array without the envelope.",
    ]);

    const safeReadOnlyCommands = normalizedSection.match(
      /"safeReadOnlyCommands": \[(.*?)\]/,
    )?.[1];
    expect(safeReadOnlyCommands).toBeDefined();
    expect(safeReadOnlyCommands).toContain('"flow"');
    expect(safeReadOnlyCommands).toContain('"flow status"');
    expect(safeReadOnlyCommands).toContain('"migrate"');
    expect(safeReadOnlyCommands).toContain('"migrate status"');
    expect(normalizedSection).toContain("execution-ownership map");
    expect(normalizedSection).toContain("wallet-mutating safety");
    expect(normalizedSection).toContain(
      '"stats pool": { "owner": "hybrid", "nativeModes": ["default", "csv", "structured", "help"] }',
    );
  });

  test("AGENTS capabilities docs describe execution ownership separately from read-only safety", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const markers = getDocumentedAgentMarkers();
    const section = extractDocumentSection(agents, "#### `capabilities`", markers);
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain("executionRoutes");
    expect(normalizedSection).toContain("protocol");
    expect(normalizedSection).toContain("runtime");
    expect(normalizedSection).toContain("runtimeUpgrades");
    expect(normalizedSection).toContain("jsonContract");
    expect(normalizedSection).toContain("execution-ownership map");
    expect(normalizedSection).toContain("wallet-mutating safety");
  });

  test("skill reference accounts section documents unknown ASP status", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `accounts`", ["### `accounts`", "### `history`"]);
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain("aspStatus");
    expect(normalizedSection).toContain("\"unknown\"");
    expect(normalizedSection).toContain("spent or exited accounts");
  });

  test("AGENTS and skill reference error tables include current contract and legacy account codes", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedReference = normalizeWhitespace(reference);
    const requiredCodes = [
      "CONTRACT_UNKNOWN_STATE_ROOT",
      "CONTRACT_CONTEXT_MISMATCH",
      "CONTRACT_INVALID_COMMITMENT",
      "CONTRACT_NOT_YET_RAGEQUITTEABLE",
      "CONTRACT_MAX_TREE_DEPTH_REACHED",
      "CONTRACT_MINIMUM_DEPOSIT_AMOUNT",
      "CONTRACT_INVALID_DEPOSIT_VALUE",
      "CONTRACT_INVALID_WITHDRAWAL_AMOUNT",
      "CONTRACT_POOL_NOT_FOUND",
      "CONTRACT_POOL_IS_DEAD",
      "CONTRACT_RELAY_FEE_GREATER_THAN_MAX",
      "CONTRACT_INVALID_TREE_DEPTH",
      "CONTRACT_NATIVE_ASSET_TRANSFER_FAILED",
      "ACCOUNT_MIGRATION_REQUIRED",
      "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
    ];

    for (const code of requiredCodes) {
      expect(normalizedAgents).toContain(code);
      expect(normalizedReference).toContain(code);
    }

    expect(normalizedAgents).toContain("CONTRACT_UNKNOWN_STATE_ROOT");
    expect(normalizedAgents).toContain("run `sync --agent` first");
    expect(normalizedReference).toContain("CONTRACT_UNKNOWN_STATE_ROOT");
    expect(normalizedReference).toContain("run `privacy-pools sync --agent`, then retry");
  });

  test("skill reference migrate status example reflects the always-present coverage warning", () => {
    const reference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const section = extractDocumentSection(reference, "### `migrate status`", [
      "### `migrate status`",
      "### `history`",
    ]);
    const normalizedSection = normalizeWhitespace(section);

    expect(normalizedSection).toContain('"warnings": [');
    expect(normalizedSection).toContain('"category": "COVERAGE"');
    expect(normalizedSection).not.toContain('"warnings": []');
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

  test("bundled proof guidance keeps repo-only provisioning out of shipped init docs", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const markers = getDocumentedAgentMarkers();
    const agentsSection = extractDocumentSection(agents, "#### `init`", markers);
    const referenceSection = extractDocumentSection(reference, "### `init`", [
      "### `init`",
      "### `flow`",
    ]);
    const normalizedAgentsSection = normalizeWhitespace(agentsSection);
    const normalizedReferenceSection = normalizeWhitespace(referenceSection);
    const normalizedSkillReference = normalizeWhitespace(skillReference);

    expect(normalizedAgentsSection).toContain("bundled checksum-verified circuit artifacts");
    expect(normalizedAgentsSection).not.toContain("npm run circuits:provision");
    expect(normalizedReferenceSection).toContain("bundled checksum-verified circuit artifacts");
    expect(normalizedReferenceSection).not.toContain("npm run circuits:provision");
    expect(normalizedSkillReference).not.toContain("npm run circuits:provision");
  });

  test("development docs keep circuits provisioning scoped to source checkouts", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const staticSections = readFileSync(`${CLI_ROOT}/docs/reference-static-sections.md`, "utf8");
    const normalizedReference = normalizeWhitespace(reference);
    const normalizedStaticSections = normalizeWhitespace(staticSections);

    expect(normalizedReference).toContain("source checkout only: materialize bundled proof artifacts");
    expect(normalizedStaticSections).toContain("source checkout only: materialize bundled proof artifacts");
    expect(normalizedReference).toContain("node scripts/provision-circuits.mjs");
    expect(normalizedStaticSections).toContain("node scripts/provision-circuits.mjs");
  });

  test("README restore guidance stays aligned with the init recovery contract", () => {
    const readme = readFileSync(`${CLI_ROOT}/README.md`, "utf8");
    const normalizedReadme = normalizeWhitespace(readme);

    expect(normalizedReadme).toContain("init --mnemonic");
    expect(normalizedReadme).toContain("migrate status");
  });

  test("README machine contract stays aligned with current structured-output semantics", () => {
    const readme = readFileSync(`${CLI_ROOT}/README.md`, "utf8");
    const normalizedReadme = normalizeWhitespace(readme);

    expect(normalizedReadme).toContain("Most structured responses are wrapped in a versioned envelope");
    expect(normalizedReadme).toContain("--unsigned tx");
    expect(normalizedReadme).toContain("raw transaction array");
    expect(normalizedReadme).not.toContain("Every response is wrapped in a versioned envelope");
    expect(normalizedReadme).not.toContain('"schemaVersion": "1.5.0"');
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
    expect(normalizedSection).toContain("recommendedMode");
    expect(normalizedSection).toContain("blockingIssues");
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

  test("flow latest shorthand stays documented across the human reference", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const normalizedReference = normalizeWhitespace(reference);

    expect(normalizedReference).toContain("privacy-pools flow watch [workflowId|latest] [options]");
    expect(normalizedReference).toContain("privacy-pools flow status [workflowId|latest] [options]");
    expect(normalizedReference).toContain("privacy-pools flow ragequit [workflowId|latest] [options]");
  });

  test("flow docs and discovery metadata keep the privacy-delay agent surface aligned", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const flowStartMetadata = getCommandMetadata("flow start");
    const flowWatchMetadata = getCommandMetadata("flow watch");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedReference = normalizeWhitespace(reference);
    const normalizedSkillReference = normalizeWhitespace(skillReference);

    expect(flowStartMetadata.capabilities.agentFlags).toContain("--privacy-delay <profile>");
    expect(flowWatchMetadata.capabilities.agentFlags).toContain("--privacy-delay <profile>");
    expect(flowStartMetadata.help?.jsonFields).toContain("privacyDelayProfile");
    expect(flowWatchMetadata.help?.jsonFields).toContain("privacyDelayUntil");
    expect(normalizeWhitespace((flowWatchMetadata.help?.safetyNotes ?? []).join(" "))).toContain(
      "Passing --privacy-delay on flow watch updates the saved workflow policy",
    );
    expect(normalizedAgents).toContain("flow watch latest --privacy-delay aggressive --agent");
    expect(normalizedReference).toContain("--privacy-delay <profile>");
    expect(normalizedSkillReference).toContain("flow watch latest --privacy-delay aggressive --agent");
  });

  test("flow start docs pin the machine-mode privacy and backup safety rules", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const flowStartMetadata = getCommandMetadata("flow start");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedReference = normalizeWhitespace(reference);
    const normalizedSkill = normalizeWhitespace(skill);
    const normalizedSkillReference = normalizeWhitespace(skillReference);
    const normalizedSafetyNotes = normalizeWhitespace(
      (flowStartMetadata.help?.safetyNotes ?? []).join(" "),
    );

    expect(normalizedSafetyNotes).toContain("In machine modes, non-round flow amounts are rejected");
    expect(normalizedSafetyNotes).toContain("Non-interactive workflow wallets require --export-new-wallet");
    expect(normalizedAgents).toContain("Like `deposit`, `flow start` rejects non-round amounts in machine modes");
    expect(normalizedAgents).toContain("In non-interactive mode, `--export-new-wallet <path>` is required");
    expect(normalizedReference).toContain("In machine modes, non-round flow amounts are rejected");
    expect(normalizedReference).toContain("Non-interactive workflow wallets require --export-new-wallet");
    expect(normalizedSkill).toContain("`flow start` rejects non-round amounts in machine mode");
    expect(normalizedSkill).toContain("`flow start --new-wallet` requires `--export-new-wallet <path>` in machine mode");
    expect(normalizedSkillReference).toContain("it follows the same non-round amount privacy guard as `deposit`");
    expect(normalizedSkillReference).toContain("In machine mode, `--export-new-wallet <path>` is required");
  });

  test("flow ragequit docs keep the flow JSON contract aligned", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const flowRagequitMetadata = getCommandMetadata("flow ragequit");
    const referenceSection = extractDocumentSection(reference, "### `flow ragequit`", [
      "### `flow ragequit`",
      "### `pools`",
    ]);
    const normalizedSection = normalizeWhitespace(referenceSection);

    expect(flowRagequitMetadata.help?.jsonFields).toContain("privacyDelayProfile");
    expect(flowRagequitMetadata.help?.jsonFields).toContain("privacyDelayConfigured");
    expect(flowRagequitMetadata.help?.jsonFields).toContain("privacyDelayUntil|null");
    expect(normalizedSection).toContain("privacyDelayProfile");
    expect(normalizedSection).toContain("privacyDelayConfigured");
    expect(normalizedSection).toContain("privacyDelayUntil");
  });

  test("flow docs describe net received and match the null-heavy wire shape", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const flowStartMetadata = getCommandMetadata("flow start");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedReference = normalizeWhitespace(reference);
    const normalizedSkillReference = normalizeWhitespace(skillReference);
    const normalizedSafetyNotes = normalizeWhitespace(
      (flowStartMetadata.help?.safetyNotes ?? []).join(" "),
    );

    expect(normalizedAgents).toContain(
      "recipient receives the net amount after relayer fees and any ERC20 extra-gas funding",
    );
    expect(normalizedReference).toContain(
      "recipient receives the net amount after relayer fees and any ERC20 extra-gas funding",
    );
    expect(normalizedSkillReference).toContain(
      "recipient receives the net amount after relayer fees and any ERC20 extra-gas funding",
    );
    expect(flowStartMetadata.help?.jsonFields).toContain("walletAddress|null");
    expect(flowStartMetadata.help?.jsonFields).toContain("poolAccountId|null");
    expect(normalizedSafetyNotes).toContain(
      "recipient receives the net amount after relayer fees and any ERC20 extra-gas funding",
    );
  });

  test("skill examples omit empty warnings and default runnable flags", () => {
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");
    const flowSection = extractDocumentSection(skillReference, "Flow JSON payloads share this shape:", [
      "Flow JSON payloads share this shape:",
      "Possible `phase` values:",
    ]);
    const accountsSection = extractDocumentSection(skillReference, "Representative payload (abridged):", [
      "Representative payload (abridged):",
      "`status` values:",
    ]);

    expect(flowSection).not.toContain('"warnings": []');
    expect(flowSection).not.toContain('"runnable": true');
    expect(accountsSection).not.toContain('"warnings": []');
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
    const contract = readFileSync(JSON_CONTRACT_DOC_PATH, "utf8");
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
      "`--summary` JSON payload: `{ chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }`",
    );
    expect(normalizeWhitespace(agents)).toContain(
      "`--pending-only` JSON payload: `{ chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }`",
    );
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
      readFileSync(JSON_CONTRACT_DOC_PATH, "utf8"),
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

    expect(normalizedSkill).toContain("npm i -g privacy-pools-cli");
    expect(normalizedSkill).toContain("github:0xmatthewb/privacy-pools-cli");
    expect(normalizedReference).toContain("https://github.com/0xmatthewb/privacy-pools-cli");
    expect(normalizedSkill).toContain("For unreleased or source builds");
    expect(normalizedReference).not.toContain("npmjs.com/package/privacy-pools-cli");

    expect(normalizedSkill).toContain("RPC_RATE_LIMITED");
    expect(normalizedSkill).toContain("CONTRACT_NONCE_ERROR");
    expect(normalizedSkill).toContain("ACCOUNT_NOT_APPROVED");

    expect(normalizedReference).toContain("RPC_RATE_LIMITED");
    expect(normalizedReference).toContain("CONTRACT_INSUFFICIENT_FUNDS");
    expect(normalizedReference).toContain("CONTRACT_NONCE_ERROR");
    expect(normalizedReference).toContain("ACCOUNT_NOT_APPROVED");
  });

  test("upgrade docs stay aligned across AGENTS and skill reference", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");

    const agentsSection = extractDocumentSection(
      agents,
      "#### `upgrade`",
      getDocumentedAgentMarkers(),
    );
    const referenceSection = extractDocumentSection(
      skillReference,
      "### `upgrade`",
      ["### `upgrade`", "### `init`"],
    );

    const normalizedAgents = normalizeWhitespace(agentsSection);
    const normalizedReference = normalizeWhitespace(referenceSection);
    const normalizedSkill = normalizeWhitespace(skill);

    expect(normalizedSkill).toContain("privacy-pools upgrade --agent --check");
    expect(normalizedAgents).toContain("command|null");
    expect(normalizedAgents).toContain("installContext");
    expect(normalizedAgents).toContain("manual guidance");
    expect(normalizedAgents).not.toContain("Bun global installs");
    expect(normalizedReference).toContain("\"mode\": \"upgrade\"");
    expect(normalizedReference).toContain("\"status\": \"manual\"");
    expect(normalizedReference).toContain("\"installContext\"");
    expect(normalizedReference).toContain("\"command\"");
    expect(normalizedReference).toContain("manual guidance");
    expect(normalizedReference).not.toContain("Bun global installs");
  });

  test("reference and skill docs list the full supported env-var override surface", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");

    const requiredMarkers = [
      "PRIVACY_POOLS_RPC_URL",
      "PP_RPC_URL",
      "PRIVACY_POOLS_ASP_HOST",
      "PP_ASP_HOST",
      "PRIVACY_POOLS_RELAYER_HOST",
      "PP_RELAYER_HOST",
      "PRIVACY_POOLS_RPC_URL_<CHAIN>",
      "PRIVACY_POOLS_ASP_HOST_<CHAIN>",
      "PRIVACY_POOLS_RELAYER_HOST_<CHAIN>",
      "PP_RPC_URL_<CHAIN>",
      "PP_ASP_HOST_<CHAIN>",
      "PP_RELAYER_HOST_<CHAIN>",
      "PRIVACY_POOLS_CONFIG_DIR",
      "PRIVACY_POOLS_CLI_DISABLE_NATIVE",
      "PRIVACY_POOLS_CLI_BINARY",
      "PRIVACY_POOLS_CLI_JS_WORKER",
    ];

    for (const marker of requiredMarkers) {
      expect(reference).toContain(marker);
      expect(skill).toContain(marker);
      expect(skillReference).toContain(marker);
    }
  });

  test("reference and skill docs label launcher overrides as advanced maintainer controls", () => {
    const reference = readFileSync(`${CLI_ROOT}/docs/reference.md`, "utf8");
    const skill = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/SKILL.md`, "utf8");
    const skillReference = readFileSync(`${CLI_ROOT}/skills/privacy-pools-cli/reference.md`, "utf8");

    const requiredPhrases = [
      "Advanced maintainer override for the launcher target",
      "Advanced maintainer override for the JS worker entrypoint",
      "real packaged JS worker file",
    ];

    for (const phrase of requiredPhrases) {
      expect(reference).toContain(phrase);
      expect(skill).toContain(phrase);
      expect(skillReference).toContain(phrase);
    }
  });

  test("native capabilities help keeps agent usage examples syntactically clean", () => {
    const nativeManifest = JSON.parse(
      readFileSync(`${CLI_ROOT}/native/shell/generated/manifest.json`, "utf8"),
    ) as { capabilitiesHumanText: string };

    expect(nativeManifest.capabilitiesHumanText).toContain(
      "privacy-pools flow start <amount> <asset> --to <address> --agent [--privacy-delay <profile>] [--watch] [--new-wallet] [--export-new-wallet <path>]",
    );
    expect(nativeManifest.capabilitiesHumanText).toContain(
      "privacy-pools flow watch [workflowId|latest] --agent [--privacy-delay <profile>]",
    );
    expect(nativeManifest.capabilitiesHumanText).toContain(
      "privacy-pools flow status [workflowId|latest] --agent",
    );
    expect(nativeManifest.capabilitiesHumanText).toContain(
      "privacy-pools flow ragequit [workflowId|latest] --agent",
    );
    expect(nativeManifest.capabilitiesHumanText).toContain(
      "privacy-pools stats pool --asset <symbol|address> --agent",
    );
    expect(nativeManifest.capabilitiesHumanText).toContain(
      "privacy-pools describe <command...> --agent",
    );

    expect(nativeManifest.capabilitiesHumanText).not.toContain(
      "privacy-pools flow start <amount> <asset> --to <address> --agent --to <address>",
    );
    expect(nativeManifest.capabilitiesHumanText).not.toContain(
      "privacy-pools flow watch [workflowId|latest] --agent [workflowId|latest]",
    );
    expect(nativeManifest.capabilitiesHumanText).not.toContain(
      "privacy-pools flow status [workflowId|latest] --agent [workflowId|latest]",
    );
    expect(nativeManifest.capabilitiesHumanText).not.toContain(
      "privacy-pools flow ragequit [workflowId|latest] --agent [workflowId|latest]",
    );
    expect(nativeManifest.capabilitiesHumanText).not.toContain(
      "privacy-pools stats pool --asset <symbol|address> --agent --asset <symbol>",
    );
    expect(nativeManifest.capabilitiesHumanText).not.toContain(
      "privacy-pools describe <command...> --agent <command...>",
    );
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
