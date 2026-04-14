import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const TEST_ROOT = resolve(process.cwd(), "test");
const JUNK_FILENAMES = new Set([".DS_Store", "Thumbs.db"]);
const RAW_MKDTEMP_PATTERN = "mkdtemp" + "Sync(";
const FOCUSED_TEST_PATTERNS = [
  /\.only\s*\(/,
  /\bfit\s*\(/,
  /\bfdescribe\s*\(/,
];
const DISABLED_TEST_PATTERNS = [
  /\b(?:test|describe)\.(?:skip|todo)\s*\(/,
];

function collectFiles(root: string): string[] {
  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

describe("test hygiene conformance", () => {
  const files = collectFiles(TEST_ROOT);
  const repoPaths = files.map((file) => relative(process.cwd(), file).replaceAll("\\", "/"));

  test("test tree does not contain OS junk files", () => {
    const junkFiles = repoPaths.filter((file) => JUNK_FILENAMES.has(file.split("/").at(-1)!));
    expect(junkFiles).toEqual([]);
  });

  test("suite does not commit focused tests", () => {
    const focusedMatches: string[] = [];

    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of FOCUSED_TEST_PATTERNS) {
        if (pattern.test(source)) {
          focusedMatches.push(relative(process.cwd(), file).replaceAll("\\", "/"));
          break;
        }
      }
    }

    expect(focusedMatches).toEqual([]);
  });

  test("suite does not commit direct skipped or todo tests", () => {
    const disabledMatches: string[] = [];

    for (const file of files) {
      if (!file.endsWith(".ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of DISABLED_TEST_PATTERNS) {
        if (pattern.test(source)) {
          disabledMatches.push(relative(process.cwd(), file).replaceAll("\\", "/"));
          break;
        }
      }
    }

    expect(disabledMatches).toEqual([]);
  });

  test("non-helper tests use tracked temp-dir helpers instead of raw mkdtempSync", () => {
    const offendingFiles = files
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => !file.includes(`${resolve(TEST_ROOT, "helpers")}`))
      .filter((file) => !file.includes(`${resolve(TEST_ROOT, "fixtures")}`))
      .filter((file) => readFileSync(file, "utf8").includes(RAW_MKDTEMP_PATTERN))
      .map((file) => relative(process.cwd(), file).replaceAll("\\", "/"));

    expect(offendingFiles).toEqual([]);
  });
});
