import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { createWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";

function compiledBaseNames(dir: string): Set<string> {
  return new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(".js") || name.endsWith(".d.ts"))
      .map((name) => name.replace(/(\.d)?\.ts$|\.js$/g, "")),
  );
}

function sourceBaseNames(dir: string): Set<string> {
  return new Set(
    readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.replace(/\.ts$/g, "")),
  );
}

describe("compiled artifact hygiene", () => {
  test("build removes stale dist command/output files and leaves no orphaned artifacts", () => {
    const snapshotRoot = createWorkspaceSnapshot();

    mkdirSync(join(snapshotRoot, "dist", "commands"), { recursive: true });
    mkdirSync(join(snapshotRoot, "dist", "output"), { recursive: true });
    writeFileSync(join(snapshotRoot, "dist", "commands", "balance.js"), "export {};\n");
    writeFileSync(join(snapshotRoot, "dist", "output", "balance.js"), "export {};\n");

    const build = spawnSync("npm", ["run", "-s", "build"], {
      cwd: snapshotRoot,
      encoding: "utf8",
      timeout: 120_000,
      env: buildChildProcessEnv({
        PP_NO_UPDATE_CHECK: "1",
      }),
    });

    if (build.status !== 0) {
      throw new Error(
        `build failed (exit ${build.status}):\n${build.stderr}\n${build.stdout}`,
      );
    }

    const srcCommands = sourceBaseNames(join(snapshotRoot, "src", "commands"));
    const srcOutput = sourceBaseNames(join(snapshotRoot, "src", "output"));
    const distCommands = compiledBaseNames(join(snapshotRoot, "dist", "commands"));
    const distOutput = compiledBaseNames(join(snapshotRoot, "dist", "output"));

    expect(distCommands.has("balance")).toBe(false);
    expect(distOutput.has("balance")).toBe(false);
    expect([...distCommands].filter((name) => !srcCommands.has(name))).toEqual([]);
    expect([...distOutput].filter((name) => !srcOutput.has(name))).toEqual([]);
  }, 120_000);
});
