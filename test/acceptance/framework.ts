import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { CliRunOptions, CliRunResult } from "../helpers/cli.ts";
import { parseJsonOutput } from "../helpers/cli.ts";
import {
  expectJsonEnvelope,
  expectNextActions,
  expectStderrOnly,
  expectStdoutOnly,
  type JsonEnvelopeLike,
} from "../helpers/contract-assertions.ts";
import { createTestWorld, type TestWorld } from "../helpers/test-world.ts";

const DEFAULT_ACCEPTANCE_SCENARIO_TIMEOUT_MS = 120_000;

export type AcceptanceContext = TestWorld & {
  lastResult: CliRunResult | null;
};

export type ScenarioStep = (ctx: AcceptanceContext) => Promise<void> | void;

export interface AcceptanceScenario {
  name: string;
  steps: ScenarioStep[];
  timeoutMs?: number;
}

export function defineScenario(
  name: string,
  steps: readonly ScenarioStep[],
  options: { timeoutMs?: number } = {},
): AcceptanceScenario {
  return {
    name,
    steps: [...steps],
    timeoutMs: options.timeoutMs,
  };
}

export function defineScenarioSuite(
  name: string,
  scenarios: readonly AcceptanceScenario[],
): void {
  describe(name, () => {
    for (const scenario of scenarios) {
      test(
        scenario.name,
        async () => {
          const ctx = createTestWorld({
            prefix: "pp-acceptance-",
          }) as AcceptanceContext;

          try {
            for (const step of scenario.steps) {
              await step(ctx);
            }
          } finally {
            await ctx.teardown();
          }
        },
        scenario.timeoutMs ?? DEFAULT_ACCEPTANCE_SCENARIO_TIMEOUT_MS,
      );
    }
  });
}

export function seedHome(chain: string = "mainnet"): ScenarioStep {
  return (ctx) => {
    ctx.seedHome(chain);
  };
}

export function setEnv(env: Record<string, string | undefined>): ScenarioStep {
  return (ctx) => {
    ctx.setEnv(env);
  };
}

export function writeFile(
  relativePath: string,
  content: string,
): ScenarioStep {
  return (ctx) => {
    ctx.writeFile(relativePath, content);
  };
}

export function runCliStep(
  args: string[],
  options: Omit<CliRunOptions, "home" | "env"> = {},
): ScenarioStep {
  return (ctx) => {
    ctx.lastResult = ctx.runCli(args, options);
  };
}

export function runBuiltCliStep(
  args: string[],
  options: Omit<CliRunOptions, "home" | "env"> = {},
): ScenarioStep {
  return (ctx) => {
    ctx.lastResult = ctx.runBuiltCli(args, options);
  };
}

export function assertExit(expected: number | null): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    const result = ctx.lastResult;
    const actual = result?.status ?? null;
    if (actual === expected) {
      return;
    }

    const stderrPreview = (result?.stderr ?? "").trim().slice(0, 200);
    const stdoutPreview = (result?.stdout ?? "").trim().slice(0, 200);
    const details = [
      `expected exit ${String(expected)} but received ${String(actual)}`,
      `signal=${result?.signal ?? "null"}`,
      `timedOut=${result?.timedOut ?? false}`,
      `elapsedMs=${result?.elapsedMs ?? 0}`,
      `error=${result?.errorMessage ?? "none"}`,
      `stderr=${stderrPreview === "" ? "<empty>" : JSON.stringify(stderrPreview)}`,
      `stdout=${stdoutPreview === "" ? "<empty>" : JSON.stringify(stdoutPreview)}`,
    ].join("; ");

    throw new Error(details);
  };
}

export function assertStdout(
  matcher: string | RegExp | ((stdout: string) => void),
): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    const stdout = ctx.lastResult?.stdout ?? "";
    if (typeof matcher === "function") {
      matcher(stdout);
      return;
    }
    if (typeof matcher === "string") {
      expect(stdout).toContain(matcher);
      return;
    }
    expect(stdout).toMatch(matcher);
  };
}

export function assertStderr(
  matcher: string | RegExp | ((stderr: string) => void),
): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    const stderr = ctx.lastResult?.stderr ?? "";
    if (typeof matcher === "function") {
      matcher(stderr);
      return;
    }
    if (typeof matcher === "string") {
      expect(stderr).toContain(matcher);
      return;
    }
    expect(stderr).toMatch(matcher);
  };
}

export function assertStdoutEmpty(): ScenarioStep {
  return assertStdout((stdout) => {
    expect(stdout.trim()).toBe("");
  });
}

export function assertStderrEmpty(): ScenarioStep {
  return assertStderr((stderr) => {
    expect(stderr.trim()).toBe("");
  });
}

export function assertStdoutOnlyStep(
  matcher?: string | RegExp,
): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    expectStdoutOnly(ctx.lastResult ?? { stdout: "", stderr: "" }, matcher);
  };
}

export function assertStderrOnlyStep(
  matcher?: string | RegExp,
): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    expectStderrOnly(ctx.lastResult ?? { stdout: "", stderr: "" }, matcher);
  };
}

export function assertJson<T>(
  assertion: (json: T, ctx: AcceptanceContext) => void,
): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    const json = parseJsonOutput<T>(ctx.lastResult?.stdout ?? "");
    assertion(json, ctx);
  };
}

export function assertJsonEnvelopeStep(
  options: Parameters<typeof expectJsonEnvelope>[1],
): ScenarioStep {
  return assertJson<JsonEnvelopeLike>((json) => {
    expectJsonEnvelope(json, options);
  });
}

export function assertNextActionsStep(
  expectedCommands: readonly string[],
): ScenarioStep {
  return assertJson<JsonEnvelopeLike>((json) => {
    expectNextActions(json.nextActions, expectedCommands);
  });
}

function getJsonPathValue(value: unknown, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = value;

  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function assertJsonPath(
  path: string,
  matcher: unknown | ((value: unknown) => void),
): ScenarioStep {
  return assertJson((json) => {
    const value = getJsonPathValue(json, path);
    if (typeof matcher === "function") {
      matcher(value);
      return;
    }
    expect(value).toEqual(matcher);
  });
}

export function assertFileExists(relativePath: string): ScenarioStep {
  return (ctx) => {
    expect(existsSync(join(ctx.home, relativePath))).toBe(true);
  };
}

export function assertFileMissing(relativePath: string): ScenarioStep {
  return (ctx) => {
    expect(existsSync(join(ctx.home, relativePath))).toBe(false);
  };
}

export function assertHomeState(
  assertion: (home: string, ctx: AcceptanceContext) => void,
): ScenarioStep {
  return (ctx) => {
    assertion(ctx.home, ctx);
  };
}
