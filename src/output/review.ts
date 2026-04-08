import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
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
  let output = formatSectionHeading(data.title, {
    divider: true,
    padTop: false,
  });

  if (data.summaryRows && data.summaryRows.length > 0) {
    output += formatKeyValueRows(data.summaryRows);
  }

  for (const section of data.sections ?? []) {
    if (section.title) {
      output += formatSectionHeading(section.title, {
        divider: section.divider ?? true,
        padTop: false,
      });
    }
    output += formatKeyValueRows(section.rows);
  }

  if (data.primaryCallout) {
    output += formatCallout(data.primaryCallout.kind, data.primaryCallout.lines);
  }
  if (data.secondaryCallout) {
    output += formatCallout(data.secondaryCallout.kind, data.secondaryCallout.lines);
  }

  return output;
}

export function formatPromptLine(message: string): string {
  return `\n  ${message}\n`;
}
