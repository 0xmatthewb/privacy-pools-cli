import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

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
      if (entry.isFile() && [".ts", ".js", ".mjs", ".md"].includes(extname(entry.name))) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

describe("testing policy conformance", () => {
  test("root TESTING.md entrypoint is published for contributors", () => {
    expect(existsSync(join(CLI_ROOT, "TESTING.md"))).toBe(true);
  });

  test("repo tests do not use Jest-style transcript snapshots", () => {
    const offenders = collectFiles(join(CLI_ROOT, "test")).filter((filePath) => {
      if (filePath.endsWith("testing-policy.conformance.test.ts")) {
        return false;
      }
      const source = readFileSync(filePath, "utf8");
      return (
        source.includes("toMatchSnapshot(") ||
        source.includes("toMatchInlineSnapshot(")
      );
    });

    expect(offenders).toEqual([]);
  });

  test("smoke-lane integration tests avoid source inventory equality checks", () => {
    const smokeFiles = collectFiles(join(CLI_ROOT, "test", "integration"))
      .filter((filePath) => {
        const name = basename(filePath);
        return name.includes("smoke") || name.includes("packaged");
      });

    expect(smokeFiles.length).toBeGreaterThan(0);
    for (const filePath of smokeFiles) {
      const source = readFileSync(filePath, "utf8");
      expect(source).not.toContain("sourceBaseNames(");
      expect(source).not.toContain("packedBaseNames(");
      expect(source).not.toContain('dist/commands/');
      expect(source).not.toContain('dist/output/');
    }
  });
});
