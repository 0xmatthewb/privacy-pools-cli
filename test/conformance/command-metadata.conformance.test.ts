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
    const poolsJsonVariants = getCommandMetadata("pools").help?.jsonVariants ?? [];

    expect(withdraw?.flags ?? []).toContain("--all");
    expect(withdraw?.flags ?? []).toContain("--extra-gas");
    expect(withdraw?.flags ?? []).toContain("--no-extra-gas");
    expect(history?.expectedLatencyClass).toBe("slow");
    expect(poolsJsonFields).toContain("chain?");
    expect(poolsJsonFields).toContain("allChains?");
    expect(poolsJsonFields).toContain("chains?");
    expect(poolsJsonVariants.join(" ")).toContain("myFundsWarning");
    expect(poolsJsonVariants.join(" ")).toContain("recentActivity");
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
    expect(normalizedSection).toContain("documentation");
    expect(normalizedSection).toContain("agentGuide");
    expect(normalizedSection).toContain("error.{ code, category, message, hint?, retryable? }");
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

  test("command metadata keeps discovery and contract text aligned with --agent mode", () => {
    const payload = buildCapabilitiesPayload();
    const statsExamples = payload.commandDetails["stats"]?.examples ?? [];
    const guideDescriptor = payload.commandDetails["guide"];

    expect(statsExamples).toContain("privacy-pools stats pool --asset USDC --agent --chain mainnet");
    expect(payload.jsonOutputContract).toContain("--json or --agent");
    expect(guideDescriptor?.examples ?? []).toContain("privacy-pools guide --agent");
    expect(guideDescriptor?.jsonFields).toBe('{ mode: "help", help }');
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
    const normalizedReference = normalizeWhitespace(reference);
    const normalizedContract = normalizeWhitespace(contract);

    expect(depositNotes).toContain(
      "Poll accounts --chain <chain> --pending-only while the Pool Account remains pending; when it disappears from pending results, re-run accounts --chain <chain> to confirm whether aspStatus became approved, declined, or requires Proof of Association. Withdraw only after approval; ragequit if declined; complete Proof of Association at tornado.0xbow.io first if needed. Always preserve the same --chain scope for both polling and confirmation.",
    );
    expect(normalizedSkill).toContain(
      "privacy-pools accounts --agent --chain <chain> --pending-only",
    );
    expect(normalizedSkill).toContain("preserve --chain");
    // reference.md is now auto-generated from command metadata and does not
    // include agentWorkflowNotes; chain scope guidance lives in SKILL.md,
    // AGENTS.md, and the JSON contract instead.
    expect(normalizedContract).toContain(
      "poll accounts --chain <chain> --pending-only while the Pool Account remains pending; then confirm whether it was approved, declined, or poi_required before choosing withdraw or ragequit",
    );
  });

  test("agent discovery and guide preserve chain scope for approval checks", () => {
    const payload = buildCapabilitiesPayload();
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const normalizedAgents = normalizeWhitespace(agents);
    const normalizedWorkflowStep = normalizeWhitespace(payload.agentWorkflow[4] ?? "");
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

  test("agent-facing docs and metadata prefer canonical --agent examples", () => {
    const agentExamplePaths: CommandPath[] = [
      "init",
      "pools",
      "activity",
      "stats global",
      "stats pool",
      "status",
      "capabilities",
      "describe",
      "deposit",
      "withdraw quote",
      "accounts",
      "history",
      "sync",
    ];

    for (const path of agentExamplePaths) {
      const examples = getCommandMetadata(path).help?.examples ?? [];
      expect(examples.join("\n")).not.toContain("--json");
    }
  });

  test("published agent guide documents stdout exceptions explicitly", () => {
    const agents = readFileSync(`${CLI_ROOT}/AGENTS.md`, "utf8");
    const normalizedAgents = normalizeWhitespace(agents);

    expect(normalizedAgents).toContain("Human-readable command output goes to");
    expect(normalizedAgents).toContain("built-in help, welcome, and shell completion text");
    expect(normalizedAgents).toContain("which write to");
  });

  test("proof provisioning copy stays aligned on first-run timing", () => {
    const depositOverview = normalizeWhitespace(
      (getCommandMetadata("deposit").help?.overview ?? []).join(" "),
    );

    expect(depositOverview).toContain("(~60s)");
    expect(depositOverview).not.toContain("(~30s)");
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
