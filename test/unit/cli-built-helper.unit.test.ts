import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_CWD,
  cliTestInternals,
} from "../helpers/cli.ts";

describe("built cli helper isolation", () => {
  test("shared snapshot env overrides the private per-process snapshot", () => {
    const previous = process.env[cliTestInternals.SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV];
    process.env[cliTestInternals.SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV] = "/tmp/shared-built-workspace";

    try {
      const resolved = cliTestInternals.resolveBuiltCliInvocation(CLI_CWD);

      expect(resolved.cwd).toBe("/tmp/shared-built-workspace");
      expect(resolved.binPath).toBe("dist/index.js");
    } finally {
      if (previous === undefined) {
        delete process.env[cliTestInternals.SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV];
      } else {
        process.env[cliTestInternals.SHARED_BUILT_WORKSPACE_SNAPSHOT_ENV] = previous;
      }
    }
  });

  test("repo-root built runs use a private built workspace snapshot", () => {
    const resolved = cliTestInternals.resolveBuiltCliInvocation(CLI_CWD);

    expect(resolved.cwd).not.toBe(CLI_CWD);
    expect(resolved.binPath).toBe("dist/index.js");
    expect(existsSync(join(resolved.cwd, "package.json"))).toBe(true);
    expect(existsSync(join(resolved.cwd, "dist", "index.js"))).toBe(true);
    expect(existsSync(join(resolved.cwd, "node_modules"))).toBe(true);

    const cached = cliTestInternals.resolveBuiltCliInvocation(CLI_CWD);
    expect(cached.cwd).toBe(resolved.cwd);
  });

  test("custom built workspaces and explicit bin paths bypass repo-root isolation", () => {
    expect(
      cliTestInternals.shouldUseIsolatedBuiltWorkspace(CLI_CWD),
    ).toBe(true);
    expect(
      cliTestInternals.shouldUseIsolatedBuiltWorkspace(
        CLI_CWD,
        "dist/index.js",
      ),
    ).toBe(true);
    expect(
      cliTestInternals.shouldUseIsolatedBuiltWorkspace("/tmp/custom-built-root"),
    ).toBe(false);
    expect(
      cliTestInternals.shouldUseIsolatedBuiltWorkspace(
        CLI_CWD,
        "/tmp/custom-built-root/dist/index.js",
      ),
    ).toBe(false);
  });
});
