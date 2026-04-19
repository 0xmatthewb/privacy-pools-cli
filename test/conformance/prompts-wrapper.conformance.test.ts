import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(import.meta.dir, "../../src");
const WRAPPER_PATH = join(SRC_ROOT, "utils", "prompts.ts");

function collectSourceFiles(root: string): string[] {
  const entries = readdirSync(root).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (path.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
}

describe("prompts wrapper conformance", () => {
  test("src routes @inquirer/prompts access through utils/prompts.ts", () => {
    const directImports = collectSourceFiles(SRC_ROOT)
      .filter((path) => path !== WRAPPER_PATH)
      .filter((path) => readFileSync(path, "utf8").includes("@inquirer/prompts"))
      .map((path) => relative(SRC_ROOT, path));

    expect(directImports).toEqual([]);
  });
});
