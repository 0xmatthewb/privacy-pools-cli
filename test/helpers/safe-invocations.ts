import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "bun:test";
import {
  STATIC_COMMAND_PATHS,
  type StaticCommandPath,
} from "../../src/utils/command-discovery-static.ts";
import { CLI_ROOT } from "./paths.ts";

export type SafeInvocationMode = "json" | "agent";

export interface SafeInvocationRow {
  command: StaticCommandPath;
  argv?: string[];
  modes?: SafeInvocationMode[];
  network?: false;
  mockedNetwork?: true;
  excludedReason?: string;
}

const FIXTURE_PATH = join(CLI_ROOT, "test", "fixtures", "safe-invocations.json");

export function loadSafeInvocationRows(): SafeInvocationRow[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SafeInvocationRow[];
}

export function assertSafeInvocationInventoryCoverage(
  rows: readonly SafeInvocationRow[] = loadSafeInvocationRows(),
): void {
  const commands = rows.map((row) => row.command);
  expect(commands).toEqual([...new Set(commands)]);
  expect(new Set(commands)).toEqual(new Set(STATIC_COMMAND_PATHS));

  for (const row of rows) {
    const safetyDeclarations = [
      row.network === false,
      row.mockedNetwork === true,
      typeof row.excludedReason === "string",
    ].filter(Boolean);
    expect(safetyDeclarations.length).toBe(1);

    if (row.excludedReason) {
      expect(row.argv).toBeUndefined();
      expect(row.modes).toBeUndefined();
      continue;
    }

    expect(Array.isArray(row.argv)).toBe(true);
    expect(row.argv!.length).toBeGreaterThan(0);
    expect(row.modes?.length ?? 0).toBeGreaterThan(0);
  }
}

export function invokableSafeInvocationRows(
  rows: readonly SafeInvocationRow[] = loadSafeInvocationRows(),
): SafeInvocationRow[] {
  return rows.filter((row) => !row.excludedReason);
}

export function argvForMode(
  row: SafeInvocationRow,
  mode: SafeInvocationMode,
): string[] {
  const flag = mode === "agent" ? "--agent" : "--json";
  return [...(row.argv ?? []), flag];
}
