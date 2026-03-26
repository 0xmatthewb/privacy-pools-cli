/**
 * Output boundary conformance test.
 *
 * Enforces the renderer-boundary contract:
 *   - All commands delegate output formatting to `src/output/` renderers.
 *   - `printJsonSuccess` in migrated commands is limited to unsigned-output
 *     paths that intentionally bypass the renderer layer.
 *
 * All checks are source-level grep assertions: fast, deterministic, and
 * resistant to runtime import-order churn.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const CLI_ROOT = process.cwd();

const MIGRATED_COMMANDS = [
  "src/commands/accounts.ts",
  "src/commands/activity.ts",
  "src/commands/capabilities.ts",
  "src/commands/completion.ts",
  "src/commands/deposit.ts",
  "src/commands/describe.ts",
  "src/commands/flow.ts",
  "src/commands/guide.ts",
  "src/commands/history.ts",
  "src/commands/init.ts",
  "src/commands/pools.ts",
  "src/commands/ragequit.ts",
  "src/commands/stats.ts",
  "src/commands/status.ts",
  "src/commands/sync.ts",
  "src/commands/withdraw.ts",
] as const;

const UNMIGRATED_COMMANDS: readonly string[] = [];

const UNSIGNED_PATH_COMMANDS = new Set([
  "src/commands/deposit.ts",
  "src/commands/ragequit.ts",
  "src/commands/withdraw.ts",
]);

function readSource(relPath: string): string {
  return readFileSync(`${CLI_ROOT}/${relPath}`, "utf8");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRendererExportedSymbols(relPath: string): string[] {
  const source = readSource(relPath);
  const names = new Set<string>();

  const functionRegex = /^export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/gm;
  const interfaceRegex = /^export\s+interface\s+([A-Za-z_]\w*)/gm;
  const typeRegex = /^export\s+type\s+([A-Za-z_]\w*)\s*=/gm;

  for (const regex of [functionRegex, interfaceRegex, typeRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      names.add(match[1]);
    }
  }

  return [...names];
}

describe("output boundary conformance", () => {
  test("migrated commands import from the output module", () => {
    for (const cmd of MIGRATED_COMMANDS) {
      const source = readSource(cmd);
      expect(source).toMatch(/from\s+["']\.\.\/output\//);
    }
  });

  test("migrated commands do not use printTable directly", () => {
    for (const cmd of MIGRATED_COMMANDS) {
      const source = readSource(cmd);
      expect(source).not.toMatch(/\bprintTable\s*\(/);
    }
  });

  test("printJsonSuccess in migrated commands is limited to unsigned-path commands", () => {
    for (const cmd of MIGRATED_COMMANDS) {
      if (UNSIGNED_PATH_COMMANDS.has(cmd)) continue;
      const source = readSource(cmd);
      expect(source).not.toMatch(/\bprintJsonSuccess\s*\(/);
      expect(source).not.toMatch(/from\s+["'][^"']*utils\/json\.js["']/);
    }
  });

  test("every renderer in src/output/ is re-exported from mod.ts with symbol coverage", () => {
    const modSource = readSource("src/output/mod.ts");
    const rendererFiles = readdirSync(`${CLI_ROOT}/src/output`)
      .filter((file) => file.endsWith(".ts") && file !== "mod.ts" && file !== "common.ts" && file !== "csv.ts");

    for (const file of rendererFiles) {
      const baseName = file.replace(/\.ts$/, "");
      expect(modSource).toContain(`./${baseName}.js`);

      const symbols = getRendererExportedSymbols(`src/output/${file}`);
      for (const symbol of symbols) {
        expect(modSource).toMatch(
          new RegExp(`\\b${escapeRegex(symbol)}\\b`),
        );
      }
    }
  });

  test("unmigrated commands have not been partially wired to the output module", () => {
    for (const cmd of UNMIGRATED_COMMANDS) {
      const source = readSource(cmd);
      expect(source).not.toMatch(/from\s+["']\.\.\/output\//);
    }
  });

  test("every command file is listed in either MIGRATED or UNMIGRATED", () => {
    const allCommands = readdirSync(`${CLI_ROOT}/src/commands`)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => `src/commands/${file}`)
      .sort();

    const listed = [...MIGRATED_COMMANDS, ...UNMIGRATED_COMMANDS].sort();

    expect(allCommands).toEqual(listed);
  });
});
