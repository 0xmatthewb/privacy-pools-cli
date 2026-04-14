import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  PREVIEW_PROGRESS_ALLOWLIST,
  PREVIEW_PROGRESS_CALLSITE_PATTERNS,
  PREVIEW_PROGRESS_INVENTORY,
} from "../../scripts/lib/preview-cli-catalog.mjs";

interface CallsiteMatch {
  file: string;
  line: number;
  callee: string;
  source: string;
  stepId?: string;
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

function normalizeCallsiteSource(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

function canonicalizeForMatch(value: string): string {
  return value.replace(/\s+/g, "");
}

function collectTsProgressCallsites(file: string): CallsiteMatch[] {
  const sourceText = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const matches: CallsiteMatch[] = [];
  const trackedCallees = new Set([
    "spinner",
    "stageHeader",
    "maybeRenderPreviewProgressStep",
    "writeWorkflowNarrativeProgress",
    "formatMigrationLoadingText",
  ]);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (trackedCallees.has(callee)) {
        const start = node.getStart(sourceFile);
        const line = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const firstArg = node.arguments[0];
        const stepId =
          callee === "maybeRenderPreviewProgressStep" && firstArg && ts.isStringLiteralLike(firstArg)
            ? firstArg.text
            : undefined;
        matches.push({
          file: relativeRepoPath(file),
          line,
          callee,
          source: normalizeCallsiteSource(node.getText(sourceFile)),
          stepId,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

function extractBalancedCall(
  sourceText: string,
  openParenIndex: number,
): string | null {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escapeNext = false;

  for (let index = openParenIndex; index < sourceText.length; index += 1) {
    const char = sourceText[index];

    if (quote) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return sourceText.slice(openParenIndex, index + 1);
      }
    }
  }

  return null;
}

function collectRustProgressCallsites(file: string): CallsiteMatch[] {
  const sourceText = readFileSync(file, "utf8");
  const matches: CallsiteMatch[] = [];
  const regex = /\b(start_spinner)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sourceText)) !== null) {
    const startIndex = match.index;
    const openParenIndex = sourceText.indexOf("(", startIndex);
    const callText = extractBalancedCall(sourceText, openParenIndex);
    if (!callText) {
      continue;
    }

    const source = normalizeCallsiteSource(
      `${match[1]}${callText}`,
    );
    const line = sourceText.slice(0, startIndex).split("\n").length;
    matches.push({
      file: relativeRepoPath(file),
      line,
      callee: match[1],
      source,
    });
  }

  return matches;
}

function collectProgressCallsites(): CallsiteMatch[] {
  const files = SCAN_ROOTS.flatMap((path) => walkFiles(path)).filter((path) =>
    path.endsWith(".ts") || path.endsWith(".rs")
  );

  return files.flatMap((file) =>
    file.endsWith(".ts")
      ? collectTsProgressCallsites(file)
      : collectRustProgressCallsites(file)
  );
}

function matchingCallsite(
  callsites: readonly CallsiteMatch[],
  pattern: { file: string; pattern: string },
): CallsiteMatch | undefined {
  const canonicalPattern = canonicalizeForMatch(pattern.pattern);
  return callsites.find(
    (callsite) =>
      callsite.file === pattern.file
      && canonicalizeForMatch(callsite.source).includes(canonicalPattern),
  );
}

describe("preview progress coverage conformance", () => {
  const callsites = collectProgressCallsites();

  test("callsite coverage patterns point to declared preview progress inventory", () => {
    const declaredSteps = new Set(
      PREVIEW_PROGRESS_INVENTORY.map((entry) => entry.progressStep),
    );

    for (const pattern of PREVIEW_PROGRESS_CALLSITE_PATTERNS) {
      expect(declaredSteps.has(pattern.progressStep)).toBe(true);
    }
  });

  test("declared progress patterns resolve to real structured callsites", () => {
    for (const pattern of PREVIEW_PROGRESS_CALLSITE_PATTERNS) {
      expect(matchingCallsite(callsites, pattern)).toBeDefined();
    }
  });

  test("preview progress step calls use declared inventory step ids", () => {
    const declaredSteps = new Set(
      PREVIEW_PROGRESS_INVENTORY.map((entry) => entry.progressStep),
    );

    for (const callsite of callsites.filter(
      (entry) => entry.callee === "maybeRenderPreviewProgressStep",
    )) {
      expect(callsite.stepId).toBeTruthy();
      expect(declaredSteps.has(callsite.stepId!)).toBe(true);
    }
  });

  test("allowlisted progress callsites document a reason and resolve to a real callsite", () => {
    for (const entry of PREVIEW_PROGRESS_ALLOWLIST) {
      expect(entry.file).toBeTruthy();
      expect(entry.pattern).toBeTruthy();
      expect(entry.reason?.trim().length ?? 0).toBeGreaterThan(0);
      expect(matchingCallsite(callsites, entry)).toBeDefined();
    }
  });

  test("every human-facing progress callsite is either preview-covered or allowlisted", () => {
    const declaredSteps = new Set(
      PREVIEW_PROGRESS_INVENTORY.map((entry) => entry.progressStep),
    );
    const uncovered = callsites.filter((callsite) => {
      if (callsite.callee === "maybeRenderPreviewProgressStep") {
        return !callsite.stepId || !declaredSteps.has(callsite.stepId);
      }

      const covered = PREVIEW_PROGRESS_CALLSITE_PATTERNS.some(
        (pattern) => matchingCallsite([callsite], pattern) !== undefined,
      );
      if (covered) {
        return false;
      }

      return !PREVIEW_PROGRESS_ALLOWLIST.some(
        (entry) => matchingCallsite([callsite], entry) !== undefined,
      );
    });

    expect(uncovered).toEqual([]);
  });
});
