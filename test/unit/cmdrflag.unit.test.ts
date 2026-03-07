/**
 * Regression test for BUG-1: Commander's negated option for sync.
 *
 * Commander creates `opts.sync = false` (NOT `opts.noSync = true`) for
 * the negated sync option.  The original bug checked `opts.noSync === true`,
 * which was always `undefined`, silently ignoring the flag.
 *
 * This test exercises Commander's actual parsing so the exact property
 * shape is verified end-to-end, preventing silent regression.
 */

import { describe, expect, test } from "bun:test";
import { Command } from "commander";

describe("Commander negated sync flag shape", () => {
  /** Parse a fresh Command with the same --no-sync option used in the CLI. */
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

  test("negated sync flag sets opts.sync to false", () => {
    const opts = parseSyncFlag(["--no-sync"]);
    expect(opts.sync).toBe(false);
    // Commander must NOT create a camelCase noSync property
    expect(opts).not.toHaveProperty("noSync");
  });

  test("omitting the flag defaults opts.sync to true", () => {
    const opts = parseSyncFlag([]);
    expect(opts.sync).toBe(true);
  });

  test("skip expression matches what accounts.ts and history.ts use", () => {
    const withFlag = parseSyncFlag(["--no-sync"]);
    const withoutFlag = parseSyncFlag([]);

    // This is the exact expression used in accounts.ts:96 and history.ts:206
    expect(withFlag.sync === false).toBe(true);
    expect(withoutFlag.sync === false).toBe(false);
  });
});
