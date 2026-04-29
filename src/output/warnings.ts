import type { PrivacyNonRoundAmountWarning } from "../utils/amount-privacy.js";

export interface StructuredJsonWarning {
  code: string;
  category: string;
  message: string;
}

export type TransactionJsonWarning =
  | StructuredJsonWarning
  | PrivacyNonRoundAmountWarning;

type WarningSubject =
  | "deposit state"
  | "withdrawal balance"
  | "ragequit status"
  | "workflow snapshot";

function buildReconciliationWarning(
  code: string,
  chain: string,
  subject: WarningSubject,
): StructuredJsonWarning {
  return {
    code,
    category: "local_state",
    message:
      `Local state needs reconciliation before you rely on the saved ${subject}. ` +
      `Run privacy-pools sync --chain ${chain} to refresh it.`,
  };
}

export function warningFromCode(
  code: string | null | undefined,
  params: {
    chain: string;
    subject: WarningSubject;
  },
): StructuredJsonWarning | null {
  if (!code) {
    return null;
  }

  switch (code) {
    case "LOCAL_STATE_RECONCILIATION_REQUIRED":
      return buildReconciliationWarning(code, params.chain, params.subject);
    default:
      return {
        code,
        category: "general",
        message: code,
      };
  }
}

export function mergeStructuredWarnings<T extends StructuredJsonWarning>(
  existing: readonly T[] | undefined,
  derived: StructuredJsonWarning | null,
): Array<T | StructuredJsonWarning> | undefined {
  const merged = [
    ...(existing ?? []),
    ...(derived ? [derived] : []),
  ];
  return merged.length > 0 ? merged : undefined;
}
