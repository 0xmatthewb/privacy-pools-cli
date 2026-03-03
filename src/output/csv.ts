/**
 * RFC 4180–compliant CSV output utility.
 *
 * Writes CSV to stdout (same stream as JSON output) so piping and
 * redirection work the same way: `privacy-pools pools --format csv > pools.csv`
 */

/**
 * Escape a single CSV field per RFC 4180.
 * Fields containing commas, double-quotes, or newlines are double-quoted
 * with internal quotes escaped by doubling.
 */
function escapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Strip ANSI escape sequences so CSV cells contain plain text.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

/**
 * Print a table as RFC 4180 CSV to stdout.
 *
 * @param headers - Column header names
 * @param rows    - Array of row arrays (same length as headers)
 */
export function printCsv(headers: string[], rows: string[][]): void {
  const lines: string[] = [];
  lines.push(headers.map((h) => escapeField(stripAnsi(h))).join(","));
  for (const row of rows) {
    lines.push(row.map((cell) => escapeField(stripAnsi(cell))).join(","));
  }
  process.stdout.write(lines.join("\n") + "\n");
}
