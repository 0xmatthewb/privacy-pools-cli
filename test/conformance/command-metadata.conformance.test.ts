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
  test("runtime command tree stays aligned with metadata paths, descriptions, and aliases", async () => {
    const runtimeCommands = collectRuntimeCommands(await createRootProgram("0.0.0"))
      .sort((left, right) => left.path.localeCompare(right.path));

    expect(runtimeCommands.map((entry) => entry.path)).toEqual([...COMMAND_PATHS].sort());

    for (const entry of runtimeCommands) {
      const metadata = getCommandMetadata(entry.path as (typeof COMMAND_PATHS)[number]);
      expect(entry.description).toBe(metadata.description);
      expect(entry.aliases).toEqual(metadata.aliases ?? []);
    }
  });

  test("capabilities payload stays derived from command metadata and execution metadata", () => {
    const payload = buildCapabilitiesPayload();

    for (const command of payload.commands) {
      const metadata = getCommandMetadata(command.name as (typeof COMMAND_PATHS)[number]);
      expect(command.description).toBe(metadata.description);
      expect(command.aliases ?? []).toEqual(metadata.aliases ?? []);
    }

    expect(payload.executionRoutes["pools"]).toEqual(getCommandExecutionMetadata("pools"));
    expect(payload.commandDetails["withdraw"]?.execution.owner).toBe("js-runtime");
    expect(payload.commandDetails["stats pool"]?.execution.owner).toBe("hybrid");
    expect(payload.commandDetails["capabilities"]?.execution.owner).toBe("native-shell");
    expect(payload.commandDetails["withdraw"]?.sideEffectClass).toBe("fund_movement");
    expect(payload.commandDetails["withdraw"]?.touchesFunds).toBe(true);
    expect(payload.commandDetails["withdraw"]?.requiresHumanReview).toBe(true);
    expect(payload.commandDetails["flow"]?.safeReadOnly).toBe(true);
    expect(payload.safeReadOnlyCommands).toContain("flow status");
  });

  test("root global flags stay aligned with metadata", async () => {
    const rootOptions = collectRootOptions(await createRootProgram("0.0.0"));
    const metadata = [...GLOBAL_FLAG_METADATA].sort((left, right) => left.flag.localeCompare(right.flag));

    expect(rootOptions).toEqual(metadata);
  });

  test("completion metadata hides internal plumbing flags", () => {
    const completion = buildCapabilitiesPayload().commands.find((command) => command.name === "completion");

    expect(completion).toBeDefined();
    expect(completion?.flags).toEqual(["[shell]", "--shell <shell>"]);
    expect(completion?.flags ?? []).not.toContain("--query");
    expect(completion?.flags ?? []).not.toContain("--cword <index>");
  });

  test("metadata preserves structural JSON variants for multi-mode commands", () => {
    const accountsJsonVariants = getCommandMetadata("accounts").help?.jsonVariants ?? [];
    const poolsJsonFields = getCommandMetadata("pools").help?.jsonFields ?? [];
    const poolsJsonVariants = (getCommandMetadata("pools").help?.jsonVariants ?? []).join(" ");
    const withdrawQuoteFields = getCommandMetadata("withdraw quote").help?.jsonFields ?? "";

    expect(accountsJsonVariants).toContain(
      "--summary: { chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
    );
    expect(accountsJsonVariants).toContain(
      "--pending-only: { chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
    );
    expect(poolsJsonFields).toContain("chain?");
    expect(poolsJsonFields).toContain("allChains?");
    expect(poolsJsonFields).toContain("chains?");
    expect(poolsJsonVariants).toContain("myFundsWarning");
    expect(poolsJsonVariants).toContain("recentActivity");
    expect(withdrawQuoteFields).toContain("baseFeeBPS");
    expect(withdrawQuoteFields).toContain("relayTxCost");
  });

  test("metadata examples keep canonical machine-mode usage and bundled-artifact guidance", () => {
    for (const path of [
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
    ] as const) {
      const examples = getCommandMetadata(path).help?.examples ?? [];
      expect(examples.join("\n")).not.toContain("--json");
    }

    const depositOverview = (getCommandMetadata("deposit").help?.overview ?? []).join(" ");
    const initOverview = (getCommandMetadata("init").help?.overview ?? []).join(" ");

    expect(depositOverview).toContain("bundled checksum-verified circuit artifacts");
    expect(depositOverview).not.toContain("npm run circuits:provision");
    expect(initOverview).toContain("bundled checksum-verified circuit artifacts");
    expect(initOverview).not.toContain("npm run circuits:provision");
  });
});
