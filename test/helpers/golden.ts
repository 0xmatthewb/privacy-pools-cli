import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "bun:test";
import { CLI_ROOT } from "./paths.ts";

type GoldenFormat = "text" | "json";

const GOLDEN_ROOT = join(CLI_ROOT, "test", "golden");
const UPDATE_GOLDEN = process.env.UPDATE_GOLDEN === "1";
const ANSI_PATTERN = /\x1B\[[0-9;]*m/g;
const DOTENV_TIP_PATTERN = /^\[dotenv@[^\]]+\] injecting env .*$/gm;
const NO_COLOR_WARNING_PATTERN =
  /\(node:\d+\) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set\.\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n?/g;
const HASH_PATTERN = /0x[a-fA-F0-9]{64}\b/g;
const ADDR_PATTERN = /0x[a-fA-F0-9]{40}\b/g;
const TS_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
const BLOCK_LABEL_PATTERN = /\b(Block(?: number)?\s*:\s*)\d+\b/g;

const BLOCK_KEYS = new Set([
  "blockNumber",
  "depositBlockNumber",
  "ragequitBlockNumber",
  "rpcBlockNumber",
  "withdrawBlockNumber",
]);

const WEI_KEYS = new Set([
  "acceptedDepositsValue",
  "amount",
  "committedValue",
  "depositAmount",
  "estimatedCommittedValue",
  "feeAmount",
  "minimumDeposit",
  "minWithdrawAmount",
  "netAmount",
  "pendingDepositsValue",
  "remainingBalance",
  "requiredNativeFunding",
  "requiredTokenFunding",
  "totalDepositsValue",
  "totalInPoolValue",
  "totalWithdrawalsValue",
  "value",
  "vettingFee",
]);

interface NormalizedGolden {
  text: string;
  applied: string[];
}

function finalizeGoldenText(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function withNormalized(
  value: string,
  pattern: RegExp,
  replacement: string,
  token: string,
  applied: Set<string>,
): string {
  let matched = false;
  const replaced = value.replace(pattern, (...args) => {
    matched = true;
    const groups = args.at(-1);
    if (groups && typeof groups === "object" && "prefix" in groups) {
      return `${(groups as { prefix: string }).prefix}${replacement}`;
    }
    return replacement;
  });
  if (matched) {
    applied.add(token);
  }
  return replaced;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
  );
}

function normalizeJsonValue(
  value: unknown,
  applied: Set<string>,
  key?: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry, applied));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((childKey) => [
          childKey,
          normalizeJsonValue(
            (value as Record<string, unknown>)[childKey],
            applied,
            childKey,
          ),
        ]),
    );
  }

  if (typeof value === "number" && Number.isFinite(value) && key && BLOCK_KEYS.has(key)) {
    applied.add("BLOCK");
    return "<BLOCK>";
  }

  if (typeof value === "string") {
    if (key === "runtime" && (value === "js" || value === "native")) {
      applied.add("RUNTIME");
      return "<RUNTIME>";
    }

    if (key && BLOCK_KEYS.has(key) && /^\d+$/.test(value)) {
      applied.add("BLOCK");
      return "<BLOCK>";
    }

    if (key && WEI_KEYS.has(key) && /^\d+$/.test(value)) {
      applied.add("WEI");
      return "<WEI>";
    }

    let normalized = value;
    normalized = withNormalized(normalized, TS_PATTERN, "<TS>", "TS", applied);
    normalized = withNormalized(normalized, HASH_PATTERN, "<HASH>", "HASH", applied);
    normalized = withNormalized(normalized, ADDR_PATTERN, "<ADDR>", "ADDR", applied);
    return normalized;
  }

  return value;
}

function normalizeText(value: string): NormalizedGolden {
  const applied = new Set<string>();
  let normalized = value
    .replace(ANSI_PATTERN, "")
    .replace(NO_COLOR_WARNING_PATTERN, "")
    .replace(DOTENV_TIP_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  normalized = withNormalized(normalized, TS_PATTERN, "<TS>", "TS", applied);
  normalized = withNormalized(normalized, HASH_PATTERN, "<HASH>", "HASH", applied);
  normalized = withNormalized(normalized, ADDR_PATTERN, "<ADDR>", "ADDR", applied);
  normalized = normalized.replace(BLOCK_LABEL_PATTERN, "$1<BLOCK>");
  if (BLOCK_LABEL_PATTERN.test(value)) {
    applied.add("BLOCK");
  }

  return {
    text: finalizeGoldenText(normalized),
    applied: [...applied].sort(),
  };
}

function normalizeJson(actual: unknown): NormalizedGolden {
  const applied = new Set<string>();
  const normalizedObject = normalizeJsonValue(sortKeysDeep(actual), applied);
  return {
    text: finalizeGoldenText(
      JSON.stringify(normalizedObject, null, 2),
    ),
    applied: [...applied].sort(),
  };
}

function renderGoldenFile(normalized: NormalizedGolden): string {
  const header = `// normalized: ${normalized.applied.join(", ") || "NONE"}`;
  return `${header}\n${normalized.text}`;
}

function resolveGoldenPath(name: string, format: GoldenFormat): string {
  return join(
    GOLDEN_ROOT,
    `${name}.golden.${format === "json" ? "json" : "txt"}`,
  );
}

function buildUnifiedDiff(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const maxLines = Math.max(expectedLines.length, actualLines.length);
  let firstDiff = 0;

  while (
    firstDiff < maxLines &&
    expectedLines[firstDiff] === actualLines[firstDiff]
  ) {
    firstDiff += 1;
  }

  const start = Math.max(0, firstDiff - 2);
  const end = Math.min(maxLines, firstDiff + 6);
  const lines = ["--- expected", "+++ actual", `@@ line ${firstDiff + 1} @@`];

  for (let index = start; index < end; index += 1) {
    const expectedLine = expectedLines[index];
    const actualLine = actualLines[index];
    if (expectedLine === actualLine) {
      lines.push(` ${expectedLine ?? ""}`);
      continue;
    }
    if (expectedLine !== undefined) {
      lines.push(`-${expectedLine}`);
    }
    if (actualLine !== undefined) {
      lines.push(`+${actualLine}`);
    }
  }

  return lines.join("\n");
}

function assertGolden(
  name: string,
  rendered: string,
  format: GoldenFormat,
): void {
  const goldenPath = resolveGoldenPath(name, format);
  mkdirSync(dirname(goldenPath), { recursive: true });

  if (UPDATE_GOLDEN) {
    writeFileSync(goldenPath, rendered, "utf8");
    return;
  }

  if (!existsSync(goldenPath)) {
    throw new Error(
      `Missing golden file ${goldenPath}. Re-run with UPDATE_GOLDEN=1 to create it.`,
    );
  }

  const expected = readFileSync(goldenPath, "utf8");
  if (expected === rendered) {
    expect(rendered).toBe(expected);
    return;
  }

  throw new Error(
    `Golden mismatch for ${name}.\n${buildUnifiedDiff(expected, rendered)}\n` +
      "Re-run with UPDATE_GOLDEN=1 to accept the new normalized output.",
  );
}

export function expectGolden(
  name: string,
  actual: string,
  opts: { format?: GoldenFormat } = {},
): void {
  const format = opts.format ?? "text";
  const normalized =
    format === "json" ? normalizeJson(JSON.parse(actual)) : normalizeText(actual);
  assertGolden(name, renderGoldenFile(normalized), format);
}

export function expectJsonGolden(name: string, actual: unknown): void {
  const normalized = normalizeJson(actual);
  assertGolden(name, renderGoldenFile(normalized), "json");
}
