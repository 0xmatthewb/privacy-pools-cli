import {
  formatCallout,
  formatBox,
  formatKeyValueRows,
  type CalloutKind,
  type KeyValueRow,
} from "./layout.js";

export interface ReviewCallout {
  kind: CalloutKind;
  lines: string | string[];
}

export interface ReviewSection {
  title?: string;
  rows: KeyValueRow[];
  divider?: boolean;
}

export interface ReviewSurfaceData {
  title: string;
  summaryRows?: KeyValueRow[];
  sections?: ReviewSection[];
  primaryCallout?: ReviewCallout | null;
  secondaryCallout?: ReviewCallout | null;
}

function formatEmbeddedReviewCallout(callout: ReviewCallout): string {
  return formatCallout(callout.kind, callout.lines)
    .trim()
    .split("\n")
    .map((line, index) => {
      const stripped = line.replace(/^\s*[│|]\s?/, "");
      return `${index === 0 ? "  " : "    "}${stripped}`;
    })
    .join("\n");
}

export function formatReviewSurface(data: ReviewSurfaceData): string {
  const blocks: string[] = [];

  if (data.summaryRows && data.summaryRows.length > 0) {
    blocks.push(formatKeyValueRows(data.summaryRows).trimEnd());
  }

  for (const section of data.sections ?? []) {
    const lines: string[] = [];
    if (section.title) {
      lines.push(`${section.title}:`);
    }
    lines.push(formatKeyValueRows(section.rows).trimEnd());
    blocks.push(lines.join("\n"));
  }

  if (data.primaryCallout) {
    blocks.push(formatEmbeddedReviewCallout(data.primaryCallout));
  }
  if (data.secondaryCallout) {
    blocks.push(formatEmbeddedReviewCallout(data.secondaryCallout));
  }

  return formatBox(blocks.join("\n"), {
    title: data.title,
    padTop: false,
  });
}

export function formatPromptLine(message: string): string {
  return `\n  ${message}\n`;
}
