export type OutputWidthClass = "wide" | "compact" | "narrow";

export function supportsUnicodeOutput(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const term = env.TERM?.trim().toLowerCase();
  if (term === "dumb") {
    return false;
  }

  const locale = (env.LC_ALL ?? env.LANG ?? "").toUpperCase();
  if (locale.includes("UTF-8") || locale.includes("UTF8")) {
    return true;
  }

  return process.platform !== "win32";
}

function parseTerminalColumns(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export function getTerminalColumns(columns?: number | null): number {
  const resolved =
    parseTerminalColumns(columns) ??
    parseTerminalColumns(process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS) ??
    parseTerminalColumns(process.env.COLUMNS) ??
    parseTerminalColumns(process.stderr.columns) ??
    parseTerminalColumns(process.stdout.columns) ??
    120;

  return Math.max(40, Math.min(resolved, 120));
}

export function getOutputWidthClass(
  columns = getTerminalColumns(),
): OutputWidthClass {
  if (columns <= 72) {
    return "narrow";
  }
  if (columns <= 90) {
    return "compact";
  }
  return "wide";
}

export function inlineSeparator(): string {
  return supportsUnicodeOutput() ? " · " : " - ";
}

export function stripAnsiCodes(value: string): string {
  return value.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

export function visibleWidth(value: string): number {
  return stripAnsiCodes(value).length;
}

export function padDisplay(value: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(value));
  return `${value}${" ".repeat(padding)}`;
}

export function wrapDisplayText(
  value: string,
  maxWidth: number,
): string[] {
  if (maxWidth <= 0 || visibleWidth(value) <= maxWidth) {
    return [value];
  }

  const words = value.split(/(\s+)/).filter((part) => part.length > 0);
  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.length > 0) {
      lines.push(current.trimEnd());
      current = "";
    }
  };

  for (const word of words) {
    if (/^\s+$/.test(word)) {
      if (current.length > 0) {
        current += word;
      }
      continue;
    }

    const next = current.length > 0 ? `${current}${word}` : word;
    if (visibleWidth(next) <= maxWidth) {
      current = next;
      continue;
    }

    pushCurrent();

    if (visibleWidth(word) <= maxWidth) {
      current = word;
      continue;
    }

    let remainder = word;
    while (visibleWidth(remainder) > maxWidth) {
      lines.push(remainder.slice(0, maxWidth));
      remainder = remainder.slice(maxWidth);
    }
    current = remainder;
  }

  pushCurrent();
  return lines.length > 0 ? lines : [value];
}
