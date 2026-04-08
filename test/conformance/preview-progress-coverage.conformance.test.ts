import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  PREVIEW_PROGRESS_ALLOWLIST,
  PREVIEW_PROGRESS_CALLSITE_PATTERNS,
  PREVIEW_PROGRESS_INVENTORY,
} from "../../scripts/lib/preview-cli-catalog.mjs";

interface CallsiteMatch {
  file: string;
  line: number;
  block: string;
}

const SCAN_ROOTS = [
  join(CLI_ROOT, "src", "commands"),
  join(CLI_ROOT, "src", "services", "workflow.ts"),
  join(CLI_ROOT, "native", "shell", "src", "commands"),
];

function walkFiles(path: string): string[] {
  const stats = statSync(path);
  if (stats.isFile()) {
    return [path];
  }

  return readdirSync(path)
    .sort()
    .flatMap((entry) => walkFiles(join(path, entry)));
}

function relativeRepoPath(path: string): string {
  return relative(CLI_ROOT, path).replaceAll("\\", "/");
}

function collectProgressCallsites(): CallsiteMatch[] {
  const files = SCAN_ROOTS.flatMap((path) => walkFiles(path)).filter((path) =>
    path.endsWith(".ts") || path.endsWith(".rs")
  );
  const matches: CallsiteMatch[] = [];

  for (const file of files) {
    const relativeFile = relativeRepoPath(file);
    const lines = readFileSync(file, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!/\b(spinner|stageHeader|start_spinner)\(/.test(lines[index])) {
        continue;
      }
      matches.push({
        file: relativeFile,
        line: index + 1,
        block: lines.slice(index, index + 6).join("\n"),
      });
    }
  }

  return matches;
}

describe("preview progress coverage conformance", () => {
  test("callsite coverage patterns point to declared preview progress inventory", () => {
    const declaredSteps = new Set(
      PREVIEW_PROGRESS_INVENTORY.map((entry) => entry.progressStep),
    );

    for (const pattern of PREVIEW_PROGRESS_CALLSITE_PATTERNS) {
      expect(declaredSteps.has(pattern.progressStep)).toBe(true);
    }
  });

  test("allowlisted progress callsites document a reason", () => {
    for (const entry of PREVIEW_PROGRESS_ALLOWLIST) {
      expect(entry.file).toBeTruthy();
      expect(entry.pattern).toBeTruthy();
      expect(entry.reason?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  test("every human-facing progress callsite is either preview-covered or allowlisted", () => {
    const uncovered = collectProgressCallsites().filter((callsite) => {
      const covered = PREVIEW_PROGRESS_CALLSITE_PATTERNS.some(
        (pattern) =>
          pattern.file === callsite.file && callsite.block.includes(pattern.pattern),
      );
      if (covered) {
        return false;
      }

      return !PREVIEW_PROGRESS_ALLOWLIST.some(
        (entry) =>
          entry.file === callsite.file && callsite.block.includes(entry.pattern),
      );
    });

    expect(uncovered).toEqual([]);
  });
});
