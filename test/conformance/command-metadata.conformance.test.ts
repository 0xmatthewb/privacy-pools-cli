import { describe, expect, test } from "bun:test";
import type { Command, Option } from "commander";
import { createRootProgram } from "../../src/program.ts";
import {
  buildCapabilitiesPayload,
  CAPABILITIES_SCHEMAS,
  CAPABILITY_ENV_VARS,
  CAPABILITY_EXIT_CODES,
  COMMAND_PATHS,
  getCommandExecutionMetadata,
  getCommandMetadata,
  GLOBAL_FLAG_METADATA,
  listCommandPaths,
} from "../../src/utils/command-metadata.ts";
import { buildCommandDescriptor } from "../../src/utils/command-discovery-metadata.ts";
import { ROOT_GLOBAL_FLAG_METADATA } from "../../src/utils/root-global-flags.ts";
import { NEXT_ACTION_WHEN_VALUES } from "../../src/types.ts";

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

    expect(runtimeCommands.map((entry) => entry.path)).toEqual([
      ...COMMAND_PATHS,
      "pools list",
      "pools ls",
      "stats global",
      "stats pool",
    ].sort());

    for (const entry of runtimeCommands) {
      if (entry.path === "pools list" || entry.path === "pools ls") {
        expect(entry.aliases).toEqual([]);
        continue;
      }
      if (
        entry.path === "protocol-stats"
        || entry.path === "pool-stats"
        || entry.path === "stats global"
        || entry.path === "stats pool"
      ) {
        expect(entry.aliases).toEqual([]);
        continue;
      }
      const metadata = getCommandMetadata(entry.path as (typeof COMMAND_PATHS)[number]);
      expect(entry.aliases).toEqual(metadata.aliases ?? []);
    }

    expect(runtimeCommands.some((entry) => entry.path === "stats")).toBe(true);
    expect(runtimeCommands.some((entry) => entry.path === "stats global")).toBe(true);
    expect(runtimeCommands.some((entry) => entry.path === "stats pool")).toBe(true);
  });

  test("capabilities payload stays derived from command metadata and execution metadata", () => {
    const payload = buildCapabilitiesPayload();

    for (const command of payload.commands) {
      const metadata = getCommandMetadata(command.name as (typeof COMMAND_PATHS)[number]);
      expect(command.aliases ?? []).toEqual(metadata.aliases ?? []);
    }

    expect(payload.executionRoutes["pools"]).toEqual(getCommandExecutionMetadata("pools"));
    expect(payload.commandDetails["withdraw"]?.execution.owner).toBe("js-runtime");
    expect(payload.commandDetails["pool-stats"]?.execution.owner).toBe("hybrid");
    expect(payload.commandDetails["capabilities"]?.execution.owner).toBe("native-shell");
    expect(payload.commandDetails["withdraw"]?.sideEffectClass).toBe("fund_movement");
    expect(payload.commandDetails["withdraw"]?.touchesFunds).toBe(true);
    expect(payload.commandDetails["withdraw"]?.requiresHumanReview).toBe(true);
    expect(payload.commandDetails["flow"]?.safeReadOnly).toBe(true);
    expect(payload.commandDetails["flow"]?.expectedNextActionWhen).toEqual([
      "after_dry_run",
      "transfer_resume",
      "transfer_ragequit_required",
      "transfer_declined",
      "transfer_ragequit_pending",
      "transfer_ragequit_optional",
      "transfer_manual_followup",
    ]);
    expect(payload.commandDetails["flow start"]?.expectedNextActionWhen).toEqual(
      payload.commandDetails["flow"]?.expectedNextActionWhen,
    );
    expect(payload.safeReadOnlyCommands).toContain("flow status");
    expect(payload.safeReadOnlyCommands).toContain("protocol-stats");
    expect(payload.safeReadOnlyCommands).toContain("pool-stats");
    expect(payload.safeReadOnlyCommands).not.toContain("stats");
    expect(payload.exitCodes).toEqual(CAPABILITY_EXIT_CODES);
    for (const exitCode of payload.exitCodes) {
      expect(exitCode.name).toBe(exitCode.errorCode);
    }
    expect(payload.envVars).toEqual(CAPABILITY_ENV_VARS);
    expect(CAPABILITIES_SCHEMAS.nextActions?.whenValues).toEqual([
      ...NEXT_ACTION_WHEN_VALUES,
    ]);
  });

  test("root global flags stay aligned with metadata", async () => {
    const rootOptions = collectRootOptions(await createRootProgram("0.0.0"));
    const metadata = ROOT_GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({
      flag,
      description,
    })).sort((left, right) => left.flag.localeCompare(right.flag));

    expect(rootOptions).toEqual(metadata);
  });

  test("hidden compatibility aliases stay out of primary capabilities discovery", () => {
    const payload = buildCapabilitiesPayload();

    expect(listCommandPaths()).not.toContain("stats");
    expect(payload.commands.map((command) => command.name)).not.toContain("stats");
    expect(Object.keys(payload.commandDetails)).not.toContain("stats");
  });

  test("completion metadata hides internal plumbing flags", () => {
    const completion = buildCapabilitiesPayload().commands.find((command) => command.name === "completion");

    expect(completion?.flags).toEqual(["[shell]", "--shell <shell>", "--install"]);
    expect(completion?.flags ?? []).not.toContain("--query");
    expect(completion?.flags ?? []).not.toContain("--cword <index>");
  });

  test("metadata preserves structural JSON variants for multi-mode commands", () => {
    const accountsJsonVariants = getCommandMetadata("accounts").help?.jsonVariants ?? [];
    const poolsJsonFields = getCommandMetadata("pools").help?.jsonFields ?? [];
    const poolsJsonVariants = (getCommandMetadata("pools").help?.jsonVariants ?? []).join(" ");
    const poolsAgentWorkflow = (getCommandMetadata("pools").help?.agentWorkflowNotes ?? []).join(" ");
    const statusFlags = getCommandMetadata("status").capabilities?.flags ?? [];
    const syncOverview = (getCommandMetadata("sync").help?.overview ?? []).join(" ");
    const syncExamples = getCommandMetadata("sync").help?.examples ?? [];
    const withdrawQuoteFields = getCommandMetadata("withdraw quote").help?.jsonFields ?? "";
    const summaryVariant = accountsJsonVariants.find((variant) =>
      variant.startsWith("--summary:")
    );
    const pendingOnlyVariant = accountsJsonVariants.find((variant) =>
      variant.startsWith("--pending-only:")
    );

    expect(summaryVariant).toContain("approvedCount");
    expect(summaryVariant).toContain("balances");
    expect(summaryVariant).toContain("nextActions");
    expect(summaryVariant).toContain("cliCommand");

    expect(pendingOnlyVariant).toContain("accounts");
    expect(pendingOnlyVariant).toContain("pendingCount");
    expect(pendingOnlyVariant).toContain("nextActions");
    expect(pendingOnlyVariant).toContain("cliCommand");

    expect(poolsJsonFields).toContain("{ chain");
    expect(poolsJsonFields).toContain("chainSummaries?");
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
    expect(poolsAgentWorkflow).toContain("may be null");
    expect(poolsAgentWorkflow).toContain("totalInPoolValue*");
    expect(statusFlags).toEqual(["--check [scope]", "--no-check", "--aggregated"]);
    expect(syncOverview).toContain("Bare `privacy-pools sync` re-syncs every discovered pool");
    expect(syncExamples).toContain("privacy-pools sync");
    expect(syncExamples).toContain("privacy-pools sync ETH --agent");
    expect(withdrawQuoteFields).toContain("baseFeeBPS");
    expect(withdrawQuoteFields).toContain("relayTxCost");
  });

  test("flow describe metadata exposes one canonical phase graph", () => {
    const flow = buildCommandDescriptor("flow");
    const flowStatus = buildCommandDescriptor("flow status");

    expect(flow.phaseGraph?.nodes).toContain("awaiting_asp");
    expect(flow.phaseGraph?.terminal).toEqual([
      "completed",
      "completed_public_recovery",
      "stopped_external",
    ]);
    expect(flowStatus.phaseGraph).toBeUndefined();
    expect(flowStatus.phaseGraphRef).toBe("flow");
  });
});
