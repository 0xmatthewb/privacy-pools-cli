import type {
  AccountCommitment,
  PoolAccount,
  PrivacyPoolAccount,
  RagequitEvent,
} from "@0xbow/privacy-pools-core-sdk";

interface PoolAccountLike extends Pick<PoolAccount, "deposit" | "children" | "ragequit"> {}

export type PoolAccountStatus = "spendable" | "spent" | "exited";

export interface PoolAccountRef {
  paNumber: number;
  paId: string;
  status: PoolAccountStatus;
  commitment: AccountCommitment;
  label: bigint;
  value: bigint;
  blockNumber: bigint;
  txHash: string;
}

function commitmentKey(commitment: Pick<AccountCommitment, "label" | "hash">): string {
  return `${commitment.label.toString()}:${commitment.hash.toString()}`;
}

function getCurrentCommitment(poolAccount: PoolAccountLike): AccountCommitment {
  return poolAccount.children.length > 0
    ? poolAccount.children[poolAccount.children.length - 1]
    : poolAccount.deposit;
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
  spendableCommitments: readonly AccountCommitment[]
): PoolAccountRef[] {
  return buildAllPoolAccountRefs(account, scope, spendableCommitments)
    .filter((pa) => pa.status === "spendable");
}

export function buildAllPoolAccountRefs(
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[]
): PoolAccountRef[] {
  const spendableByKey = new Map<string, AccountCommitment>();
  for (const commitment of spendableCommitments) {
    spendableByKey.set(commitmentKey(commitment), commitment);
  }

  const refs: PoolAccountRef[] = [];
  let nextPoolAccountNumber = 1;
  const poolAccounts = getPoolAccountsForScope(account, scope);
  for (const poolAccount of poolAccounts) {
    const currentCommitment = getCurrentCommitment(poolAccount);
    const key = commitmentKey(currentCommitment);
    const spendable = spendableByKey.get(key);
    const commitment = spendable ?? currentCommitment;
    const ragequit = isRagequitEvent(poolAccount.ragequit) ? poolAccount.ragequit : null;
    const status: PoolAccountStatus = ragequit
      ? "exited"
      : commitment.value > 0n
        ? "spendable"
        : "spent";

    refs.push({
      paNumber: nextPoolAccountNumber,
      paId: poolAccountId(nextPoolAccountNumber),
      status,
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
    refs.push({
      paNumber: nextPoolAccountNumber,
      paId: poolAccountId(nextPoolAccountNumber),
      status: "spendable",
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

export function getNextPoolAccountNumber(
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint
): number {
  return getPoolAccountsForScope(account, scope).length + 1;
}
