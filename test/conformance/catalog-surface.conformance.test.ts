import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRootProgram } from "../../src/program.ts";
import { STATIC_COMMAND_PATHS } from "../../src/utils/command-discovery-static.ts";
import {
  COMMAND_CATALOG,
  type CommandSurface,
} from "../../src/utils/command-catalog.ts";
import {
  DEPRECATION_INVENTORY,
  type DeprecationMode,
} from "../../src/utils/deprecations.ts";
import { CLI_ROOT } from "../helpers/paths.ts";
import { parseJsonOutput, runBuiltCli } from "../helpers/cli.ts";

const COMMAND_SURFACES = new Set<CommandSurface>([
  "root-command",
  "subcommand",
  "alias",
  "deprecated-compat",
  "doc-only",
  "native-local",
]);

const NATIVE_MANIFEST = JSON.parse(
  readFileSync(
    join(CLI_ROOT, "native", "shell", "generated", "manifest.json"),
    "utf8",
  ),
) as { commandPaths: string[] };

type DeprecationExpectation = NonNullable<
  (typeof DEPRECATION_INVENTORY)[number]["expectations"][DeprecationMode]
>;

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

function parentPath(path: string): string | null {
  const parts = path.split(/\s+/);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(" ");
}

function argvForDeprecationMode(
  argv: readonly string[],
  mode: DeprecationMode,
): string[] {
  if (mode === "human") return [...argv];
  return [...argv, mode === "json" ? "--json" : "--agent"];
}

function expectDeprecationWarning(
  entry: (typeof DEPRECATION_INVENTORY)[number],
  mode: DeprecationMode,
  expectation: DeprecationExpectation,
): void {
  expect(entry.testArgv, entry.id).toBeDefined();
  const result = runBuiltCli(argvForDeprecationMode(entry.testArgv!, mode), {
    env: {
      PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
    },
  });
  expect(result.status, entry.id).toBe(0);

  if (expectation.stream === "stderr") {
    expect(result.stderr, entry.id).toContain(entry.message);
    expect(result.stdout, entry.id).not.toContain(entry.message);
    return;
  }

  expect(result.stderr, entry.id).not.toContain(entry.message);
  const payload = parseJsonOutput<{
    deprecationWarning?: {
      code?: string;
      message?: string;
      replacementCommand?: string;
    };
  }>(result.stdout);
  expect(payload.deprecationWarning, entry.id).toEqual({
    code: entry.code,
    message: entry.message,
    replacementCommand: entry.replacementCommand,
  });
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

  test("stable surfaces are present in static discovery and generated docs", () => {
    const staticPaths = new Set<string>(STATIC_COMMAND_PATHS);
    const nativeManifestPaths = new Set(NATIVE_MANIFEST.commandPaths);

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface === "root-command" || metadata.surface === "subcommand") {
        expect(staticPaths.has(path), path).toBe(true);
        expect(nativeManifestPaths.has(path), path).toBe(true);
      }

      if (metadata.surface === "root-command") {
        expect(existsSync(join(CLI_ROOT, "docs", "reference", `${path}.md`)), path).toBe(
          true,
        );
      }
    }
  });

  test("subcommand surfaces exist under the runtime and generated parents", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: true,
      styledHelp: false,
    });
    const staticPaths = new Set<string>(STATIC_COMMAND_PATHS);
    const nativeManifestPaths = new Set(NATIVE_MANIFEST.commandPaths);

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface !== "subcommand") continue;

      const parent = parentPath(path);
      expect(parent, path).not.toBeNull();
      expect(commandByPath(program, parent!), path).not.toBeNull();
      expect(commandByPath(program, path), path).not.toBeNull();
      expect(staticPaths.has(path), path).toBe(true);
      expect(staticPaths.has(parent!), path).toBe(true);
      expect(nativeManifestPaths.has(path), path).toBe(true);
      expect(nativeManifestPaths.has(parent!), path).toBe(true);
    }
  });

  test("alias surfaces are backed by explicit deprecation inventory entries", () => {
    const deprecatedCommands = new Set(
      DEPRECATION_INVENTORY.flatMap((entry) => [entry.from, entry.to]),
    );

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface !== "alias") continue;
      expect(deprecatedCommands.has(path), path).toBe(true);
      for (const alias of metadata.aliases ?? []) {
        expect(deprecatedCommands.has(alias), `${path} alias ${alias}`).toBe(true);
      }
    }
  });

  test("deprecated compatibility surfaces are represented and emit their warnings", () => {
    const inventoryByFrom = new Map(
      DEPRECATION_INVENTORY.map((entry) => [entry.from, entry]),
    );

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface !== "deprecated-compat") continue;

      const entry = inventoryByFrom.get(path);
      expect(entry, path).toBeDefined();
      expect(entry?.to, path).toBeDefined();

      if (!entry || entry.testExcludedReason) continue;
      for (const [mode, expectation] of Object.entries(entry.expectations) as Array<
        [DeprecationMode, DeprecationExpectation]
      >) {
        expectDeprecationWarning(entry, mode, expectation);
      }
    }
  });

  test("doc-only surfaces have generated reference documentation", () => {
    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface !== "doc-only") continue;
      expect(existsSync(join(CLI_ROOT, "docs", "reference", `${path}.md`)), path).toBe(
        true,
      );
    }
  });

  test("native-local surfaces are present in the native manifest", () => {
    const nativeManifestPaths = new Set(NATIVE_MANIFEST.commandPaths);

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.surface !== "native-local") continue;
      expect(nativeManifestPaths.has(path), path).toBe(true);
    }
  });
});
