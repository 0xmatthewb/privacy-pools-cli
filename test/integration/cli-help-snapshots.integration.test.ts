/**
 * Snapshot tests for CLI --help output.
 *
 * Uses Bun's toMatchSnapshot() to baseline the exact help text output for every
 * command. This catches unintentional regressions in help text, flag descriptions,
 * and example formatting.
 *
 * To update snapshots after intentional changes:
 *   bun test --update-snapshots test/integration/cli-help-snapshots.integration.test.ts
 */

import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";

/** Strip ANSI escape codes and normalize whitespace for stable snapshots. */
function normalize(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, "")   // strip ANSI color codes
    .replace(/\r\n/g, "\n")            // normalize line endings
    .replace(/\s+$/gm, "");            // strip trailing whitespace per line
}

const COMMANDS = [
  "init",
  "status",
  "pools",
  "activity",
  "stats",
  "deposit",
  "withdraw",
  "ragequit",
  "balance",
  "accounts",
  "history",
  "sync",
  "guide",
  "capabilities",
  "completion",
] as const;

describe("CLI --help snapshots", () => {
  test("root --help snapshot", () => {
    const result = runCli(["--help"], { home: createTempHome(), timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    expect(normalize(result.stdout)).toMatchSnapshot();
  });

  for (const command of COMMANDS) {
    test(`${command} --help snapshot`, () => {
      const result = runCli([command, "--help"], { home: createTempHome(), timeoutMs: 10_000 });
      expect(result.status).toBe(0);
      expect(normalize(result.stdout)).toMatchSnapshot();
    });
  }

  test("withdraw quote --help snapshot", () => {
    const result = runCli(["withdraw", "quote", "--help"], { home: createTempHome(), timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    expect(normalize(result.stdout)).toMatchSnapshot();
  });

  test("stats global --help snapshot", () => {
    const result = runCli(["stats", "global", "--help"], { home: createTempHome(), timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    expect(normalize(result.stdout)).toMatchSnapshot();
  });

  test("stats pool --help snapshot", () => {
    const result = runCli(["stats", "pool", "--help"], { home: createTempHome(), timeoutMs: 10_000 });
    expect(result.status).toBe(0);
    expect(normalize(result.stdout)).toMatchSnapshot();
  });
});
