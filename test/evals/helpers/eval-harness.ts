/**
 * Agent eval harness — runs multi-step CLI scenarios and validates
 * structured JSON envelope contracts.
 */

import type { CliRunResult, CliRunOptions } from "../../helpers/cli.ts";

// ── Types ──

export interface NextAction {
  command: string;
  reason?: string;
  when?: string;
  args?: string[];
  options?: Record<string, unknown>;
  runnable?: boolean;
}

export interface EvalStepResult {
  stepIndex: number;
  args: string[];
  result: CliRunResult;
  parsed: unknown;
  followedAction?: NextAction;
  skippedActions?: NextAction[];
  retryCount: number;
}

export interface EvalStep {
  /** CLI args (--agent added automatically if not present). */
  command: string[];
  /** Expected exit code. */
  expectedStatus: number;
  /** Custom assertions on the step result. */
  assertions?: (result: CliRunResult, parsed: unknown) => void;
  /** If true, extract and follow the first runnable nextAction. */
  followNextActions?: boolean;
}

export interface EvalScenario {
  name: string;
  description: string;
  steps: EvalStep[];
}

export type CliRunner = (args: string[], options?: CliRunOptions) => CliRunResult;

// ── Utilities ──

/** Extract all nextActions from a parsed JSON envelope. */
export function extractNextActions(payload: unknown): NextAction[] {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "nextActions" in payload &&
    Array.isArray((payload as Record<string, unknown>).nextActions)
  ) {
    return (payload as Record<string, unknown>).nextActions as NextAction[];
  }
  return [];
}

/** Extract the first runnable nextAction. */
export function extractFirstRunnableAction(payload: unknown): NextAction | null {
  const actions = extractNextActions(payload);
  return actions.find((a) => isRunnableAction(a)) ?? null;
}

/** Convert camelCase option keys to CLI-style kebab-case (e.g. showRecoveryPhrase → show-recovery-phrase). */
function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/** Build CLI args from a structured nextAction. */
export function buildArgsFromNextAction(action: NextAction): string[] {
  const args: string[] = [];

  // Add the command itself
  args.push(...action.command.split(/\s+/));

  // Add positional args
  if (Array.isArray(action.args)) {
    args.push(...action.args);
  }

  // Add option flags — convert camelCase keys to kebab-case and emit --no-* for false booleans
  if (action.options && typeof action.options === "object") {
    for (const [key, value] of Object.entries(action.options)) {
      if (value === null || value === undefined) continue;
      const flag = camelToKebab(key);
      if (typeof value === "boolean") {
        args.push(value ? `--${flag}` : `--no-${flag}`);
      } else {
        args.push(`--${flag}`, String(value));
      }
    }
  }

  return args;
}

/** Check whether a nextAction is runnable (not template-only). */
export function isRunnableAction(action: NextAction): boolean {
  return action.runnable !== false;
}

/** Check whether an error payload is retryable. */
export function isRetryableError(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.error !== "object" || p.error === null) return false;
  const err = p.error as Record<string, unknown>;
  return err.retryable === true;
}

/** Normalize args to ensure --agent is present. */
function normalizeAgentArgs(args: string[]): string[] {
  if (args.includes("--agent")) return args;
  // Prepend --agent so all eval steps run in agent mode
  return ["--agent", ...args];
}

// ── Harness ──

const MAX_RETRIES = 2;

export interface RunEvalOptions {
  runner: CliRunner;
  home: string;
  timeoutMs?: number;
}

/**
 * Run an eval scenario step-by-step, collecting results.
 * Returns an array of step results for assertion.
 */
export function runEvalScenario(
  scenario: EvalScenario,
  options: RunEvalOptions,
): EvalStepResult[] {
  const results: EvalStepResult[] = [];

  let currentSteps = [...scenario.steps];
  let stepIndex = 0;

  while (stepIndex < currentSteps.length) {
    const step = currentSteps[stepIndex];
    const args = normalizeAgentArgs(step.command);

    let result: CliRunResult;
    let parsed: unknown = null;
    let retryCount = 0;

    // Run with retry for retryable errors
    while (true) {
      result = options.runner(args, {
        home: options.home,
        timeoutMs: options.timeoutMs ?? 30_000,
      });

      // Try to parse JSON output
      const trimmed = result.stdout.trim();
      if (trimmed) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          parsed = null;
        }
      }

      // Retry logic for retryable errors
      if (
        result.status !== step.expectedStatus &&
        parsed &&
        isRetryableError(parsed) &&
        retryCount < MAX_RETRIES
      ) {
        retryCount++;
        continue;
      }
      break;
    }

    const stepResult: EvalStepResult = {
      stepIndex,
      args,
      result,
      parsed,
      retryCount,
    };

    // Check for followNextActions
    if (step.followNextActions && parsed) {
      const allActions = extractNextActions(parsed);
      const runnableAction = extractFirstRunnableAction(parsed);
      const nonRunnableActions = allActions.filter((a) => !isRunnableAction(a));

      if (nonRunnableActions.length > 0) {
        stepResult.skippedActions = nonRunnableActions;
      }

      if (runnableAction) {
        stepResult.followedAction = runnableAction;
        // Insert a synthetic step for the followed action
        const followArgs = buildArgsFromNextAction(runnableAction);
        currentSteps.splice(stepIndex + 1, 0, {
          command: followArgs,
          expectedStatus: 0,
        });
      }
    }

    results.push(stepResult);
    stepIndex++;
  }

  return results;
}
