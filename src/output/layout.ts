import chalk from "chalk";
import {
  accent,
  accentBold,
  dangerTone,
  notice,
  successTone,
} from "../utils/theme.js";

const SECTION_DIVIDER = chalk.dim("─".repeat(18));

export type SectionTone = "accent" | "muted";
export type CalloutKind =
  | "success"
  | "warning"
  | "danger"
  | "privacy"
  | "recovery"
  | "read-only";

export interface SectionHeadingOptions {
  divider?: boolean;
  padTop?: boolean;
  tone?: SectionTone;
}

export interface KeyValueRow {
  label: string;
  value: string;
  valueTone?: "default" | "accent" | "success" | "warning" | "danger" | "muted";
}

export interface SectionListOptions {
  divider?: boolean;
  padTop?: boolean;
}

function sectionHeadingColor(tone: SectionTone): (value: string) => string {
  return tone === "muted" ? chalk.dim : accentBold;
}

function applyValueTone(
  value: string,
  tone: NonNullable<KeyValueRow["valueTone"]>,
): string {
  switch (tone) {
    case "accent":
      return accent(value);
    case "success":
      return successTone(value);
    case "warning":
      return notice(value);
    case "danger":
      return dangerTone(value);
    case "muted":
      return chalk.dim(value);
    default:
      return value;
  }
}

export function formatSectionHeading(
  title: string,
  options: SectionHeadingOptions = {},
): string {
  const tone = options.tone ?? "accent";
  const lines: string[] = [];
  const needsTopPadding = options.padTop ?? true;

  if (needsTopPadding) {
    lines.push("");
  }
  if (options.divider) {
    lines.push(SECTION_DIVIDER);
  }

  lines.push(sectionHeadingColor(tone)(`${title}:`));
  return `${lines.join("\n")}\n`;
}

export function formatKeyValueRows(rows: KeyValueRow[]): string {
  if (rows.length === 0) return "";

  const width = rows.reduce(
    (max, row) => Math.max(max, row.label.length + 1),
    0,
  );

  return `${rows
    .map((row) => {
      const valueTone = row.valueTone ?? "default";
      return `  ${chalk.dim(`${row.label}:`.padEnd(width))} ${applyValueTone(row.value, valueTone)}`;
    })
    .join("\n")}\n`;
}

function resolveCalloutHeading(kind: CalloutKind): string {
  switch (kind) {
    case "success":
      return successTone("Success");
    case "warning":
      return notice("Warning");
    case "danger":
      return dangerTone("Attention");
    case "privacy":
      return notice("Privacy");
    case "recovery":
      return accent("Recovery");
    case "read-only":
      return accent("Read-only");
  }
}

export function formatCallout(
  kind: CalloutKind,
  lines: string | string[],
): string {
  const content = Array.isArray(lines) ? lines : [lines];
  if (content.length === 0) return "";

  return `\n${chalk.bold(`${resolveCalloutHeading(kind)}:`)}\n${content
    .map((line) => `  ${line}`)
    .join("\n")}\n`;
}

export function formatSectionList(
  title: string,
  items: string[],
  options: SectionListOptions = {},
): string {
  if (items.length === 0) return "";

  return `${formatSectionHeading(title, {
    divider: options.divider ?? true,
    padTop: options.padTop,
  })}${items.map((item) => `  ${item}\n`).join("")}`;
}
