import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

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
    try {
      mkdirSync(join(CLI_ROOT, "dist", "commands"), { recursive: true });
      mkdirSync(join(CLI_ROOT, "dist", "output"), { recursive: true });
      writeFileSync(join(CLI_ROOT, "dist", "commands", "balance.js"), "export {};\n");
      writeFileSync(join(CLI_ROOT, "dist", "output", "balance.js"), "export {};\n");

      const build = spawnSync("npm", ["run", "-s", "build"], {
        cwd: CLI_ROOT,
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

      const srcCommands = sourceBaseNames(join(CLI_ROOT, "src", "commands"));
      const srcOutput = sourceBaseNames(join(CLI_ROOT, "src", "output"));
      const distCommands = compiledBaseNames(join(CLI_ROOT, "dist", "commands"));
      const distOutput = compiledBaseNames(join(CLI_ROOT, "dist", "output"));

      expect(distCommands.has("balance")).toBe(false);
      expect(distOutput.has("balance")).toBe(false);
      expect([...distCommands].filter((name) => !srcCommands.has(name))).toEqual([]);
      expect([...distOutput].filter((name) => !srcOutput.has(name))).toEqual([]);
    } finally {
      rmSync(join(CLI_ROOT, "dist"), { recursive: true, force: true });
    }
  }, 120_000);
});
