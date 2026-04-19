/**
 * Output boundary conformance test.
 *
 * Enforces the renderer-boundary contract:
 *   - All commands delegate output formatting to `src/output/` renderers.
 *   - `printJsonSuccess` in migrated commands is limited to the small set of
 *     direct-JSON commands that intentionally bypass the renderer layer.
 *
 * All checks are source-level grep assertions: fast, deterministic, and
 * resistant to runtime import-order churn.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const CLI_ROOT = process.cwd();

const UNMIGRATED_COMMANDS: readonly string[] = [];
const ALL_COMMANDS = readdirSync(`${CLI_ROOT}/src/commands`)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => `src/commands/${file}`)
  .sort();
const MIGRATED_COMMANDS = ALL_COMMANDS.filter(
  (commandPath) => !UNMIGRATED_COMMANDS.includes(commandPath),
);

const DIRECT_JSON_COMMANDS = new Set([
  "src/commands/deposit.ts",
  "src/commands/ragequit.ts",
  "src/commands/simulate.ts",
  "src/commands/upgrade.ts",
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

  test("printJsonSuccess in migrated commands is limited to direct-json commands", () => {
    for (const cmd of MIGRATED_COMMANDS) {
      if (DIRECT_JSON_COMMANDS.has(cmd)) continue;
      const source = readSource(cmd);
      expect(source).not.toMatch(/\bprintJsonSuccess\s*\(/);
      expect(source).not.toMatch(
        /import\s*\{[^}]*\bprintJsonSuccess\b[^}]*\}\s*from\s+["'][^"']*utils\/json\.js["']/,
      );
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

  test("unmigrated command inventory only names real command files", () => {
    expect(UNMIGRATED_COMMANDS).toEqual(
      UNMIGRATED_COMMANDS.filter((commandPath) => ALL_COMMANDS.includes(commandPath)),
    );
  });
});
