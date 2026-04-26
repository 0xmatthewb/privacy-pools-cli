/**
 * Shared output primitives for command renderers.
 *
 * Re-exports mode resolution and provides a thin, mode-aware render context
 * that individual command renderers consume.  Keeps JSON envelope source of
 * truth in `utils/json.ts` and formatting helpers in `utils/format.ts`.
 */

import chalk from "chalk";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../config/chains.js";
import { loadAccount } from "../services/account-storage.js";
import {
  configExists,
  getSubmissionsDir,
  getWorkflowsDir,
  loadSignerKey,
  mnemonicExists,
} from "../services/config.js";
import type { ResolvedGlobalMode } from "../utils/mode.js";
import { printJsonSuccess } from "../utils/json.js";
import { printCsv } from "./csv.js";
import type {
  NextAction,
  NextActionParameter,
  NextActionOptionValue,
  NextActionWhen,
} from "../types.js";
import { getNextActionGlobals } from "../utils/next-action-globals.js";
import {
  info,
  success,
  warn,
  printTable,
} from "../utils/format.js";
import { CLIError } from "../utils/errors.js";
import { accent, muted } from "../utils/theme.js";

// ── Re-exports so renderers only need one import ─────────────────────────────

export {
  printJsonSuccess,
  printCsv,
  info,
  success,
  warn,
  printTable,
};
export type { ResolvedGlobalMode };

/**
 * Output context passed from the command handler to a renderer.
 *
 * Bundles resolved mode flags with convenience getters that renderers
 * reference frequently.  Commands construct this once and hand it off.
 */
export interface OutputContext {
  /** Resolved global mode (json, quiet, agent, skipPrompts). */
  mode: ResolvedGlobalMode;
  /** True when verbose output is requested. */
  isVerbose: boolean;
  /** Verbose level: 0=off, 1=info, 2=debug, 3=trace. */
  verboseLevel: number;
  /** Optional command path for renderer-level tests or non-argv integrations. */
  commandPath?: string;
  /** Disable local urgent recommendations for a specific render surface. */
  suppressUrgentRecommendations?: boolean;
}

/**
 * Create an output context from resolved mode and verbose flag.
 */
export function createOutputContext(
  mode: ResolvedGlobalMode,
  isVerbose: boolean = false,
  options: {
    commandPath?: string;
    suppressUrgentRecommendations?: boolean;
  } = {},
): OutputContext {
  return {
    mode,
    isVerbose,
    verboseLevel: mode.verboseLevel,
    ...(options.commandPath ? { commandPath: options.commandPath } : {}),
    ...(options.suppressUrgentRecommendations
      ? { suppressUrgentRecommendations: true }
      : {}),
  };
}

/**
 * Whether human-mode informational messages should be suppressed.
 * True when quiet, JSON, or CSV mode is active.
 */
export function isSilent(ctx: OutputContext): boolean {
  return ctx.mode.isQuiet || ctx.mode.isJson || ctx.mode.isCsv;
}

/**
 * Whether CSV output is requested.
 */
export function isCsv(ctx: OutputContext): boolean {
  return ctx.mode.isCsv;
}

/** Commands that support `--output csv` output. */
const CSV_SUPPORTED_COMMANDS = [
  "pools",
  "accounts",
  "activity",
  "protocol-stats",
  "pool-stats",
  "stats",
  "history",
];
const NAME_SUPPORTED_COMMANDS = [
  "pools",
  "accounts",
  "activity",
  "protocol-stats",
  "pool-stats",
  "stats",
  "history",
];

/**
 * Throw an INPUT error when `--output csv` is used with a command that does
 * not produce tabular data.  Call at the top of any renderer that lacks CSV
 * support.
 */
export function guardCsvUnsupported(ctx: OutputContext, commandName: string): void {
  if (ctx.mode.isCsv) {
    throw new CLIError(
      `--output csv is not supported for '${commandName}'.`,
      "INPUT",
      `CSV output is available for: ${CSV_SUPPORTED_COMMANDS.join(", ")}.`,
    );
  }
  if (ctx.mode.isName) {
    throw new CLIError(
      `--output name is not supported for '${commandName}'.`,
      "INPUT",
      `Name output is available for: ${NAME_SUPPORTED_COMMANDS.join(", ")}.`,
    );
  }
}

export function createNextAction(
  command: string,
  reason: string,
  when: NextActionWhen,
  config: {
    args?: string[];
    options?: Record<string, NextActionOptionValue>;
    parameters?: NextActionParameter[];
    /** False when the command is a template requiring additional user input. */
    runnable?: boolean;
  } = {},
): NextAction {
  const action: NextAction = { command, reason, when };
  const includeAgentInCliCommand = config.options?.agent === true;

  if (config.args && config.args.length > 0) {
    action.args = config.args;
  }

  if (config.options) {
    const options = Object.fromEntries(
      Object.entries(config.options).filter(
        ([key, value]) =>
          key !== "agent" &&
          value !== undefined &&
          value !== null,
      ),
    ) as Record<string, NextActionOptionValue>;
    if (Object.keys(options).length > 0) {
      action.options = options;
    }
  }

  if (config.parameters && config.parameters.length > 0) {
    action.parameters = config.parameters;
  }

  if (config.runnable === false) {
    action.runnable = false;
  }

  return withCliCommand(action, includeAgentInCliCommand);
}

export const DRY_RUN_FOOTER_COPY =
  "Dry-run: validation succeeded. Re-run without --dry-run to submit.";

interface UrgentRecommendationContext {
  mode?: ResolvedGlobalMode;
  commandPath?: string;
  suppressUrgentRecommendations?: boolean;
}

interface StoredWorkflowRecommendationState {
  workflowId: string;
  phase: string;
  chain?: string | null;
  asset?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  reconciliationRequired?: boolean;
}

interface StoredSubmissionRecommendationState {
  submissionId: string;
  sourceCommand?: string | null;
  operation?: string | null;
  chain?: string | null;
  asset?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  reconciliationRequired?: boolean;
}

const KNOWN_ROOT_COMMANDS = new Set([
  "accounts",
  "activity",
  "broadcast",
  "capabilities",
  "completion",
  "config",
  "deposit",
  "describe",
  "flow",
  "guide",
  "history",
  "init",
  "migrate",
  "pool-stats",
  "pools",
  "protocol-stats",
  "ragequit",
  "simulate",
  "status",
  "sync",
  "tx-status",
  "upgrade",
  "withdraw",
]);

const OPTIONS_WITH_VALUES = new Set([
  "--chain",
  "-c",
  "--config",
  "--default-chain",
  "--jmes",
  "--jq",
  "--json-fields",
  "--output",
  "-o",
  "--profile",
  "--rpc-url",
  "-r",
  "--template",
  "--timeout",
]);

const TERMINAL_FLOW_PHASES = new Set([
  "completed",
  "completed_public_recovery",
  "stopped_external",
]);

function isNonNullRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCommandPathFromArgv(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token || token === "--") break;
    if (token.startsWith("--") && token.includes("=")) {
      continue;
    }
    if (OPTIONS_WITH_VALUES.has(token)) {
      index++;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    return KNOWN_ROOT_COMMANDS.has(token) ? token : null;
  }
  return null;
}

function resolveRecommendationCommandPath(
  ctx?: UrgentRecommendationContext,
): string | null {
  if (ctx?.commandPath) return ctx.commandPath;
  return parseCommandPathFromArgv(process.argv.slice(2));
}

function shouldSuppressUrgentRecommendations(
  ctx?: UrgentRecommendationContext,
  payload?: Record<string, unknown>,
): boolean {
  if (ctx?.suppressUrgentRecommendations) return true;
  if (payload?.success === false) return true;
  if (payload?.mode === "flow") return true;

  const commandPath = resolveRecommendationCommandPath(ctx);
  if (!commandPath) return true;
  return commandPath === "flow" || commandPath.startsWith("flow ");
}

function readJsonFile(filePath: string): unknown | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function parseDateMs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listStoredWorkflowStates(): StoredWorkflowRecommendationState[] {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) return [];

  const states: Array<StoredWorkflowRecommendationState & { fileMtimeMs: number }> = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(dir, entry);
    const parsed = readJsonFile(filePath);
    if (!isNonNullRecord(parsed)) continue;
    if (typeof parsed.workflowId !== "string" || typeof parsed.phase !== "string") {
      continue;
    }

    let fileMtimeMs = 0;
    try {
      fileMtimeMs = statSync(filePath).mtimeMs;
    } catch {
      fileMtimeMs = 0;
    }

    states.push({
      workflowId: parsed.workflowId,
      phase: parsed.phase,
      chain: typeof parsed.chain === "string" ? parsed.chain : null,
      asset: typeof parsed.asset === "string" ? parsed.asset : null,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      reconciliationRequired: parsed.reconciliationRequired === true,
      fileMtimeMs,
    });
  }

  return states.sort((left, right) => {
    const leftTime = parseDateMs(left.updatedAt) || parseDateMs(left.createdAt) || left.fileMtimeMs;
    const rightTime = parseDateMs(right.updatedAt) || parseDateMs(right.createdAt) || right.fileMtimeMs;
    return rightTime - leftTime;
  });
}

function listStoredSubmissionStates(): StoredSubmissionRecommendationState[] {
  const dir = getSubmissionsDir();
  if (!existsSync(dir)) return [];

  const states: Array<StoredSubmissionRecommendationState & { fileMtimeMs: number }> = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(dir, entry);
    const parsed = readJsonFile(filePath);
    if (!isNonNullRecord(parsed)) continue;
    if (typeof parsed.submissionId !== "string") continue;

    let fileMtimeMs = 0;
    try {
      fileMtimeMs = statSync(filePath).mtimeMs;
    } catch {
      fileMtimeMs = 0;
    }

    states.push({
      submissionId: parsed.submissionId,
      sourceCommand: typeof parsed.sourceCommand === "string" ? parsed.sourceCommand : null,
      operation: typeof parsed.operation === "string" ? parsed.operation : null,
      chain: typeof parsed.chain === "string" ? parsed.chain : null,
      asset: typeof parsed.asset === "string" ? parsed.asset : null,
      status: typeof parsed.status === "string" ? parsed.status : null,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      reconciliationRequired: parsed.reconciliationRequired === true,
      fileMtimeMs,
    });
  }

  return states.sort((left, right) => {
    const leftTime = parseDateMs(left.updatedAt) || parseDateMs(left.createdAt) || left.fileMtimeMs;
    const rightTime = parseDateMs(right.updatedAt) || parseDateMs(right.createdAt) || right.fileMtimeMs;
    return rightTime - leftTime;
  });
}

function hasExplicitPendingReviewState(value: unknown, seen = new Set<object>()): boolean {
  if (!isNonNullRecord(value)) {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);

  for (const [key, nested] of Object.entries(value)) {
    if ((key === "status" || key === "aspStatus") && nested === "pending") {
      return true;
    }
    if (isNonNullRecord(nested) && hasExplicitPendingReviewState(nested, seen)) {
      return true;
    }
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (hasExplicitPendingReviewState(item, seen)) return true;
      }
    }
  }

  if (value instanceof Map) {
    for (const nested of value.values()) {
      if (hasExplicitPendingReviewState(nested, seen)) return true;
    }
  }

  return false;
}

function getPendingApprovalChains(): string[] {
  const chains: string[] = [];
  for (const chain of Object.values(CHAINS)) {
    try {
      const account = loadAccount(chain.id);
      if (account && hasExplicitPendingReviewState(account)) {
        chains.push(chain.name);
      }
    } catch {
      // Urgent recommendations are best-effort; strict commands still own errors.
    }
  }
  return chains;
}

function scopedAccountsOptions(chains: readonly string[]): Record<string, NextActionOptionValue> {
  const options: Record<string, NextActionOptionValue> = { agent: true, pendingOnly: true };
  if (chains.length === 1 && chains[0]) {
    options.chain = chains[0];
    return options;
  }
  if (chains.some((chain) => CHAINS[chain]?.isTestnet)) {
    options.includeTestnets = true;
  }
  return options;
}

function syncRecommendationFor(
  source: { chain?: string | null; asset?: string | null },
  reason: string,
): NextAction {
  return createNextAction(
    "sync",
    reason,
    "after_sync",
    {
      ...(source.asset ? { args: [source.asset] } : {}),
      options: {
        agent: true,
        ...(source.chain ? { chain: source.chain } : {}),
      },
    },
  );
}

function needsSetupRecommendation(): NextAction | null {
  try {
    if (!configExists() || !mnemonicExists()) {
      return createNextAction(
        "init",
        "Finish setup before submitting deposits or withdrawals.",
        "status_not_ready",
        { options: { agent: true } },
      );
    }

    if (!loadSignerKey()) {
      return createNextAction(
        "init",
        "Add a signer key before submitting deposits or withdrawals.",
        "status_not_ready",
        { options: { agent: true, signerOnly: true } },
      );
    }
  } catch {
    return null;
  }
  return null;
}

export function getUrgentRecommendations(
  ctx: UrgentRecommendationContext = {},
): NextAction[] {
  if (shouldSuppressUrgentRecommendations(ctx)) return [];

  const actions: NextAction[] = [];
  const workflows = listStoredWorkflowStates();
  const activeWorkflow = workflows.find(
    (workflow) => !TERMINAL_FLOW_PHASES.has(workflow.phase),
  );
  if (activeWorkflow) {
    actions.push(
      createNextAction(
        "flow status",
        `Saved workflow ${activeWorkflow.workflowId} is still ${activeWorkflow.phase.replaceAll("_", " ")}; inspect it before starting another action.`,
        "flow_resume",
        {
          args: [activeWorkflow.workflowId],
          options: { agent: true },
        },
      ),
    );
  }

  const pendingApprovalChains = getPendingApprovalChains();
  if (pendingApprovalChains.length > 0) {
    actions.push(
      createNextAction(
        "accounts",
        pendingApprovalChains.length === 1
          ? `A Pool Account on ${pendingApprovalChains[0]} is still under ASP review; poll pending approvals before withdrawing.`
          : "Pool Accounts on saved chains are still under ASP review; poll pending approvals before withdrawing.",
        "has_pending",
        { options: scopedAccountsOptions(pendingApprovalChains) },
      ),
    );
  }

  const submissions = listStoredSubmissionStates();
  const submitted = submissions.find((submission) => submission.status === "submitted");
  if (submitted) {
    actions.push(
      createNextAction(
        "tx-status",
        `A previous ${submitted.sourceCommand ?? submitted.operation ?? "transaction"} submission is still pending; poll it before resubmitting related work.`,
        "after_submit",
        {
          args: [submitted.submissionId],
          options: { agent: true },
        },
      ),
    );
  }

  const workflowReconciliation = workflows.find(
    (workflow) => workflow.reconciliationRequired === true,
  );
  if (workflowReconciliation) {
    actions.push(
      syncRecommendationFor(
        workflowReconciliation,
        "A saved workflow needs local state reconciliation before you rely on its snapshot.",
      ),
    );
  }

  const submissionReconciliation = submissions.find(
    (submission) => submission.reconciliationRequired === true,
  );
  if (submissionReconciliation) {
    actions.push(
      syncRecommendationFor(
        submissionReconciliation,
        "A previous transaction confirmed onchain, but local state needs reconciliation before you rely on saved balances.",
      ),
    );
  }

  const setupAction = needsSetupRecommendation();
  if (setupAction) {
    actions.push(setupAction);
  }

  return actions;
}

function stableOptionsKey(
  options: Record<string, NextActionOptionValue> | undefined,
): string {
  if (!options) return "";
  const entries = Object.entries(options)
    .filter(([key]) => key !== "agent")
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function nextActionDedupeKey(action: NextAction): string {
  return JSON.stringify({
    command: action.command,
    args: action.args ?? [],
    options: stableOptionsKey(action.options),
    runnable: action.runnable === false ? false : true,
  });
}

function urgentActionCoveredByExisting(
  urgent: NextAction,
  existing: readonly NextAction[],
): boolean {
  if (urgent.command === "init") {
    return existing.some((action) => action.command === "init");
  }
  if (urgent.command === "accounts" && urgent.options?.pendingOnly === true) {
    return existing.some(
      (action) =>
        action.command === "accounts" &&
        action.options?.pendingOnly === true,
    );
  }
  return false;
}

function mergeUrgentRecommendations(
  ctx: UrgentRecommendationContext | undefined,
  nextActions: NextAction[] | undefined,
  payload?: Record<string, unknown>,
): NextAction[] | undefined {
  if (shouldSuppressUrgentRecommendations(ctx, payload)) {
    return nextActions;
  }

  const urgent = getUrgentRecommendations(ctx);
  if (urgent.length === 0) return nextActions;

  const seen = new Set<string>();
  const merged: NextAction[] = [];
  const existing = nextActions ?? [];
  for (const action of [
    ...urgent.filter((action) => !urgentActionCoveredByExisting(action, existing)),
    ...existing,
  ]) {
    const key = nextActionDedupeKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(action);
  }
  return merged;
}

export function appendNextActions<T extends Record<string, unknown>>(
  payload: T,
  nextActions: NextAction[] | undefined,
  ctx?: UrgentRecommendationContext,
): T & { nextActions?: NextAction[] } {
  const mergedNextActions = mergeUrgentRecommendations(ctx, nextActions, payload);
  return mergedNextActions && mergedNextActions.length > 0
    ? { ...payload, nextActions: mergedNextActions.map((action) => withCliCommand(action)) }
    : { ...payload };
}

// ── Shared human next-step renderer ─────────────────────────────────────────

/**
 * Build a human-readable CLI invocation string from a NextAction.
 *
 * Includes positional args and a small subset of options that help the user
 * understand the suggested command.  Machine-only options (e.g. `agent: true`)
 * are excluded because they are not useful in a human-mode hint.
 */
/** Convert camelCase option keys to CLI-style kebab-case (e.g. showRecoveryPhrase → show-recovery-phrase). */
function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function buildNextActionCommand(
  action: NextAction,
  options: { includeAgent: boolean; preserveGlobalFlags?: boolean },
): string {
  const parts = ["privacy-pools", action.command];
  const activeGlobals = options.preserveGlobalFlags ? getNextActionGlobals() : {};
  const explicitOptions = action.options ?? {};
  const wantsAgent = options.includeAgent || activeGlobals.agent === true;

  if (action.args) {
    parts.push(...action.args);
  }

  if (wantsAgent) {
    parts.push("--agent");
  } else {
    if (activeGlobals.yes === true) {
      parts.push("--yes");
    }
    if (activeGlobals.quiet === true) {
      parts.push("--quiet");
    }
  }

  if (activeGlobals.chain && explicitOptions.chain === undefined) {
    parts.push("--chain", String(activeGlobals.chain));
  }
  if (activeGlobals.rpcUrl && explicitOptions.rpcUrl === undefined) {
    parts.push("--rpc-url", String(activeGlobals.rpcUrl));
  }
  if (activeGlobals.profile && explicitOptions.profile === undefined) {
    parts.push("--profile", String(activeGlobals.profile));
  }

  if (action.options) {
    for (const [key, value] of Object.entries(action.options)) {
      if (key === "agent") continue;
      if (value === null || value === undefined) continue;
      const flag = camelToKebab(key);
      if (typeof value === "boolean") {
        parts.push(value ? `--${flag}` : `--no-${flag}`);
      } else {
        parts.push(`--${flag}`, String(value));
      }
    }
  }

  return parts.join(" ");
}

export function formatNextActionCommand(action: NextAction): string {
  return buildNextActionCommand(action, {
    includeAgent: false,
    preserveGlobalFlags: false,
  });
}

export function formatExecutableNextActionCommand(action: NextAction): string {
  return buildNextActionCommand(action, {
    includeAgent: true,
    preserveGlobalFlags: true,
  });
}

function withCliCommand(action: NextAction, includeAgent: boolean = false): NextAction {
  const actionRequestsAgent = action.options?.agent === true;
  const normalizedOptions = action.options
    ? Object.fromEntries(
        Object.entries(action.options).filter(
          ([key, value]) =>
            key !== "agent" &&
            value !== undefined &&
            value !== null,
        ),
      ) as Record<string, NextActionOptionValue>
    : undefined;
  const normalizedAction: NextAction = {
    ...action,
    ...(normalizedOptions && Object.keys(normalizedOptions).length > 0
      ? { options: normalizedOptions }
      : { options: undefined }),
  };
  if (normalizedAction.runnable === false && !normalizedAction.cliCommand) {
    return normalizedAction;
  }
  return normalizedAction.cliCommand
    ? normalizedAction
    : {
        ...normalizedAction,
        cliCommand: buildNextActionCommand(normalizedAction, {
          includeAgent: includeAgent || actionRequestsAgent,
          preserveGlobalFlags: true,
        }),
      };
}

/**
 * Render human-visible next-step guidance derived from the same NextAction
 * array used for JSON `nextActions`.
 *
 * Single source of truth: JSON renderers call `appendNextActions(payload, actions)`,
 * human renderers call `renderNextSteps(ctx, actions)` with the same array.
 *
 * Output goes to stderr, suppressed by --quiet / --agent / --json / --csv.
 */
export function renderNextSteps(
  ctx: OutputContext,
  nextActions: NextAction[] | undefined,
): void {
  if (isSilent(ctx)) return;
  const mergedNextActions = mergeUrgentRecommendations(ctx, nextActions);
  if (!mergedNextActions || mergedNextActions.length === 0) return;

  // Only show fully-specified commands to humans.  Template actions
  // (runnable: false) are for agents — humans shouldn't see a
  // half-formed command that errors when copy-pasted.
  const runnable = mergedNextActions.filter((a) => a.runnable !== false);
  if (runnable.length === 0) return;
  const urgentKeys = new Set(
    getUrgentRecommendations(ctx).map((action) => nextActionDedupeKey(action)),
  );

  process.stderr.write(`\n${chalk.bold("Next steps:")}\n`);
  for (const action of runnable) {
    const cmd = formatNextActionCommand(action);
    const urgent = urgentKeys.has(nextActionDedupeKey(action));
    process.stderr.write(
      urgent
        ? `  ${accent("→")} ${chalk.bold(accent(cmd))}\n`
        : `  ${accent(cmd)}\n`,
    );
    process.stderr.write(`    ${muted(action.reason)}\n`);
  }
}
