import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { nextActionSchema } from "../../src/types/envelopes/common.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  argvForMode,
  assertSafeInvocationInventoryCoverage,
  invokableSafeInvocationRows,
  loadSafeInvocationRows,
} from "../helpers/safe-invocations.ts";
import { parseJsonOutput, runBuiltCli } from "../helpers/cli.ts";

const SAFE_FUZZ_COMMANDS = new Set([
  "init",
  "config list",
  "config path",
  "status",
  "capabilities",
  "describe",
  "guide",
  "flow status",
  "flow step",
  "simulate deposit",
  "simulate withdraw",
  "accounts",
  "history",
]);

function collectJsonFiles(root: string): string[] {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const entry of readdirSync(current)) {
      const entryPath = join(current, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        queue.push(entryPath);
      } else if (entryPath.endsWith(".json")) {
        files.push(entryPath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function collectNextActions(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNextActions(entry));
  }

  const record = value as Record<string, unknown>;
  const nested = Object.values(record).flatMap((entry) => collectNextActions(entry));
  return Array.isArray(record.nextActions)
    ? [...record.nextActions, ...nested]
    : nested;
}

function expectValidNextActions(value: unknown, label: string): number {
  const actions = collectNextActions(value);
  for (const action of actions) {
    const result = nextActionSchema.safeParse(action);
    expect(result.success, `${label}: ${JSON.stringify(action)}`).toBe(true);
  }
  return actions.length;
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const rng = createSeededRng(seed);
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex]!, copy[index]!];
  }
  return copy;
}

function parseGoldenJson(text: string): unknown {
  return JSON.parse(text.replace(/^(?:\/\/.*\r?\n)+/, ""));
}

describe("nextActions schema fuzz conformance", () => {
  test("checked-in golden JSON envelopes keep valid nextActions", () => {
    let count = 0;
    for (const filePath of collectJsonFiles(join(CLI_ROOT, "test", "golden"))) {
      const parsed = parseGoldenJson(readFileSync(filePath, "utf8"));
      count += expectValidNextActions(parsed, filePath.replace(`${CLI_ROOT}/`, ""));
    }
    expect(count).toBeGreaterThan(0);
  });

  test("fixture-generated safe envelopes keep valid nextActions", () => {
    const rows = loadSafeInvocationRows();
    assertSafeInvocationInventoryCoverage(rows);

    let count = 0;
    const seed = getFuzzSeed("PP_NEXT_ACTIONS_FUZZ_SEED", 20260428);
    const limit = Number.parseInt(process.env.PP_NEXT_ACTIONS_FUZZ_LIMIT ?? "12", 10);
    const invocations = shuffle(
      invokableSafeInvocationRows(rows)
        .filter((row) => SAFE_FUZZ_COMMANDS.has(row.command))
        .flatMap((row) => (row.modes ?? []).map((mode) => ({ row, mode }))),
      seed,
    ).slice(0, Number.isFinite(limit) && limit > 0 ? limit : 12);

    for (const { row, mode } of invocations) {
      const args = argvForMode(row, mode);
      const result = runBuiltCli(args, { timeoutMs: 10_000 });
      expect(result.timedOut, `${row.command} ${mode}`).toBe(false);
      expect(result.stderr, `${row.command} ${mode}`).toBe("");
      expect(result.stdout.trim(), `${row.command} ${mode}`).not.toBe("");
      count += expectValidNextActions(
        parseJsonOutput(result.stdout),
        `${row.command} ${mode}`,
      );
    }

    expect(count).toBeGreaterThan(0);
  });
});
