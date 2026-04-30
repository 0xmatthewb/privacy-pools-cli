import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import { ERROR_CODE_REGISTRY } from "../../src/utils/error-code-registry.ts";
import { defaultErrorCode, type ErrorCategory } from "../../src/utils/errors.ts";

function source(path: string): string {
  return readFileSync(join(CLI_ROOT, path), "utf8");
}

const ERROR_WRAPPER_MODULES = new Set([
  "src/utils/errors.ts",
  "src/utils/errors/factories.ts",
]);

function listTypescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listTypescriptFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [path];
  });
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed CLIError constructor at offset ${openIndex}.`);
}

function splitTopLevelArgs(argsText: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < argsText.length; index += 1) {
    const char = argsText[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if ("([{".includes(char)) depth += 1;
    if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      args.push(argsText.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = argsText.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}

function stringLiteralValue(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed.at(-1) !== quote) return null;
  return trimmed.slice(1, -1);
}

function lineForOffset(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

interface CliErrorConstructionSite {
  file: string;
  line: number;
  args: string[];
}

function findCliErrorConstructionSites(): CliErrorConstructionSite[] {
  const sites: CliErrorConstructionSite[] = [];
  for (const absolutePath of listTypescriptFiles(join(CLI_ROOT, "src"))) {
    const file = relative(CLI_ROOT, absolutePath);
    const text = readFileSync(absolutePath, "utf8");
    const matcher = /\bnew\s+CLIError\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text)) !== null) {
      const openIndex = text.indexOf("(", match.index);
      const closeIndex = findMatchingParen(text, openIndex);
      sites.push({
        file,
        line: lineForOffset(text, match.index),
        args: splitTopLevelArgs(text.slice(openIndex + 1, closeIndex)),
      });
      matcher.lastIndex = closeIndex + 1;
    }
  }
  return sites;
}

describe("error factory adoption", () => {
  test("new pools input errors use branded factory helpers", () => {
    const text = source("src/commands/pools.ts");
    expect(text).toContain("../utils/errors/factories.js");
    expect(text).toContain("inputError(");
  });

  test("bare CLIError construction sites stay ratcheted and literal codes are registered", () => {
    const baseline = JSON.parse(
      source("test/baselines/cli-error-bare-construction-count.json"),
    ) as { bareConstructionCount: number };
    const bareDynamicSites: string[] = [];
    const missingRegisteredCodes: string[] = [];

    for (const site of findCliErrorConstructionSites()) {
      const category = stringLiteralValue(site.args[1]);
      const code = stringLiteralValue(site.args[3]);
      const helperWrapped = ERROR_WRAPPER_MODULES.has(site.file);

      if (category) {
        const effectiveCode = code ?? defaultErrorCode(category as ErrorCategory);
        if (!(effectiveCode in ERROR_CODE_REGISTRY)) {
          missingRegisteredCodes.push(`${effectiveCode} at ${site.file}:${site.line}`);
        }
        continue;
      }

      if (!helperWrapped) {
        bareDynamicSites.push(`${site.file}:${site.line}`);
      }
    }

    expect(missingRegisteredCodes).toEqual([]);
    expect(bareDynamicSites.length).toBeLessThanOrEqual(
      baseline.bareConstructionCount,
    );
  });
});
