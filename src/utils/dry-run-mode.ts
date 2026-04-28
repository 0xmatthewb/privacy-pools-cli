import { CLIError } from "./errors.js";

export const DRY_RUN_MODES = ["offline", "rpc", "relayer"] as const;
export type DryRunMode = (typeof DRY_RUN_MODES)[number];

export function normalizeDryRunMode(value: unknown): DryRunMode | null {
  if (value === undefined || value === false) {
    return null;
  }
  if (value === true) {
    return "rpc";
  }
  if (typeof value !== "string") {
    return "rpc";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    return "rpc";
  }
  if ((DRY_RUN_MODES as readonly string[]).includes(normalized)) {
    return normalized as DryRunMode;
  }
  throw new CLIError(
    `Unknown dry-run mode: ${value}.`,
    "INPUT",
    "Use --dry-run=offline, --dry-run=rpc, or --dry-run=relayer. Bare --dry-run is equivalent to --dry-run=rpc.",
    "INPUT_INVALID_OPTION",
  );
}
