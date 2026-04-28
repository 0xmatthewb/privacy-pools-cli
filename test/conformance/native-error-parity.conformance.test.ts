import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT_CODES } from "../../src/utils/errors.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function readRepoFile(path: string): string {
  return readFileSync(join(CLI_ROOT, path), "utf8");
}

function parseNativeCategoryNames(source: string): Map<string, string> {
  const match = source.match(/pub enum ErrorCategory \{([\s\S]*?)\n\}/);
  if (!match) throw new Error("Could not parse native ErrorCategory enum.");
  const variants = match[1]!
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").replace(/,$/, "").trim())
    .filter(Boolean);

  const names = new Map<string, string>();
  for (const variant of variants) {
    const categoryMatch = source.match(
      new RegExp(`ErrorCategory::${variant}\\s*=>\\s*"([A-Z]+)"`),
    );
    if (!categoryMatch) {
      throw new Error(`Could not parse native category string for ${variant}.`);
    }
    names.set(variant, categoryMatch[1]!);
  }
  return names;
}

function parseNativeExitCodes(source: string): Map<string, number> {
  const codes = new Map<string, number>();
  for (const match of source.matchAll(/ErrorCategory::([A-Za-z]+)\s*=>\s*(\d+)/g)) {
    codes.set(match[1]!, Number(match[2]));
  }
  return codes;
}

describe("native error category parity", () => {
  test("native ErrorCategory is a documented subset of JS categories with matching exit codes", () => {
    const nativeSource = readRepoFile("native/shell/src/error.rs");
    expect(readRepoFile("src/utils/errors.ts")).toContain("export type ErrorCategory");

    const exclusions = new Set(
      JSON.parse(
        readRepoFile("test/fixtures/native-error-category-exclusions.json"),
      ) as string[],
    );
    const nativeNames = parseNativeCategoryNames(nativeSource);
    const nativeExitCodes = parseNativeExitCodes(nativeSource);
    const nativeCategories = new Set(nativeNames.values());

    for (const [variant, category] of nativeNames) {
      expect(EXIT_CODES).toHaveProperty(category);
      expect(nativeExitCodes.get(variant)).toBe(
        EXIT_CODES[category as keyof typeof EXIT_CODES],
      );
    }

    const jsOnlyCategories = Object.keys(EXIT_CODES).filter(
      (category) => !nativeCategories.has(category),
    );
    expect(jsOnlyCategories).toEqual([...exclusions]);
  });
});
