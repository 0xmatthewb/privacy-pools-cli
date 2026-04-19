import { FLOW_PHASE_VALUES } from "../../src/services/workflow.ts";

function findMatch(doc: string, pattern: RegExp): RegExpExecArray {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const match = matcher.exec(doc);
  if (!match || match.index === undefined) {
    throw new Error(`Pattern not found: ${pattern}`);
  }
  return match;
}

function trimBackticks(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("`") && trimmed.endsWith("`")
    ? trimmed.slice(1, -1)
    : trimmed;
}

function normalizeHeader(header: string): string {
  const stripped = trimBackticks(header).replace(/[^A-Za-z0-9]+/g, " ").trim();
  const [first = "", ...rest] = stripped.split(/\s+/);
  return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((part) =>
    `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  ).join("")}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractSection(
  doc: string,
  headerRe: RegExp,
  nextHeaderRe?: RegExp,
): string {
  const match = findMatch(doc, headerRe);
  const lineStart = doc.lastIndexOf("\n", match.index) + 1;
  const lineEnd = doc.indexOf("\n", match.index);
  const start = lineEnd === -1 ? doc.length : lineEnd + 1;
  const headerLine = doc.slice(lineStart, lineEnd === -1 ? doc.length : lineEnd);

  let end = doc.length;
  if (nextHeaderRe) {
    const remainder = doc.slice(start);
    const nextMatch = new RegExp(
      nextHeaderRe.source,
      nextHeaderRe.flags.includes("g") ? nextHeaderRe.flags : `${nextHeaderRe.flags}g`,
    ).exec(remainder);
    if (nextMatch?.index !== undefined) {
      end = start + nextMatch.index;
    }
  } else {
    const headingMatch = headerLine.match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const remainder = doc.slice(start);
      const nextMatch = new RegExp(`^${headingMatch[1]}\\s+`, "m").exec(remainder);
      if (nextMatch?.index !== undefined) {
        end = start + nextMatch.index;
      }
    }
  }

  return doc.slice(start, end).trim();
}

export function parseMarkdownTable(md: string): Record<string, string>[] {
  const lines = md
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));

  if (lines.length < 2) {
    throw new Error("Expected a markdown table.");
  }

  const parseRow = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => trimBackticks(cell.trim()));

  const headers = parseRow(lines[0]).map(normalizeHeader);
  const rows: Record<string, string>[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseRow(line);
    const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    if (isSeparator) continue;

    rows.push(
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
    );
  }

  return rows;
}

export function parseExitCodeLine(line: string): Record<string, number> {
  const matches = Array.from(line.matchAll(/(\d+)\s*\(([^)]+)\)/g));
  if (matches.length === 0) {
    throw new Error(`Expected inline exit-code prose, got: ${line}`);
  }

  return Object.fromEntries(
    matches.map((match) => [match[2].trim().toUpperCase(), Number(match[1])]),
  );
}

export function extractBacktickedIdentifiers(doc: string): string[] {
  const matches = Array.from(doc.matchAll(/`([A-Za-z][A-Za-z0-9_]{2,})`/g)).map(
    (match) => match[1],
  );
  return dedupe(matches);
}

function parseRetryStrategyLine(line: string): string[] {
  const normalized = line.trim().replace(/^(?:\d+\.\s*|[-*]\s*)/, "");
  const colonIndex = normalized.indexOf(":");
  if (colonIndex === -1) return [];

  const prefix = normalized.slice(0, colonIndex).replace(/^For\s+/i, "").trim();
  const backticked = Array.from(prefix.matchAll(/`([A-Z][A-Z0-9_]+)`/g)).map(
    (match) => match[1],
  );
  if (backticked.length > 0) {
    return backticked;
  }

  return prefix
    .split(/\s*(?:\/|,|\bor\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => /^[A-Z][A-Z0-9_]+$/.test(part));
}

export function parseRetryStrategySections(doc: string): {
  retryableCodes: string[];
  nonRetryableCodes: string[];
} {
  const retryableCodes: string[] = [];
  const nonRetryableCodes: string[] = [];
  let activeBucket: string[] | null = null;

  for (const line of doc.split(/\r?\n/)) {
    if (line.includes("When `retryable: true`")) {
      activeBucket = retryableCodes;
      continue;
    }
    if (line.includes("When `retryable: false`")) {
      activeBucket = nonRetryableCodes;
      continue;
    }
    if (!activeBucket) continue;

    activeBucket.push(...parseRetryStrategyLine(line));
  }

  return {
    retryableCodes: dedupe(retryableCodes),
    nonRetryableCodes: dedupe(nonRetryableCodes),
  };
}

export function parseEnumList(doc: string, headerRe: RegExp): string[] {
  const match = findMatch(doc, headerRe);
  const lineEnd = doc.indexOf("\n", match.index);
  const start = lineEnd === -1 ? doc.length : lineEnd + 1;
  const lines = doc.slice(start).split(/\r?\n/);
  const captured: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (captured.length > 0) break;
      continue;
    }

    if (line.startsWith("|") || /^[-*]\s+/.test(line)) {
      captured.push(line);
      continue;
    }

    if (captured.length > 0) {
      break;
    }

    if (/^#{1,6}\s+/.test(line) || /^\*\*.+\*\*$/.test(line)) {
      break;
    }
  }

  if (captured.length === 0) {
    throw new Error(`No enum list found after ${headerRe}.`);
  }

  if (captured[0].startsWith("|")) {
    return dedupe(
      captured
        .slice(2)
        .map((line) => trimBackticks(line.split("|")[1]?.trim() ?? ""))
        .filter(Boolean),
    );
  }

  return dedupe(
    captured
      .map((line) => line.match(/`([^`]+)`/)?.[1] ?? "")
      .filter(Boolean),
  );
}

export function extractPhaseLikeIdentifiers(doc: string): string[] {
  const phasePrefixes = new Set(
    FLOW_PHASE_VALUES.map((phase) => `${phase.split("_")[0]}_`),
  );
  const tokens = Array.from(doc.matchAll(/\b([a-z]+_[a-z0-9_]{2,})\b/g))
    .map((match) => match[1])
    .filter((token) => !token.endsWith("_"))
    .filter((token) => phasePrefixes.has(token.split("_")[0] + "_"));

  return dedupe(tokens);
}
