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
  aliases: string[];
}

function collectRuntimeCommands(command: Command, prefix: string = ""): RuntimeCommandEntry[] {
  const entries: RuntimeCommandEntry[] = [];

  for (const subcommand of command.commands) {
    const path = prefix ? `${prefix} ${subcommand.name()}` : subcommand.name();
    entries.push({
      path,
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
  test("runtime command tree stays aligned with metadata paths and aliases", async () => {
    const runtimeCommands = collectRuntimeCommands(await createRootProgram("0.0.0"))
      .sort((left, right) => left.path.localeCompare(right.path));

    expect(runtimeCommands.map((entry) => entry.path)).toEqual([...COMMAND_PATHS].sort());

    for (const entry of runtimeCommands) {
      const metadata = getCommandMetadata(entry.path as (typeof COMMAND_PATHS)[number]);
      expect(entry.aliases).toEqual(metadata.aliases ?? []);
    }
  });

  test("capabilities payload stays derived from command metadata and execution metadata", () => {
    const payload = buildCapabilitiesPayload();

    for (const command of payload.commands) {
      const metadata = getCommandMetadata(command.name as (typeof COMMAND_PATHS)[number]);
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
    const summaryVariant = accountsJsonVariants.find((variant) =>
      variant.startsWith("--summary:")
    );
    const pendingOnlyVariant = accountsJsonVariants.find((variant) =>
      variant.startsWith("--pending-only:")
    );

    expect(summaryVariant).toBeDefined();
    expect(summaryVariant).toContain("approvedCount");
    expect(summaryVariant).toContain("balances");
    expect(summaryVariant).toContain("nextActions");
    expect(summaryVariant).toContain("cliCommand");

    expect(pendingOnlyVariant).toBeDefined();
    expect(pendingOnlyVariant).toContain("accounts");
    expect(pendingOnlyVariant).toContain("pendingCount");
    expect(pendingOnlyVariant).toContain("nextActions");
    expect(pendingOnlyVariant).toContain("cliCommand");

    expect(poolsJsonFields).toContain("chain?");
    expect(poolsJsonFields).toContain("allChains?");
    expect(poolsJsonFields).toContain("chains?");
    expect(poolsJsonFields).toContain("decimals");
    expect(poolsJsonFields).toContain("minimumDeposit");
    expect(poolsJsonFields).toContain("vettingFeeBPS");
    expect(poolsJsonFields).toContain("maxRelayFeeBPS");
    expect(poolsJsonFields).toContain("acceptedDepositsCount");
    expect(poolsJsonFields).toContain("pendingDepositsCount");
    expect(poolsJsonFields).toContain("growth24h");
    expect(poolsJsonFields).toContain("pendingGrowth24h");
    expect(poolsJsonFields).toContain("nextActions");
    expect(poolsJsonFields).toContain("cliCommand");
    expect(poolsJsonVariants).toContain("myFundsWarning");
    expect(poolsJsonVariants).toContain("recentActivity");
    expect(withdrawQuoteFields).toContain("baseFeeBPS");
    expect(withdrawQuoteFields).toContain("relayTxCost");
  });
});
