import chalk from "chalk";
import { dangerTone, notice, successTone } from "./theme.js";

export type PoolAccountStatus =
  | "approved"
  | "pending"
  | "poa_required"
  | "declined"
  | "unknown"
  | "spent"
  | "exited";
export type AspApprovalStatus =
  | "approved"
  | "pending"
  | "poa_required"
  | "declined"
  | "unknown";

interface StatusObjectLike {
  decisionStatus?: unknown;
  reviewStatus?: unknown;
  status?: unknown;
}

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
    case "poa_required":
    case "poi_required":
      return "poa_required";
    case "declined":
    case "rejected":
    case "denied":
      return "declined";
    default:
      return "unknown";
  }
}

export function extractPublicEventReviewStatus(rawStatus: unknown): string | null {
  if (typeof rawStatus === "string") {
    return rawStatus;
  }

  if (typeof rawStatus !== "object" || rawStatus === null) {
    return null;
  }

  const candidate = rawStatus as StatusObjectLike;
  const resolved =
    typeof candidate.decisionStatus === "string"
      ? candidate.decisionStatus
      : typeof candidate.reviewStatus === "string"
        ? candidate.reviewStatus
        : typeof candidate.status === "string"
          ? candidate.status
          : null;

  return resolved && resolved.trim().length > 0 ? resolved : null;
}

export function normalizePublicEventReviewStatus(
  type: string | null | undefined,
  rawStatus: unknown,
): AspApprovalStatus {
  const normalizedType = type?.trim().toLowerCase();
  if (
    normalizedType === "withdrawal" ||
    normalizedType === "migration" ||
    normalizedType === "ragequit" ||
    normalizedType === "exit"
  ) {
    return "approved";
  }

  const extractedStatus = extractPublicEventReviewStatus(rawStatus);
  const normalizedStatus = normalizeAspApprovalStatus(extractedStatus);
  if (normalizedStatus !== "unknown") {
    return normalizedStatus;
  }

  return extractedStatus && extractedStatus.trim().length > 0 ? "unknown" : "pending";
}

export function formatAspApprovalStatus(
  rawStatus: string | null | undefined,
  options: { preserveInput?: boolean } = {},
): string {
  const normalized = normalizeAspApprovalStatus(rawStatus);

  if (options.preserveInput && rawStatus && rawStatus.trim().length > 0) {
    const trimmed = rawStatus.trim();
    if (normalized !== "unknown") {
      switch (normalized) {
        case "approved":
          return "Approved";
        case "pending":
          return "Pending";
        case "poa_required":
          return "POA Needed";
        case "declined":
          return "Declined";
      }
    }
    return trimmed;
  }

  switch (normalized) {
    case "approved":
      return "Approved";
    case "pending":
      return "Pending";
    case "poa_required":
      return "POA Needed";
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
      return successTone(label);
    case "pending":
      return notice(label);
    case "poa_required":
      return dangerTone(label);
    case "declined":
      return dangerTone(label);
    default:
      return chalk.dim(label);
  }
}

export function isActivePoolAccountStatus(status: PoolAccountStatus): boolean {
  return status !== "spent" && status !== "exited";
}

export function formatPoolAccountStatus(status: PoolAccountStatus): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending":
      return "Pending";
    case "poa_required":
      return "POA Needed";
    case "declined":
      return "Declined";
    case "unknown":
      return "Unknown";
    case "spent":
      return "Spent";
    case "exited":
      return "Exited";
  }
}

export function renderPoolAccountStatus(status: PoolAccountStatus): string {
  const label = formatPoolAccountStatus(status);

  switch (status) {
    case "approved":
      return successTone(label);
    case "pending":
      return notice(label);
    case "poa_required":
      return dangerTone(label);
    case "declined":
      return dangerTone(label);
    case "unknown":
      return chalk.dim(label);
    case "spent":
    case "exited":
      return chalk.dim(label);
  }
}
