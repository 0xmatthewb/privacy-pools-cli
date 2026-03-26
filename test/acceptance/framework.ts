import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { CliRunOptions, CliRunResult } from "../helpers/cli.ts";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runBuiltCli,
  runCli,
} from "../helpers/cli.ts";

export interface AcceptanceContext {
  home: string;
  cwd: string;
  env: Record<string, string | undefined>;
  lastResult: CliRunResult | null;
}

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
          const ctx: AcceptanceContext = {
            home: createTempHome("pp-acceptance-"),
            cwd: process.cwd(),
            env: {},
            lastResult: null,
          };

          for (const step of scenario.steps) {
            await step(ctx);
          }
        },
        scenario.timeoutMs,
      );
    }
  });
}

export function seedHome(chain: string = "mainnet"): ScenarioStep {
  return (ctx) => {
    mustInitSeededHome(ctx.home, chain);
  };
}

export function setEnv(env: Record<string, string | undefined>): ScenarioStep {
  return (ctx) => {
    ctx.env = {
      ...ctx.env,
      ...env,
    };
  };
}

export function writeFile(
  relativePath: string,
  content: string,
): ScenarioStep {
  return (ctx) => {
    const absolutePath = join(ctx.home, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  };
}

export function runCliStep(
  args: string[],
  options: Omit<CliRunOptions, "home" | "env"> = {},
): ScenarioStep {
  return (ctx) => {
    ctx.lastResult = runCli(args, {
      ...options,
      home: ctx.home,
      env: {
        ...ctx.env,
        ...options.env,
      },
    });
  };
}

export function runBuiltCliStep(
  args: string[],
  options: Omit<CliRunOptions, "home" | "env"> = {},
): ScenarioStep {
  return (ctx) => {
    ctx.lastResult = runBuiltCli(args, {
      ...options,
      home: ctx.home,
      env: {
        ...ctx.env,
        ...options.env,
      },
    });
  };
}

export function assertExit(expected: number | null): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    expect(ctx.lastResult?.status ?? null).toBe(expected);
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

export function assertJson<T>(
  assertion: (json: T, ctx: AcceptanceContext) => void,
): ScenarioStep {
  return (ctx) => {
    expect(ctx.lastResult).not.toBeNull();
    const json = parseJsonOutput<T>(ctx.lastResult?.stdout ?? "");
    assertion(json, ctx);
  };
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
