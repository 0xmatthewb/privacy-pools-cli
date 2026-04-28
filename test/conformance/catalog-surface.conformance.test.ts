import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRootProgram } from "../../src/program.ts";
import {
  COMMAND_CATALOG,
  type CommandSurface,
} from "../../src/utils/command-catalog.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const COMMAND_SURFACES = new Set<CommandSurface>([
  "root-command",
  "subcommand",
  "alias",
  "deprecated-compat",
  "doc-only",
  "native-local",
]);

function commandByPath(program: Command, path: string): Command | null {
  let current = program;
  for (const part of path.split(/\s+/)) {
    const next = current.commands.find(
      (command) => command.name() === part || command.aliases().includes(part),
    );
    if (!next) return null;
    current = next;
  }
  return current;
}

describe("catalog canonical surfaces", () => {
  test("command shell descriptions are sourced from command metadata", () => {
    for (const file of readdirSync(join(CLI_ROOT, "src", "command-shells"))) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(join(CLI_ROOT, "src", "command-shells", file), "utf8");
      expect(source).not.toMatch(/\.description\(\s*["'`]/);
      if (source.includes(".description(")) {
        expect(source).toContain("getCommandMetadata(");
      }
    }
  });

  test("every catalog entry declares a closed surface value", () => {
    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      expect(metadata.surface, path).toBeDefined();
      expect(COMMAND_SURFACES.has(metadata.surface)).toBe(true);
    }
  });

  test("modest surface invariants match the runtime shell", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: true,
      styledHelp: false,
    });
    const catalogPaths = new Set(Object.keys(COMMAND_CATALOG));

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface === "root-command") {
        expect(commandByPath(program, path), path).not.toBeNull();
      }
      if (metadata.surface === "subcommand" || metadata.surface === "deprecated-compat") {
        expect(catalogPaths.has(path.split(/\s+/)[0]!), path).toBe(true);
      }
      if (metadata.surface === "alias") {
        const target = metadata.aliases?.[0];
        expect(target && catalogPaths.has(target)).toBe(true);
      }
    }
  });
});
