/**
 * Regression tests for BUG-1: Commander's negated sync option.
 *
 * Commander parses `--no-sync` as `opts.sync = false`. The command-level
 * wiring is covered separately in integration tests.
 */

import { describe, expect, test } from "bun:test";
import { Command } from "commander";

function parseSyncFlag(userArgs: string[]): Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  const cmd = new Command("testcmd");
  cmd.exitOverride();
  cmd.option("--no-sync", "Skip sync");
  cmd.action((opts) => {
    captured = opts;
  });
  cmd.parse(userArgs, { from: "user" });
  return captured;
}

describe("Commander negated sync flag", () => {
  test("parses --no-sync as opts.sync = false", () => {
    const opts = parseSyncFlag(["--no-sync"]);
    expect(opts.sync).toBe(false);
    expect(opts).not.toHaveProperty("noSync");
  });

  test("defaults opts.sync to true when the flag is omitted", () => {
    const opts = parseSyncFlag([]);
    expect(opts.sync).toBe(true);
  });
});
