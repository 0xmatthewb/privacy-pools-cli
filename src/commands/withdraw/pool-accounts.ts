import type { AspApprovalStatus } from "../../utils/statuses.js";
import {
  describeUnavailablePoolAccount,
  getUnknownPoolAccountError,
  type PoolAccountRef,
} from "../../utils/pool-accounts.js";
import { CLIError } from "../../utils/errors.js";

type WithdrawReviewStatus = Exclude<AspApprovalStatus, "approved">;

interface RequestedWithdrawalPoolAccountParams {
  requestedPoolAccounts: readonly PoolAccountRef[];
  allPoolAccounts: readonly PoolAccountRef[];
  fromPaNumber: number;
  chainName: string;
  symbol: string;
}

export function getEligibleUnapprovedStatuses(
  poolAccounts: readonly PoolAccountRef[],
  withdrawalAmount: bigint,
): WithdrawReviewStatus[] {
  const statuses = new Set<WithdrawReviewStatus>();

  for (const poolAccount of poolAccounts) {
    if (poolAccount.value < withdrawalAmount) continue;
    if (poolAccount.status === "approved") continue;
    if (
      poolAccount.status === "pending" ||
      poolAccount.status === "poa_required" ||
      poolAccount.status === "declined" ||
      poolAccount.status === "unknown"
    ) {
      statuses.add(poolAccount.status);
    }
  }

  return Array.from(statuses);
}

export function resolveRequestedWithdrawalPoolAccountOrThrow(
  params: RequestedWithdrawalPoolAccountParams,
): PoolAccountRef {
  const requested = params.requestedPoolAccounts.find(
    (poolAccount) => poolAccount.paNumber === params.fromPaNumber,
  );
  if (requested) {
    return requested;
  }

  const historical = params.allPoolAccounts.find(
    (poolAccount) => poolAccount.paNumber === params.fromPaNumber,
  );
  const unavailableReason = historical
    ? describeUnavailablePoolAccount(historical, "withdraw")
    : null;
  if (historical && unavailableReason) {
    throw new CLIError(
      unavailableReason,
      "INPUT",
      `Run 'privacy-pools accounts --chain ${params.chainName}' to inspect ${historical.paId} and choose a Pool Account with remaining balance.`,
    );
  }

  const unknownPoolAccount = getUnknownPoolAccountError({
    paNumber: params.fromPaNumber,
    symbol: params.symbol,
    chainName: params.chainName,
    knownPoolAccountsCount: params.allPoolAccounts.length,
    availablePaIds: params.allPoolAccounts.map((poolAccount) => poolAccount.paId),
  });
  throw new CLIError(
    unknownPoolAccount.message,
    "INPUT",
    unknownPoolAccount.hint,
  );
}
