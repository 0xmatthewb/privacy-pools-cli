import type {
  AccountCommitment,
  PoolAccount,
  PrivacyPoolAccount,
  RagequitEvent,
} from "@0xbow/privacy-pools-core-sdk";
import {
  type AspApprovalStatus,
  isActivePoolAccountStatus,
  type PoolAccountStatus,
} from "./statuses.js";

interface PoolAccountLike extends Pick<PoolAccount, "deposit" | "children" | "ragequit" | "isMigrated"> {}
type PoolAccountMap = ReadonlyMap<unknown, readonly PoolAccountLike[]>;
interface PoolAccountSource {
  poolAccounts?: PoolAccountMap;
}

export type { PoolAccountStatus, AspApprovalStatus } from "./statuses.js";

export interface PoolAccountRef {
  paNumber: number;
  paId: string;
  status: PoolAccountStatus;
  aspStatus: AspApprovalStatus;
  isActionable?: boolean;
  isHistoricalOnly?: boolean;
  commitment: AccountCommitment;
  label: bigint;
  value: bigint;
  blockNumber: bigint;
  txHash: string;
}

export interface PoolAccountRefClassification {
  allRefs: PoolAccountRef[];
  activeRefs: PoolAccountRef[];
}

type PoolAccountAction = "withdraw" | "ragequit";

interface UnknownPoolAccountErrorParams {
  paNumber: number;
  symbol: string;
  chainName: string;
  knownPoolAccountsCount: number;
  /** Optional list of known PA IDs for the error hint (e.g. ["PA-1", "PA-2"]). */
  availablePaIds?: string[];
}

function commitmentKey(commitment: Pick<AccountCommitment, "label" | "hash">): string {
  return `${commitment.label.toString()}:${commitment.hash.toString()}`;
}

export function collectActiveLabels(commitments: readonly unknown[]): string[] {
  const labels = new Set<string>();

  for (const commitment of commitments) {
    if (typeof commitment !== "object" || commitment === null) continue;
    const label = "label" in commitment ? (commitment as { label?: unknown }).label : undefined;
    if (typeof label !== "bigint") continue;
    labels.add(label.toString());
  }

  return Array.from(labels);
}

function getCurrentCommitment(poolAccount: PoolAccountLike): AccountCommitment {
  return poolAccount.children.length > 0
    ? poolAccount.children[poolAccount.children.length - 1]
    : poolAccount.deposit;
}

function isHiddenMigratedPoolAccount(poolAccount: PoolAccountLike): boolean {
  return "isMigrated" in poolAccount && poolAccount.isMigrated === true;
}

function isRagequitEvent(value: unknown): value is RagequitEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    blockNumber?: unknown;
    transactionHash?: unknown;
  };
  return (
    typeof candidate.blockNumber === "bigint" &&
    typeof candidate.transactionHash === "string"
  );
}

function asPoolAccounts(
  value: readonly PoolAccountLike[] | unknown,
): readonly PoolAccountLike[] | null {
  return Array.isArray(value) ? (value as readonly PoolAccountLike[]) : null;
}

function getPoolAccountsForScope(
  account: PoolAccountSource | PrivacyPoolAccount | null | undefined,
  scope: bigint
): readonly PoolAccountLike[] {
  const map = account?.poolAccounts as PoolAccountMap | undefined;
  if (!(map instanceof Map)) return [];

  const directMatch = asPoolAccounts(map.get(scope));
  if (directMatch) {
    return directMatch;
  }

  const stringKeyMatch = asPoolAccounts(map.get(scope.toString()));
  if (stringKeyMatch) {
    return stringKeyMatch;
  }

  for (const [key, value] of map.entries()) {
    const compatibleMatch = asPoolAccounts(value);
    if (key.toString() === scope.toString() && compatibleMatch) {
      return compatibleMatch;
    }
  }

  return [];
}

export function poolAccountId(paNumber: number): string {
  return `PA-${paNumber}`;
}

export function parsePoolAccountSelector(value: string): number | null {
  const raw = value.trim();
  const paMatch = raw.match(/^pa-(\d+)$/i);
  const numberMatch = raw.match(/^(\d+)$/);
  const digits = paMatch?.[1] ?? numberMatch?.[1];
  if (!digits) return null;

  const parsed = Number.parseInt(digits, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function buildPoolAccountRefs(
  account: PoolAccountSource | PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[],
  approvedLabels?: Set<string> | null,
  reviewStatuses?: ReadonlyMap<string, AspApprovalStatus> | null,
): PoolAccountRef[] {
  return classifyPoolAccountRefs(
    account,
    scope,
    spendableCommitments,
    approvedLabels,
    reviewStatuses,
  ).activeRefs;
}

function shouldIncludePoolAccountRef(
  ref: PoolAccountRef,
  includeInactive: boolean,
): boolean {
  return includeInactive || (
    ref.isActionable !== false &&
    ref.value > 0n &&
    isActivePoolAccountStatus(ref.status)
  );
}

export function classifyPoolAccountRefs(
  account: PoolAccountSource | PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[],
  approvedLabels?: Set<string> | null,
  reviewStatuses?: ReadonlyMap<string, AspApprovalStatus> | null,
): PoolAccountRefClassification {
  const spendableByKey = new Map<string, AccountCommitment>();
  for (const commitment of spendableCommitments) {
    spendableByKey.set(commitmentKey(commitment), commitment);
  }

  function resolveAspStatus(label: bigint, hasReviewableBalance: boolean): AspApprovalStatus {
    if (!hasReviewableBalance) return "unknown";

    const labelKey = label.toString();
    const reviewStatus = reviewStatuses?.get(labelKey);
    if (reviewStatus) {
      if (reviewStatus === "approved") {
        if (approvedLabels === null || approvedLabels === undefined) {
          return "unknown";
        }
        if (!approvedLabels.has(labelKey)) {
          return "pending";
        }
      }
      return reviewStatus;
    }

    if (!approvedLabels) return "unknown";
    return approvedLabels.has(labelKey) ? "approved" : "unknown";
  }

  const allRefs: PoolAccountRef[] = [];
  const activeRefs: PoolAccountRef[] = [];
  let nextPoolAccountNumber = 1;
  const poolAccounts = getPoolAccountsForScope(account, scope);
  for (const poolAccount of poolAccounts) {
    if (isHiddenMigratedPoolAccount(poolAccount)) {
      continue;
    }

    const currentCommitment = getCurrentCommitment(poolAccount);
    const key = commitmentKey(currentCommitment);
    const spendable = spendableByKey.get(key);
    const commitment = spendable ?? currentCommitment;
    const ragequit = isRagequitEvent(poolAccount.ragequit) ? poolAccount.ragequit : null;
    const isHistoricalOnly =
      !ragequit &&
      spendable === undefined &&
      currentCommitment.value > 0n;
    const aspStatus = isHistoricalOnly
      ? "unknown"
      : resolveAspStatus(commitment.label, !ragequit && commitment.value > 0n);
    const status: PoolAccountStatus = ragequit
      ? "exited"
      : isHistoricalOnly || commitment.value === 0n
        ? "spent"
        : aspStatus;

    const ref: PoolAccountRef = {
      paNumber: nextPoolAccountNumber,
      paId: poolAccountId(nextPoolAccountNumber),
      status,
      aspStatus,
      isActionable: !isHistoricalOnly && !ragequit && commitment.value > 0n,
      isHistoricalOnly,
      commitment,
      label: commitment.label,
      value: ragequit ? 0n : commitment.value,
      blockNumber: ragequit ? ragequit.blockNumber : commitment.blockNumber,
      txHash: ragequit ? ragequit.transactionHash : commitment.txHash,
    };

    allRefs.push(ref);
    if (shouldIncludePoolAccountRef(ref, false)) {
      activeRefs.push(ref);
    }

    if (spendable) {
      spendableByKey.delete(key);
    }
    nextPoolAccountNumber++;
  }

  // Fallback for commitments that cannot be matched to saved pool account entries.
  for (const commitment of spendableCommitments) {
    const key = commitmentKey(commitment);
    if (!spendableByKey.has(key)) continue;
    const aspStatus = resolveAspStatus(commitment.label, commitment.value > 0n);
    const ref: PoolAccountRef = {
      paNumber: nextPoolAccountNumber,
      paId: poolAccountId(nextPoolAccountNumber),
      status: commitment.value === 0n ? "spent" : aspStatus,
      aspStatus,
      isActionable: commitment.value > 0n,
      isHistoricalOnly: false,
      commitment,
      label: commitment.label,
      value: commitment.value,
      blockNumber: commitment.blockNumber,
      txHash: commitment.txHash,
    };
    allRefs.push(ref);
    if (shouldIncludePoolAccountRef(ref, false)) {
      activeRefs.push(ref);
    }
    spendableByKey.delete(key);
    nextPoolAccountNumber++;
  }

  allRefs.sort((a, b) => a.paNumber - b.paNumber);
  activeRefs.sort((a, b) => a.paNumber - b.paNumber);
  return { allRefs, activeRefs };
}

export function buildAllPoolAccountRefs(
  account: PoolAccountSource | PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[],
  approvedLabels?: Set<string> | null,
  reviewStatuses?: ReadonlyMap<string, AspApprovalStatus> | null,
): PoolAccountRef[] {
  return classifyPoolAccountRefs(
    account,
    scope,
    spendableCommitments,
    approvedLabels,
    reviewStatuses,
  ).allRefs;
}

export function describeUnavailablePoolAccount(
  poolAccount: Pick<PoolAccountRef, "paId" | "status" | "isHistoricalOnly">,
  action: PoolAccountAction,
): string | null {
  if (poolAccount.isHistoricalOnly) {
    return action === "withdraw"
      ? `${poolAccount.paId} only exists in saved historical state and is not currently actionable for withdrawal. Run 'privacy-pools sync' to refresh local state before withdrawing from it.`
      : `${poolAccount.paId} only exists in saved historical state and is not currently actionable for ragequit. Run 'privacy-pools sync' to refresh local state before recovering it publicly.`;
  }

  switch (poolAccount.status) {
    case "spent":
      return action === "withdraw"
        ? `${poolAccount.paId} was already fully withdrawn and no longer has a balance to use.`
        : `${poolAccount.paId} was already fully withdrawn and no longer has a balance to ragequit.`;
    case "exited":
      return action === "withdraw"
        ? `${poolAccount.paId} was already recovered publicly with ragequit and cannot be withdrawn again.`
        : `${poolAccount.paId} was already recovered publicly with ragequit and cannot be ragequit again.`;
    default:
      return null;
  }
}

export function getUnknownPoolAccountError(
  params: UnknownPoolAccountErrorParams,
): { message: string; hint: string } {
  const { paNumber, symbol, chainName, knownPoolAccountsCount } = params;
  const paId = poolAccountId(paNumber);

  if (knownPoolAccountsCount === 0) {
    return {
      message: `Unknown Pool Account ${paId} for ${symbol}.`,
      hint:
        `No local Pool Accounts are available for ${symbol} on ${chainName} yet. ` +
        `Deposit first, then run 'privacy-pools accounts --chain ${chainName}' ` +
        "to confirm available Pool Accounts.",
    };
  }

  const availableList = params.availablePaIds?.length
    ? ` Available: ${params.availablePaIds.join(", ")}.`
    : "";
  return {
    message: `Unknown Pool Account ${paId} for ${symbol}.`,
    hint: `Run 'privacy-pools accounts --chain ${chainName}' to list available Pool Accounts.${availableList}`,
  };
}

export function getNextPoolAccountNumber(
  account: PoolAccountSource | PrivacyPoolAccount | null | undefined,
  scope: bigint
): number {
  let visiblePoolAccounts = 0;
  for (const poolAccount of getPoolAccountsForScope(account, scope)) {
    if (isHiddenMigratedPoolAccount(poolAccount)) {
      continue;
    }
    visiblePoolAccounts += 1;
  }

  return visiblePoolAccounts + 1;
}

export function buildDeclinedLegacyPoolAccountRefs(
  account: PoolAccountSource | PrivacyPoolAccount | null | undefined,
  scope: bigint,
  declinedLabels: ReadonlySet<string>,
  startNumber: number,
): PoolAccountRef[] {
  const scopedAccounts = getPoolAccountsForScope(account, scope);
  if (scopedAccounts.length === 0 || declinedLabels.size === 0) {
    return [];
  }

  const refs: PoolAccountRef[] = [];
  let nextNumber = startNumber;

  for (const poolAccount of scopedAccounts) {
    if (poolAccount.isMigrated === true) {
      continue;
    }

    const label =
      typeof poolAccount.deposit?.label === "bigint"
        ? poolAccount.deposit.label
        : null;
    if (label === null || !declinedLabels.has(label.toString())) {
      continue;
    }

    const commitment = getCurrentCommitment(poolAccount);
    const ragequit = isRagequitEvent(poolAccount.ragequit)
      ? poolAccount.ragequit
      : null;
    const status: PoolAccountStatus = ragequit
      ? "exited"
      : commitment.value === 0n
        ? "spent"
        : "declined";

    refs.push({
      paNumber: nextNumber,
      paId: poolAccountId(nextNumber),
      status,
      aspStatus: status === "declined" ? "declined" : "unknown",
      isActionable: status === "declined",
      isHistoricalOnly: false,
      commitment,
      label,
      value: ragequit ? 0n : commitment.value,
      blockNumber: ragequit ? ragequit.blockNumber : commitment.blockNumber,
      txHash: ragequit ? ragequit.transactionHash : commitment.txHash,
    });
    nextNumber += 1;
  }

  return refs;
}
