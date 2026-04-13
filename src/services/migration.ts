import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { CHAINS, resolveChainOverrides } from "../config/chains.js";
import { normalizeAspApprovalStatus } from "../utils/statuses.js";
import { fetchDepositReviewStatuses } from "./asp.js";

interface LegacyAccountSource {
  account?: { poolAccounts?: ReadonlyMap<unknown, readonly unknown[]> };
}

interface LegacyCommitmentLike {
  label?: bigint | null;
  value?: bigint | null;
}

interface LegacyPoolAccountLike {
  label?: bigint | null;
  ragequit?: unknown;
  isMigrated?: boolean;
  deposit?: LegacyCommitmentLike | null;
  children?: LegacyCommitmentLike[] | null;
}

export interface LegacyMigrationCandidate {
  scope: bigint;
  label: string;
  isMigrated: boolean;
  remainingValue: bigint;
}

export type MigrationChainStatus =
  | "no_legacy"
  | "migration_required"
  | "partially_migrated"
  | "fully_migrated"
  | "website_recovery_required"
  | "review_incomplete";

export interface MigrationChainReadiness {
  candidateLegacyCommitments: number;
  expectedLegacyCommitments: number;
  migratedCommitments: number;
  legacyMasterSeedNullifiedCount: number;
  hasPostMigrationCommitments: boolean;
  isMigrated: boolean;
  legacySpendableCommitments: number;
  upgradedSpendableCommitments: number;
  declinedLegacyCommitments: number;
  reviewStatusComplete: boolean;
  requiresMigration: boolean;
  requiresWebsiteRecovery: boolean;
  scopes: string[];
  status: MigrationChainStatus;
}

function latestLegacyCommitment(
  account: LegacyPoolAccountLike,
): LegacyCommitmentLike | null {
  const children = Array.isArray(account.children) ? account.children : [];
  return children.length > 0
    ? children[children.length - 1] ?? null
    : account.deposit ?? null;
}

function resolveLegacyDepositLabel(account: LegacyPoolAccountLike): string | null {
  const label =
    typeof account.deposit?.label === "bigint"
      ? account.deposit.label
      : typeof account.label === "bigint"
        ? account.label
        : null;

  return label === null ? null : label.toString();
}

export function collectLegacyMigrationCandidates(
  legacyAccount: AccountService | LegacyAccountSource | undefined,
): LegacyMigrationCandidate[] {
  const poolAccounts = (
    legacyAccount as unknown as {
      account?: { poolAccounts?: ReadonlyMap<unknown, readonly unknown[]> };
    }
  )?.account?.poolAccounts;

  if (!(poolAccounts instanceof Map)) return [];

  const candidates: LegacyMigrationCandidate[] = [];

  for (const [rawScope, rawAccounts] of poolAccounts.entries()) {
    if (typeof rawScope !== "bigint" || !Array.isArray(rawAccounts)) continue;

    for (const rawAccount of rawAccounts) {
      const account = rawAccount as LegacyPoolAccountLike;
      if (account.ragequit) continue;

      const latestCommitment = latestLegacyCommitment(account);
      const remainingValue =
        typeof latestCommitment?.value === "bigint"
          ? latestCommitment.value
          : null;
      if (remainingValue === null || remainingValue <= 0n) continue;

      const label = resolveLegacyDepositLabel(account);
      if (!label) continue;

      candidates.push({
        scope: rawScope,
        label,
        isMigrated: account.isMigrated === true,
        remainingValue,
      });
    }
  }

  return candidates;
}

function resolveChainConfigById(chainId: number) {
  const baseConfig = Object.values(CHAINS).find((chain) => chain.id === chainId);
  return baseConfig ? resolveChainOverrides(baseConfig) : null;
}

export async function loadDeclinedLegacyLabels(
  chainId: number,
  candidates: readonly LegacyMigrationCandidate[],
): Promise<Set<string> | null> {
  if (candidates.length === 0) return new Set<string>();

  const chainConfig = resolveChainConfigById(chainId);
  if (!chainConfig) return null;

  const labelsByScope = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const scopeKey = candidate.scope.toString();
    const labels = labelsByScope.get(scopeKey) ?? new Set<string>();
    labels.add(candidate.label);
    labelsByScope.set(scopeKey, labels);
  }

  let unavailable = false;
  const declinedLabels = new Set<string>();

  await Promise.all(
    [...labelsByScope.entries()].map(async ([scopeKey, labels]) => {
      const statuses = await fetchDepositReviewStatuses(
        chainConfig,
        BigInt(scopeKey),
        [...labels],
      );
      if (statuses === null) {
        unavailable = true;
        return;
      }

      for (const [label, status] of statuses.entries()) {
        if (normalizeAspApprovalStatus(status) === "declined") {
          declinedLabels.add(label);
        }
      }
    }),
  );

  return unavailable ? null : declinedLabels;
}

export function hasUnmigratedLegacyCommitments(
  candidates: readonly LegacyMigrationCandidate[],
  declinedLabels: ReadonlySet<string> | null,
): boolean {
  for (const candidate of candidates) {
    if (candidate.isMigrated) continue;
    if (declinedLabels?.has(candidate.label)) continue;
    return true;
  }

  return false;
}

export function buildMigrationChainReadiness(
  candidates: readonly LegacyMigrationCandidate[],
  declinedLabels: ReadonlySet<string>,
): MigrationChainReadiness {
  const candidateLegacyCommitments = candidates.length;
  const eligibleCandidates = candidates.filter(
    (candidate) => !declinedLabels.has(candidate.label),
  );
  const migratedCommitments = eligibleCandidates.filter(
    (candidate) => candidate.isMigrated,
  ).length;
  const expectedLegacyCommitments = eligibleCandidates.length;
  const declinedLegacyCommitments = candidates.length - expectedLegacyCommitments;
  const isMigrated =
    expectedLegacyCommitments > 0 &&
    migratedCommitments >= expectedLegacyCommitments;
  const requiresMigration =
    expectedLegacyCommitments > 0 && !isMigrated;
  const requiresWebsiteRecovery = declinedLegacyCommitments > 0;
  const scopes = [...new Set(
    candidates.map((candidate) => candidate.scope.toString()),
  )];

  let status: MigrationChainStatus = "no_legacy";
  if (expectedLegacyCommitments === 0 && requiresWebsiteRecovery) {
    status = "website_recovery_required";
  } else if (expectedLegacyCommitments > 0 && migratedCommitments === 0) {
    status = "migration_required";
  } else if (expectedLegacyCommitments > 0 && isMigrated) {
    status = "fully_migrated";
  } else if (expectedLegacyCommitments > 0) {
    status = "partially_migrated";
  }

  return {
    candidateLegacyCommitments,
    expectedLegacyCommitments,
    migratedCommitments,
    legacyMasterSeedNullifiedCount: migratedCommitments,
    hasPostMigrationCommitments: migratedCommitments > 0,
    isMigrated,
    legacySpendableCommitments:
      expectedLegacyCommitments - migratedCommitments,
    upgradedSpendableCommitments: migratedCommitments,
    declinedLegacyCommitments,
    reviewStatusComplete: true,
    requiresMigration,
    requiresWebsiteRecovery,
    scopes,
    status,
  };
}

export async function buildMigrationChainReadinessFromLegacyAccount(
  legacyAccount: AccountService | LegacyAccountSource | undefined,
  chainId: number,
): Promise<MigrationChainReadiness> {
  const candidates = collectLegacyMigrationCandidates(legacyAccount);
  if (candidates.length === 0) {
    return {
      candidateLegacyCommitments: 0,
      expectedLegacyCommitments: 0,
      migratedCommitments: 0,
      legacyMasterSeedNullifiedCount: 0,
      hasPostMigrationCommitments: false,
      isMigrated: false,
      legacySpendableCommitments: 0,
      upgradedSpendableCommitments: 0,
      declinedLegacyCommitments: 0,
      reviewStatusComplete: true,
      requiresMigration: false,
      requiresWebsiteRecovery: false,
      scopes: [],
      status: "no_legacy",
    };
  }

  const declinedLabels = await loadDeclinedLegacyLabels(chainId, candidates);
  if (declinedLabels === null) {
    const migratedCommitments = candidates.filter(
      (candidate) => candidate.isMigrated,
    ).length;
    const scopes = [...new Set(
      candidates.map((candidate) => candidate.scope.toString()),
    )];
    const allCandidatesMigrated = migratedCommitments === candidates.length;

    return {
      candidateLegacyCommitments: candidates.length,
      expectedLegacyCommitments: allCandidatesMigrated ? candidates.length : 0,
      migratedCommitments,
      legacyMasterSeedNullifiedCount: migratedCommitments,
      hasPostMigrationCommitments: migratedCommitments > 0,
      isMigrated: allCandidatesMigrated,
      legacySpendableCommitments: allCandidatesMigrated
        ? 0
        : Math.max(0, candidates.length - migratedCommitments),
      upgradedSpendableCommitments: migratedCommitments,
      declinedLegacyCommitments: 0,
      reviewStatusComplete: false,
      requiresMigration: !allCandidatesMigrated,
      requiresWebsiteRecovery: false,
      scopes,
      status: allCandidatesMigrated ? "fully_migrated" : "review_incomplete",
    };
  }

  return buildMigrationChainReadiness(candidates, declinedLabels);
}
