import { expect } from "bun:test";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

export interface JsonEnvelopeLike {
  schemaVersion?: string;
  success: boolean;
  errorCode?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    hint?: string;
  };
  nextActions?: Array<{
    command: string;
    runnable?: boolean;
    options?: Record<string, unknown>;
  }>;
}

export function expectJsonEnvelope(
  json: JsonEnvelopeLike,
  options: {
    success: boolean;
    errorCode?: string;
    retryable?: boolean;
    hintIncludes?: string;
    schemaVersion?: string;
  },
): void {
  expect(json.schemaVersion).toBe(
    options.schemaVersion ?? JSON_SCHEMA_VERSION,
  );
  expect(json.success).toBe(options.success);

  if (options.errorCode !== undefined) {
    expect(json.errorCode ?? json.error?.code).toBe(options.errorCode);
  }
  if (options.retryable !== undefined) {
    expect(json.error?.retryable).toBe(options.retryable);
  }
  if (options.hintIncludes !== undefined) {
    expect(json.error?.hint ?? "").toContain(options.hintIncludes);
  }
}

export function expectNextActions(
  nextActions: JsonEnvelopeLike["nextActions"],
  expectedCommands: readonly string[],
): void {
  expect((nextActions ?? []).map((action) => action.command)).toEqual([
    ...expectedCommands,
  ]);
}

export function expectStdoutOnly(
  output: { stdout: string; stderr: string },
  matcher?: string | RegExp,
): void {
  expect(output.stderr).toBe("");
  if (matcher === undefined) {
    expect(output.stdout.trim().length).toBeGreaterThan(0);
    return;
  }
  if (typeof matcher === "string") {
    expect(output.stdout).toContain(matcher);
    return;
  }
  expect(output.stdout).toMatch(matcher);
}

export function expectStderrOnly(
  output: { stdout: string; stderr: string },
  matcher?: string | RegExp,
): void {
  expect(output.stdout).toBe("");
  if (matcher === undefined) {
    expect(output.stderr.trim().length).toBeGreaterThan(0);
    return;
  }
  if (typeof matcher === "string") {
    expect(output.stderr).toContain(matcher);
    return;
  }
  expect(output.stderr).toMatch(matcher);
}

export function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

export function normalizeSemanticText(value: string): string {
  return stripAnsi(value)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

export function expectSemanticText(
  value: string,
  options: {
    includes?: readonly string[];
    excludes?: readonly string[];
    patterns?: readonly RegExp[];
  },
): void {
  const normalized = normalizeSemanticText(value);

  for (const fragment of options.includes ?? []) {
    expect(normalized).toContain(fragment);
  }

  for (const fragment of options.excludes ?? []) {
    expect(normalized).not.toContain(fragment);
  }

  for (const pattern of options.patterns ?? []) {
    expect(normalized).toMatch(pattern);
  }
}

export function expectOrderedSemanticFragments(
  value: string,
  fragments: readonly string[],
): void {
  const normalized = normalizeSemanticText(value);
  let cursor = 0;

  for (const fragment of fragments) {
    const index = normalized.indexOf(fragment, cursor);
    expect(index).toBeGreaterThanOrEqual(0);
    cursor = index + fragment.length;
  }
}
