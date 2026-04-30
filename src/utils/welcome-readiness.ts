import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../config/chains.js";
import { accountHasDeposits } from "../services/account-storage.js";
import {
  configExists,
  getSubmissionsDir,
  getWorkflowsDir,
  loadSignerKey,
  mnemonicExists,
} from "../services/config.js";
import {
  isTerminalFlowPhase,
  listSavedWorkflowIds,
  loadWorkflowSnapshot,
  type FlowPhase,
} from "../services/workflow.js";
import type { NextAction, NextActionOptionValue } from "../types.js";
import type { ResolvedGlobalMode } from "./mode.js";
import { getNextActionGlobals } from "./next-action-globals.js";

export interface WelcomeAction {
  cliCommand: string;
  description: string;
}

export type WelcomeStateKind =
  | "new_user"
  | "read_only_no_deposits"
  | "read_only_with_deposits"
  | "ready_no_deposits"
  | "ready_with_deposits"
  | "workflow_active"
  | "fallback";

export interface WelcomeState {
  kind: WelcomeStateKind;
  readinessLabel: string;
  bannerHint?: string;
  bannerActions: WelcomeAction[];
  screenActions: WelcomeAction[];
}

const WELCOME_ACTIONS: Record<string, WelcomeAction> = {
  status: {
    cliCommand: "status",
    description: "check setup and network",
  },
  init: {
    cliCommand: "init",
    description: "guided account setup",
  },
  "init --recovery-phrase-file <downloaded-file>": {
    cliCommand: "init --recovery-phrase-file <downloaded-file>",
    description: "load existing account",
  },
  "init --signer-only": {
    cliCommand: "init --signer-only",
    description: "finish setup with signer key",
  },
  guide: {
    cliCommand: "guide",
    description: "concepts and reference",
  },
  "--help": {
    cliCommand: "--help",
    description: "all commands",
  },
  "flow start 0.1 ETH": {
    cliCommand: "flow start 0.1 ETH",
    description: "deposit, then withdraw privately",
  },
  pools: {
    cliCommand: "pools",
    description: "browse pools",
  },
  accounts: {
    cliCommand: "accounts",
    description: "view balances",
  },
  "flow status latest": {
    cliCommand: "flow status latest",
    description: "check saved workflow",
  },
  "flow watch latest": {
    cliCommand: "flow watch latest",
    description: "resume saved workflow",
  },
};

function resolveActions(commands: readonly string[]): WelcomeAction[] {
  return commands.map((command) => WELCOME_ACTIONS[command]);
}

export const DEFAULT_WELCOME_BANNER_ACTIONS = resolveActions([
  "status",
  "init",
  "init --recovery-phrase-file <downloaded-file>",
  "guide",
  "--help",
]);

export const DEFAULT_WELCOME_SCREEN_ACTIONS = resolveActions([
  "status",
  "init",
  "init --recovery-phrase-file <downloaded-file>",
  "guide",
  "--help",
]);

export interface UrgentRecommendationContext {
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

const WORKFLOW_RECOMMENDATION_COMMANDS = new Set([
  "accounts",
  "deposit",
  "flow",
  "history",
  "status",
]);

const NON_ACTIONABLE_WORKFLOW_PHASES = new Set<string>([
  "paused_declined",
  "paused_poa_required",
]);

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

function isNonNullRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function buildRecommendationCliCommand(
  action: NextAction,
  includeAgent: boolean,
): string {
  const parts = ["privacy-pools", action.command];
  const activeGlobals = getNextActionGlobals();
  const explicitOptions = action.options ?? {};
  const wantsAgent = includeAgent || activeGlobals.agent === true;

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

  for (const [key, value] of Object.entries(explicitOptions)) {
    if (value === null || value === undefined) continue;
    const flag = camelToKebab(key);
    if (typeof value === "boolean") {
      parts.push(value ? `--${flag}` : `--no-${flag}`);
    } else {
      parts.push(`--${flag}`, String(value));
    }
  }

  return parts.join(" ");
}

function createRecommendationAction(
  command: string,
  reason: string,
  when: NextAction["when"],
  config: {
    args?: string[];
    options?: Record<string, NextActionOptionValue>;
    runnable?: boolean;
  } = {},
): NextAction {
  const includeAgent = config.options?.agent === true;
  const options = config.options
    ? Object.fromEntries(
        Object.entries(config.options).filter(
          ([key, value]) =>
            key !== "agent" &&
            value !== undefined &&
            value !== null,
        ),
      ) as Record<string, NextActionOptionValue>
    : undefined;
  const action: NextAction = {
    command,
    reason,
    when,
    ...(config.args && config.args.length > 0 ? { args: config.args } : {}),
    ...(options && Object.keys(options).length > 0 ? { options } : {}),
    ...(config.runnable === false ? { runnable: false } : {}),
  };

  if (action.runnable === false) {
    return action;
  }

  return {
    ...action,
    cliCommand: buildRecommendationCliCommand(action, includeAgent),
  };
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
  return false;
}

function shouldRecommendWorkflowNudge(ctx?: UrgentRecommendationContext): boolean {
  const commandPath = resolveRecommendationCommandPath(ctx);
  if (!commandPath) return false;
  const rootCommand = commandPath.split(/\s+/, 1)[0] ?? commandPath;
  return WORKFLOW_RECOMMENDATION_COMMANDS.has(rootCommand);
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
    if (
      typeof parsed.workflowId !== "string" ||
      typeof parsed.phase !== "string" ||
      typeof parsed.chain !== "string" ||
      typeof parsed.asset !== "string"
    ) {
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

function syncRecommendationFor(
  source: { chain?: string | null; asset?: string | null },
  reason: string,
): NextAction {
  return createRecommendationAction(
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
      return createRecommendationAction(
        "init",
        "Finish setup before submitting deposits or withdrawals.",
        "status_not_ready",
        { options: { agent: true } },
      );
    }

    if (!loadSignerKey()) {
      return createRecommendationAction(
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
  payload?: Record<string, unknown>,
): NextAction[] {
  if (shouldSuppressUrgentRecommendations(ctx, payload)) return [];

  const actions: NextAction[] = [];
  const workflows = listStoredWorkflowStates();
  const activeWorkflow = shouldRecommendWorkflowNudge(ctx)
    ? workflows.find(
        (workflow) =>
          !isTerminalFlowPhase(workflow.phase as FlowPhase) &&
          !NON_ACTIONABLE_WORKFLOW_PHASES.has(workflow.phase),
      )
    : undefined;
  if (activeWorkflow) {
    actions.push(
      createRecommendationAction(
        "flow status",
        `Saved workflow ${activeWorkflow.workflowId} is still ${activeWorkflow.phase.replaceAll("_", " ")}; inspect it before starting another action.`,
        "transfer_resume",
        {
          args: [activeWorkflow.workflowId],
          options: { agent: true },
        },
      ),
    );
  }

  const publicRecoveryWorkflow = workflows.find(
    (workflow) => workflow.phase === "completed_public_recovery",
  );
  if (!activeWorkflow && publicRecoveryWorkflow) {
    actions.push(
      createRecommendationAction(
        "accounts",
        `Saved workflow ${publicRecoveryWorkflow.workflowId} recovered publicly; review local account state before starting another action.`,
        "after_ragequit",
        {
          options: {
            agent: true,
            ...(publicRecoveryWorkflow.chain
              ? { chain: publicRecoveryWorkflow.chain }
              : {}),
          },
        },
      ),
    );
  }

  const submissions = listStoredSubmissionStates();
  const submitted = submissions.find((submission) => submission.status === "submitted");
  if (submitted) {
    actions.push(
      createRecommendationAction(
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

function buildWelcomeState(
  kind: WelcomeStateKind,
  readinessLabel: string,
  bannerCommands: readonly string[],
  screenCommands: readonly string[],
  bannerHint?: string,
): WelcomeState {
  return {
    kind,
    readinessLabel,
    ...(bannerHint ? { bannerHint } : {}),
    bannerActions: resolveActions(bannerCommands),
    screenActions: resolveActions(screenCommands),
  };
}

function fallbackWelcomeState(readinessLabel: string = "setup: check status"): WelcomeState {
  return buildWelcomeState(
    "fallback",
    readinessLabel,
    ["status", "guide", "--help"],
    [
      "status",
      "init",
      "init --recovery-phrase-file <downloaded-file>",
      "guide",
      "--help",
    ],
  );
}

function hasSavedDeposits(): boolean {
  return Object.values(CHAINS).some((chain) => accountHasDeposits(chain.id));
}

function getLatestActiveWorkflowPhase(): FlowPhase | null {
  const [latestWorkflowId] = listSavedWorkflowIds();
  if (!latestWorkflowId) return null;

  const snapshot = loadWorkflowSnapshot(latestWorkflowId);
  return isTerminalFlowPhase(snapshot.phase) ? null : snapshot.phase;
}

export function getWelcomeState(): WelcomeState {
  try {
    const hasConfig = configExists();
    const hasRecoveryPhrase = mnemonicExists();
    const hasSignerKey =
      loadSignerKey() !== null ||
      (process.env.PRIVACY_POOLS_PRIVATE_KEY?.trim().length ?? 0) > 0;
    const activeWorkflowPhase = getLatestActiveWorkflowPhase();
    const hasDeposits = hasSavedDeposits();

    if (activeWorkflowPhase) {
      return buildWelcomeState(
        "workflow_active",
        "workflow: active",
        ["flow status latest", "flow watch latest", "--help"],
        [
          "flow status latest",
          "flow watch latest",
          "accounts",
          "guide",
          "--help",
        ],
      );
    }

    if (!hasConfig && !hasRecoveryPhrase && !hasSignerKey) {
      return buildWelcomeState(
        "new_user",
        "setup: run init",
        ["init", "guide", "--help"],
        [
          "status",
          "init",
          "init --recovery-phrase-file <downloaded-file>",
          "guide",
          "--help",
        ],
        "Privacy Pools: deposit publicly, withdraw privately.",
      );
    }

    if (!hasRecoveryPhrase) {
      return fallbackWelcomeState("setup: check status");
    }

    if (!hasSignerKey) {
      return hasDeposits
        ? buildWelcomeState(
            "read_only_with_deposits",
            "setup: read-only",
            ["status", "accounts", "--help"],
            [
              "status",
              "init --signer-only",
              "accounts",
              "guide",
              "--help",
            ],
          )
        : buildWelcomeState(
          "read_only_no_deposits",
          "setup: read-only",
          ["status", "pools", "--help"],
          [
            "status",
            "init --signer-only",
            "pools",
            "guide",
            "--help",
          ],
          "Browse pools now; add a signer key before depositing.",
        );
    }

    return hasDeposits
      ? buildWelcomeState(
          "ready_with_deposits",
          "setup: ready",
          ["accounts", "flow start 0.1 ETH", "--help"],
          [
            "accounts",
            "flow start 0.1 ETH",
            "status",
            "guide",
            "--help",
          ],
        )
      : buildWelcomeState(
          "ready_no_deposits",
          "setup: ready",
          ["flow start 0.1 ETH", "pools", "--help"],
          [
            "flow start 0.1 ETH",
            "pools",
            "status",
            "guide",
            "--help",
          ],
          "Flow = deposit + privacy delay + private withdrawal.",
        );
  } catch {
    return fallbackWelcomeState();
  }
}

export function getWelcomeReadinessLabel(): string {
  return getWelcomeState().readinessLabel;
}
