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
    blocks.push(
      formatCallout(data.primaryCallout.kind, data.primaryCallout.lines).trim(),
    );
  }
  if (data.secondaryCallout) {
    blocks.push(
      formatCallout(data.secondaryCallout.kind, data.secondaryCallout.lines).trim(),
    );
  }

  return formatBox(blocks.join("\n"), {
    title: data.title,
    padTop: false,
  });
}

export function formatPromptLine(message: string): string {
  return `\n  ${message}\n`;
}
