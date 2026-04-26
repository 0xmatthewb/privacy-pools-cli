import chalk from "chalk";
import {
  accent,
  accentBold,
  dangerTone,
  muted,
  notice,
  subtle,
  successTone,
} from "../utils/theme.js";
import {
  getOutputWidthClass,
  getTerminalColumns,
  padDisplay,
  supportsUnicodeOutput,
  visibleWidth,
  wrapDisplayText,
} from "../utils/terminal.js";

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

export interface BoxOptions {
  title?: string;
  tone?: SectionTone;
  padTop?: boolean;
}

function sectionHeadingColor(tone: SectionTone): (value: string) => string {
  return tone === "muted" ? subtle : accentBold;
}

function sectionDivider(): string {
  const fill = supportsUnicodeOutput() ? "─" : "-";
  return subtle(fill.repeat(getTerminalColumns()));
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
      return muted(value);
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
    lines.push(sectionDivider());
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
      return `  ${muted(`${row.label}:`.padEnd(width))} ${applyValueTone(row.value, valueTone)}`;
    })
    .join("\n")}\n`;
}

export function formatStackedKeyValueRows(rows: KeyValueRow[]): string {
  if (rows.length === 0) return "";

  return `${rows
    .map((row) => {
      const valueTone = row.valueTone ?? "default";
      return `  ${muted(row.label)}\n    ${applyValueTone(row.value, valueTone)}`;
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
      return dangerTone("Danger");
    case "privacy":
      return notice("Privacy note");
    case "recovery":
      return accent("Recovery");
    case "read-only":
      return accent("Read-only note");
  }
}

function calloutTone(kind: CalloutKind): (value: string) => string {
  switch (kind) {
    case "success":
      return successTone;
    case "warning":
    case "privacy":
      return notice;
    case "danger":
      return dangerTone;
    case "recovery":
    case "read-only":
      return accent;
  }
}

export function formatCallout(
  kind: CalloutKind,
  lines: string | string[],
): string {
  const content = Array.isArray(lines) ? lines : [lines];
  if (content.length === 0) return "";
  const gutter = calloutTone(kind)(supportsUnicodeOutput() ? "│" : "|");
  const wrapWidth = Math.max(24, getTerminalColumns() - 6);
  const label = chalk.bold(`${resolveCalloutHeading(kind)}:`);
  const rendered = [
    `${gutter} ${label}`,
    ...content.flatMap((line) =>
      wrapDisplayText(line, wrapWidth).map((wrapped) => `${gutter} ${wrapped}`),
    ),
  ];

  return `\n  ${rendered.join("\n  ")}\n`;
}

export function formatBox(
  content: string | string[],
  options: BoxOptions = {},
): string {
  const rawLines = (Array.isArray(content) ? content : content.split("\n"))
    .flatMap((line) => line.split("\n"))
    .map((line) => line.replace(/\s+$/g, ""));
  const lines = rawLines.length > 0 ? rawLines : [""];
  const maxWidth = Math.max(30, getTerminalColumns() - 4);
  const title = options.title?.trim();
  const wrappedLines = lines.flatMap((line) =>
    line.length === 0 ? [""] : wrapDisplayText(line, maxWidth),
  );
  const contentWidth = Math.min(
    maxWidth,
    Math.max(
      title ? visibleWidth(title) + 4 : 0,
      ...wrappedLines.map((line) => visibleWidth(line)),
      24,
    ),
  );
  const useUnicode = supportsUnicodeOutput();
  const topLeft = useUnicode ? "╭" : "+";
  const topRight = useUnicode ? "╮" : "+";
  const bottomLeft = useUnicode ? "╰" : "+";
  const bottomRight = useUnicode ? "╯" : "+";
  const horizontal = useUnicode ? "─" : "-";
  const vertical = useUnicode ? "│" : "|";
  const titleText = title
    ? sectionHeadingColor(options.tone ?? "accent")(title)
    : null;

  let topBorder = subtle(`${topLeft}${horizontal.repeat(contentWidth + 2)}${topRight}`);
  if (titleText) {
    const plainTitle = visibleWidth(title ?? "");
    const remaining = Math.max(0, contentWidth - plainTitle - 2);
    topBorder =
      subtle(`${topLeft}${horizontal.repeat(2)} `) +
      `${titleText} ` +
      subtle(`${horizontal.repeat(Math.max(0, remaining))}${topRight}`);
  }

  const body = wrappedLines.map(
    (line) => `${subtle(vertical)} ${padDisplay(line, contentWidth)} ${subtle(vertical)}`,
  );
  const bottomBorder = subtle(`${bottomLeft}${horizontal.repeat(contentWidth + 2)}${bottomRight}`);
  const linesOut = [topBorder, ...body, bottomBorder];

  return `${options.padTop === false ? "" : "\n"}${linesOut.join("\n")}\n`;
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

export { getOutputWidthClass };
