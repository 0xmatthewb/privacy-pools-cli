import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { isKnownRunnerEnvKey } from "../../scripts/lib/env-allowlist.mjs";
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

function collectVagueExpectationPairs(root: string): string[] {
  const strongerMatchers = new Set([
    "toBe",
    "toEqual",
    "toStrictEqual",
    "toMatch",
    "toMatchObject",
    "toContain",
    "toHaveLength",
    "toBeInstanceOf",
    "toThrow",
    "toHaveProperty",
    "toHaveBeenCalled",
    "toHaveBeenCalledTimes",
    "toHaveBeenCalledWith",
    "toBeGreaterThan",
    "toBeGreaterThanOrEqual",
    "toBeLessThan",
    "toBeLessThanOrEqual",
  ]);
  const offenders: string[] = [];

  for (const filePath of collectFiles(root)) {
    if (filePath.endsWith("testing-policy.conformance.test.ts")) {
      continue;
    }

    const lines = readFileSync(filePath, "utf8").split("\n");
    for (let index = 0; index < lines.length - 1; index += 1) {
      const vagueMatch = lines[index]?.match(
        /expect\((.+)\)\.(toBeDefined|toBeTruthy)\(\);?\s*$/,
      );
      if (!vagueMatch) continue;

      const expression = vagueMatch[1]?.replace(/\s+/g, " ").trim();
      if (!expression) continue;

      for (
        let lookahead = index + 1;
        lookahead < Math.min(lines.length, index + 4);
        lookahead += 1
      ) {
        const strongerMatch = lines[lookahead]?.match(
          /expect\((.+)\)\.(\w+)\(/,
        );
        if (!strongerMatch) continue;

        const strongerExpression = strongerMatch[1]?.replace(/\s+/g, " ").trim();
        const matcher = strongerMatch[2];
        if (strongerExpression !== expression || !matcher) {
          continue;
        }
        if (!strongerMatchers.has(matcher)) {
          continue;
        }

        offenders.push(
          `${filePath}:${index + 1} repeats ${vagueMatch[2]} before ${matcher} on ${expression}`,
        );
      }
    }
  }

  return offenders;
}

function collectUnclassifiedRunnerEnvKeys(root: string): string[] {
  const offenders: string[] = [];

  for (const filePath of collectFiles(root)) {
    const source = readFileSync(filePath, "utf8");
    const matches = source.match(/\bPP_[A-Z0-9_]+\b/g) ?? [];
    const uniqueMatches = new Set(matches);

    for (const match of uniqueMatches) {
      if (isKnownRunnerEnvKey(match)) {
        continue;
      }
      offenders.push(`${filePath}: unclassified runner env key ${match}`);
    }
  }

  return offenders.sort((left, right) => left.localeCompare(right));
}

const TEST_WORLD_HOME_WRITE_ALLOWLIST = new Set([
  "test/services/account.service.test.ts",
  "test/services/account.sync-events.service.test.ts",
  "test/services/circuits.service.test.ts",
  "test/services/submissions.service.test.ts",
  "test/services/wallet.service.test.ts",
  "test/services/workflow.anvil.service.test.ts",
  "test/services/workflow.backup-paths.service.test.ts",
  "test/services/workflow.funding.helpers.service.test.ts",
  "test/services/workflow.helpers.service.test.ts",
  "test/services/workflow.internal.service.test.ts",
  "test/unit/bootstrap-runtime.unit.test.ts",
  "test/unit/broadcast-command-handler.unit.test.ts",
  "test/unit/cli-main.helpers.unit.test.ts",
  "test/unit/completion-query.unit.test.ts",
  "test/unit/config-command.unit.test.ts",
  "test/unit/config.unit.test.ts",
  "test/unit/init-command-handler.unit.test.ts",
  "test/unit/init-command.helpers.unit.test.ts",
  "test/unit/init-command.interactive-helpers.unit.test.ts",
  "test/unit/launcher-runtime.unit.test.ts",
  "test/unit/lock.unit.test.ts",
  "test/unit/public-command-handlers.unit.test.ts",
  "test/unit/status-command-handler.unit.test.ts",
  "test/unit/update-check.runtime.unit.test.ts",
  "test/unit/update-check.unit.test.ts",
  "test/unit/utility-command-handlers.unit.test.ts",
  "test/unit/welcome-readiness.unit.test.ts",
]);

function collectNonTestWorldHomeWrites(root: string): string[] {
  const offenders: string[] = [];

  for (const filePath of collectFiles(root)) {
    const relativePath = filePath.replace(`${CLI_ROOT}/`, "");
    const source = readFileSync(filePath, "utf8");
    const writesPrivacyPoolsHome =
      /process\.env\.PRIVACY_POOLS_HOME\s*=/.test(source) ||
      /delete\s+process\.env\.PRIVACY_POOLS_HOME/.test(source);

    if (!writesPrivacyPoolsHome) {
      continue;
    }
    if (source.includes("createTestWorld(")) {
      continue;
    }
    if (TEST_WORLD_HOME_WRITE_ALLOWLIST.has(relativePath)) {
      continue;
    }

    offenders.push(relativePath);
  }

  return offenders.sort((left, right) => left.localeCompare(right));
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

  test("tests do not pair vague presence checks with stronger assertions on the same value", () => {
    expect(collectVagueExpectationPairs(join(CLI_ROOT, "test"))).toEqual([]);
  });

  test("scripts classify every shipped PP_* runner env key", () => {
    expect(collectUnclassifiedRunnerEnvKeys(join(CLI_ROOT, "scripts"))).toEqual([]);
  });

  test("new unit and service tests use TestWorld instead of writing PRIVACY_POOLS_HOME directly", () => {
    expect([
      ...collectNonTestWorldHomeWrites(join(CLI_ROOT, "test", "unit")),
      ...collectNonTestWorldHomeWrites(join(CLI_ROOT, "test", "services")),
    ]).toEqual([]);
  });
});
