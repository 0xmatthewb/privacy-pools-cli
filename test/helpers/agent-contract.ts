import { expect } from "bun:test";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import type { CliRunResult } from "./cli.ts";
import { parseJsonOutput } from "./cli.ts";

interface AgentEnvelope {
  schemaVersion: string;
  success: boolean;
  errorCode?: string;
}

interface AgentContractOptions {
  status: number;
  success: boolean;
  errorCode?: string;
}

function assertAgentEnvelope<T extends AgentEnvelope>(
  result: CliRunResult,
  options: AgentContractOptions,
): T {
  expect(result.status).toBe(options.status);
  expect(result.stderr.trim()).toBe("");
  expect(result.stdout.trim()).not.toBe("");
  expect(result.stdout.trim().startsWith("{")).toBe(true);

  const json = parseJsonOutput<T>(result.stdout);
  expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
  expect(json.success).toBe(options.success);
  if (options.errorCode !== undefined) {
    expect(json.errorCode).toBe(options.errorCode);
  }
  return json;
}

export function assertGuideAgentContract(result: CliRunResult): void {
  const json = assertAgentEnvelope<{
    schemaVersion: string;
    success: boolean;
    mode: string;
    help: string;
  }>(result, { status: 0, success: true });

  expect(json.mode).toBe("help");
  expect(json.help).toContain("Privacy Pools: Quick Guide");
}

export function assertCapabilitiesAgentContract(result: CliRunResult): void {
  const json = assertAgentEnvelope<{
    schemaVersion: string;
    success: boolean;
    commands: Array<{ name: string }>;
    commandDetails: Record<string, {
      command: string;
      sideEffectClass: string;
      touchesFunds: boolean;
      requiresHumanReview: boolean;
      preferredSafeVariant?: { command: string; reason: string };
      safeReadOnly?: boolean;
    }>;
  }>(result, { status: 0, success: true });

  expect(json.commands.map((command) => command.name)).toContain("capabilities");
  expect(json.commands.map((command) => command.name)).toContain("describe");
  expect(json.commandDetails["withdraw"]?.sideEffectClass).toBe("fund_movement");
  expect(json.commandDetails["withdraw"]?.touchesFunds).toBe(true);
  expect(json.commandDetails["withdraw"]?.requiresHumanReview).toBe(true);
  expect(json.commandDetails["withdraw"]?.preferredSafeVariant?.command).toBe(
    "withdraw quote",
  );
  expect(json.commandDetails["flow"]?.sideEffectClass).toBe("read_only");
  expect(json.commandDetails["flow"]?.touchesFunds).toBe(false);
  expect(json.commandDetails["flow"]?.requiresHumanReview).toBe(false);
  expect(json.commandDetails["flow"]?.safeReadOnly).toBe(true);
  expect(json.commandDetails["flow status"]?.safeReadOnly).toBe(true);
}

export function assertDescribeWithdrawQuoteAgentContract(
  result: CliRunResult,
): void {
  const json = assertAgentEnvelope<{
    schemaVersion: string;
    success: boolean;
    command: string;
    usage: string;
    sideEffectClass: string;
    touchesFunds: boolean;
    requiresHumanReview: boolean;
  }>(result, { status: 0, success: true });

  expect(json.command).toBe("withdraw quote");
  expect(json.usage).toBe("withdraw quote <amount> <asset>");
  expect(json.sideEffectClass).toBe("read_only");
  expect(json.touchesFunds).toBe(false);
  expect(json.requiresHumanReview).toBe(false);
}

export function assertStatusSetupRequiredAgentContract(
  result: CliRunResult,
): void {
  const json = assertAgentEnvelope<{
    schemaVersion: string;
    success: boolean;
    recommendedMode: string;
    blockingIssues?: Array<{ code: string }>;
    nextActions?: Array<{ command: string; options?: Record<string, unknown> }>;
  }>(result, { status: 0, success: true });

  expect(json.recommendedMode).toBe("setup-required");
  expect(json.blockingIssues?.map((issue) => issue.code)).toContain(
    "config_missing",
  );
  expect(json.blockingIssues?.map((issue) => issue.code)).toContain(
    "recovery_phrase_missing",
  );
  expect(json.nextActions?.[0]?.command).toBe("init");
  expect(json.nextActions?.[0]?.options?.agent).toBe(true);
}

export function assertStatusDegradedHealthAgentContract(
  result: CliRunResult,
): void {
  const json = assertAgentEnvelope<{
    schemaVersion: string;
    success: boolean;
    recommendedMode: string;
    warnings?: Array<{ code: string }>;
    nextActions?: Array<{ command: string; options?: Record<string, unknown> }>;
  }>(result, { status: 0, success: true });

  expect(json.recommendedMode).toBe("read-only");
  expect(json.warnings?.map((issue) => issue.code)).toContain(
    "asp_unreachable",
  );
  expect(json.warnings?.map((issue) => issue.code)).toContain(
    "rpc_unreachable",
  );
  const nextActions = json.nextActions ?? [];

  expect(nextActions).toHaveLength(1);
  expect(nextActions[0]?.command).toBe("pools");
  expect(
    nextActions.every((action) => action.options?.agent === true),
  ).toBe(true);
  expect(nextActions[0]?.options?.allChains).toBeUndefined();
}

export function assertUnknownCommandAgentContract(result: CliRunResult): void {
  const json = assertAgentEnvelope<{
    schemaVersion: string;
    success: boolean;
    errorCode: string;
    errorMessage: string;
    error: { category: string };
  }>(result, { status: 2, success: false, errorCode: "INPUT_ERROR" });

  expect(json.error.category).toBe("INPUT");
  expect(json.errorMessage.toLowerCase()).toContain("unknown command");
}
