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

export type { PoolAccountStatus, AspApprovalStatus } from "./statuses.js";

export interface PoolAccountRef {
  paNumber: number;
  paId: string;
  status: PoolAccountStatus;
  aspStatus: AspApprovalStatus;
  commitment: AccountCommitment;
  label: bigint;
  value: bigint;
  blockNumber: bigint;
  txHash: string;
}

type PoolAccountAction = "withdraw" | "ragequit";

interface UnknownPoolAccountErrorParams {
  paNumber: number;
  symbol: string;
  chainName: string;
  knownPoolAccountsCount: number;
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

function getPoolAccountsForScope(
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint
): PoolAccountLike[] {
  const map = account?.poolAccounts;
  if (!(map instanceof Map)) return [];

  for (const [key, value] of map.entries()) {
    if (key.toString() === scope.toString() && Array.isArray(value)) {
      return value as PoolAccountLike[];
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
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[],
  approvedLabels?: Set<string> | null,
  reviewStatuses?: ReadonlyMap<string, AspApprovalStatus> | null,
): PoolAccountRef[] {
  return buildAllPoolAccountRefs(account, scope, spendableCommitments, approvedLabels, reviewStatuses)
    .filter((pa) => pa.value > 0n && isActivePoolAccountStatus(pa.status));
}

export function buildAllPoolAccountRefs(
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[],
  approvedLabels?: Set<string> | null,
  reviewStatuses?: ReadonlyMap<string, AspApprovalStatus> | null,
): PoolAccountRef[] {
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

  const refs: PoolAccountRef[] = [];
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
    const aspStatus = resolveAspStatus(commitment.label, !ragequit && commitment.value > 0n);
    const status: PoolAccountStatus = ragequit
      ? "exited"
      : commitment.value === 0n
        ? "spent"
        : aspStatus;

    refs.push({
      paNumber: nextPoolAccountNumber,
      paId: poolAccountId(nextPoolAccountNumber),
      status,
      aspStatus,
      commitment,
      label: commitment.label,
      value: ragequit ? 0n : commitment.value,
      blockNumber: ragequit ? ragequit.blockNumber : commitment.blockNumber,
      txHash: ragequit ? ragequit.transactionHash : commitment.txHash,
    });

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
    refs.push({
      paNumber: nextPoolAccountNumber,
      paId: poolAccountId(nextPoolAccountNumber),
      status: commitment.value === 0n ? "spent" : aspStatus,
      aspStatus,
      commitment,
      label: commitment.label,
      value: commitment.value,
      blockNumber: commitment.blockNumber,
      txHash: commitment.txHash,
    });
    spendableByKey.delete(key);
    nextPoolAccountNumber++;
  }

  refs.sort((a, b) => a.paNumber - b.paNumber);
  return refs;
}

export function describeUnavailablePoolAccount(
  poolAccount: Pick<PoolAccountRef, "paId" | "status">,
  action: PoolAccountAction,
): string | null {
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

  return {
    message: `Unknown Pool Account ${paId} for ${symbol}.`,
    hint: `Run 'privacy-pools accounts --chain ${chainName}' to list available Pool Accounts.`,
  };
}

export function getNextPoolAccountNumber(
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint
): number {
  return (
    getPoolAccountsForScope(account, scope).filter(
      (poolAccount) => !isHiddenMigratedPoolAccount(poolAccount),
    ).length + 1
  );
}
