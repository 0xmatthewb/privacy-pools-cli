import chalk from "chalk";

export type PoolAccountStatus = "spendable" | "spent" | "exited";
export type AspApprovalStatus = "approved" | "pending" | "declined" | "unknown";

export function normalizeAspApprovalStatus(
  rawStatus: string | null | undefined,
): AspApprovalStatus {
  const normalized = rawStatus?.trim().toLowerCase();

  switch (normalized) {
    case "approved":
    case "accepted":
      return "approved";
    case "pending":
      return "pending";
    case "declined":
    case "rejected":
    case "denied":
    case "poi_required":
      return "declined";
    default:
      return "unknown";
  }
}

export function formatAspApprovalStatus(
  rawStatus: string | null | undefined,
  options: { preserveInput?: boolean } = {},
): string {
  const normalized = normalizeAspApprovalStatus(rawStatus);

  if (options.preserveInput && rawStatus && rawStatus.trim().length > 0) {
    const trimmed = rawStatus.trim();
    return trimmed.toLowerCase() === "poi_required" ? "POI Required" : trimmed;
  }

  switch (normalized) {
    case "approved":
      return "Approved";
    case "pending":
      return "Pending";
    case "declined":
      return "Declined";
    default:
      return "Unknown";
  }
}

export function renderAspApprovalStatus(
  rawStatus: string | null | undefined,
  options: { preserveInput?: boolean } = {},
): string {
  const label = formatAspApprovalStatus(rawStatus, options);

  switch (normalizeAspApprovalStatus(rawStatus)) {
    case "approved":
      return chalk.green(label);
    case "pending":
      return chalk.yellow(label);
    case "declined":
      return chalk.red(label);
    default:
      return chalk.dim(label);
  }
}

export function formatPoolAccountStatus(status: PoolAccountStatus): string {
  switch (status) {
    case "spendable":
      return "Spendable";
    case "spent":
      return "Spent";
    case "exited":
      return "Exited";
  }
}

export function renderPoolAccountStatus(status: PoolAccountStatus): string {
  const label = formatPoolAccountStatus(status);

  switch (status) {
    case "spendable":
      return chalk.green(label);
    case "spent":
    case "exited":
      return chalk.dim(label);
  }
}
