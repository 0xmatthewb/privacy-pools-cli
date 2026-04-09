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
  let output = "";

  if (data.summaryRows && data.summaryRows.length > 0) {
    output += formatKeyValueRows(data.summaryRows);
  }

  for (const section of data.sections ?? []) {
    if (output.length > 0) {
      output += "\n";
    }
    if (section.title) {
      output += `${section.title}:\n`;
    }
    output += formatKeyValueRows(section.rows);
  }

  if (data.primaryCallout) {
    if (output.length > 0) {
      output += "\n";
    }
    output += formatCallout(data.primaryCallout.kind, data.primaryCallout.lines);
  }
  if (data.secondaryCallout) {
    if (output.length > 0) {
      output += "\n";
    }
    output += formatCallout(data.secondaryCallout.kind, data.secondaryCallout.lines);
  }

  return formatBox(output.trimEnd(), {
    title: data.title,
    padTop: false,
  });
}

export function formatPromptLine(message: string): string {
  return `\n  ${message}\n`;
}
