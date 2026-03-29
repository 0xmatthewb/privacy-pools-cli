import { describe, expect, test } from "bun:test";
import type { Command, Option } from "commander";
import { createRootProgram } from "../../src/program.ts";
import {
  buildCapabilitiesPayload,
  COMMAND_PATHS,
  getCommandExecutionMetadata,
  getCommandMetadata,
  GLOBAL_FLAG_METADATA,
} from "../../src/utils/command-metadata.ts";

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

describe("command metadata conformance", () => {
  test("runtime command tree matches command metadata paths, descriptions, and aliases", async () => {
    const runtimeCommands = collectRuntimeCommands(await createRootProgram("0.0.0"))
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
    expect(payload.commandDetails["status"]?.execution.owner).toBe("js-runtime");
    expect(payload.commandDetails["capabilities"]?.execution.owner).toBe("native-shell");
    expect(payload.commandDetails["stats pool"]?.execution.owner).toBe("hybrid");
    expect(payload.executionRoutes["pools"]).toEqual(
      getCommandExecutionMetadata("pools"),
    );
    expect(payload.commandDetails["withdraw"]?.sideEffectClass).toBe("fund_movement");
    expect(payload.commandDetails["withdraw"]?.touchesFunds).toBe(true);
    expect(payload.commandDetails["withdraw"]?.requiresHumanReview).toBe(true);
    expect(payload.commandDetails["withdraw"]?.preferredSafeVariant).toEqual({
      command: "withdraw quote",
      reason: "Check relayer fees and confirm the withdrawal inputs before submitting.",
    });
    expect(payload.commandDetails["flow"]?.sideEffectClass).toBe("read_only");
    expect(payload.commandDetails["flow"]?.touchesFunds).toBe(false);
    expect(payload.commandDetails["flow"]?.requiresHumanReview).toBe(false);
    expect(payload.commandDetails["flow"]?.preferredSafeVariant).toBeUndefined();
    expect(payload.commandDetails["deposit"]?.preferredSafeVariant?.command).toBe("pools");
    expect(payload.commandDetails["init"]?.sideEffectClass).toBe("local_state_write");
    expect(payload.commandDetails["init"]?.touchesFunds).toBe(false);
    expect(payload.commandDetails["init"]?.requiresHumanReview).toBe(true);
    expect(payload.commandDetails["guide"]?.sideEffectClass).toBe("read_only");
    expect(payload.commandDetails["flow"]?.safeReadOnly).toBe(true);
    expect(payload.commandDetails["flow status"]?.safeReadOnly).toBe(true);
    expect(payload.commandDetails["guide"]?.safeReadOnly).toBe(true);
    expect(payload.commandDetails["completion"]?.safeReadOnly).toBe(true);
    expect(payload.safeReadOnlyCommands).toContain("flow");
    expect(payload.safeReadOnlyCommands).toContain("flow status");
    expect(payload.safeReadOnlyCommands).toContain("guide");
    expect(payload.safeReadOnlyCommands).toContain("completion");
  });

  test("root global flags match capabilities metadata", async () => {
    const rootOptions = collectRootOptions(await createRootProgram("0.0.0"));
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

  test("command metadata keeps discovery and contract text aligned with --agent mode", () => {
    const payload = buildCapabilitiesPayload();
    const statsExamples = payload.commandDetails["stats"]?.examples ?? [];
    const guideDescriptor = payload.commandDetails["guide"];

    expect(statsExamples).toContain("privacy-pools stats pool --asset USDC --agent --chain mainnet");
    expect(payload.jsonOutputContract).toContain("--json or --agent");
    expect(guideDescriptor?.examples ?? []).toContain("privacy-pools guide --agent");
    expect(guideDescriptor?.jsonFields).toBe('{ mode: "help", help }');
    expect(payload.agentNotes?.statusCheck).toContain("recommendedMode");
    expect(payload.agentNotes?.statusCheck).toContain("blockingIssues[]");
  });

  test("command metadata examples prefer canonical --agent usage", () => {
    const agentExamplePaths = [
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
    ] as const;

    for (const path of agentExamplePaths) {
      const examples = getCommandMetadata(path).help?.examples ?? [];
      expect(examples.join("\n")).not.toContain("--json");
    }
  });

  test("proof metadata copy stays aligned with bundled circuit guidance", () => {
    const depositOverview = (getCommandMetadata("deposit").help?.overview ?? []).join(" ");
    const initOverview = (getCommandMetadata("init").help?.overview ?? []).join(" ");

    expect(depositOverview).toContain("bundled checksum-verified circuit artifacts");
    expect(depositOverview).toContain("no runtime download step");
    expect(depositOverview).toContain("10-30s");
    expect(initOverview).toContain("bundled checksum-verified circuit artifacts");
    expect(initOverview).not.toContain("npm run circuits:provision");
  });
});
