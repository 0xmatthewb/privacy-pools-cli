import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_CWD,
  cliTestInternals,
} from "../helpers/cli.ts";

describe("built cli helper isolation", () => {
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
