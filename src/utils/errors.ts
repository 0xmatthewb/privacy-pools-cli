import chalk from "chalk";
import { dangerTone, notice } from "./theme.js";
import { printJsonError } from "./json.js";
import { isTransientNetworkError } from "./network.js";

export type ErrorCategory =
  | "INPUT"
  | "RPC"
  | "ASP"
  | "RELAYER"
  | "PROOF"
  | "CONTRACT"
  | "UNKNOWN";

export const EXIT_CODES: Record<ErrorCategory, number> = {
  UNKNOWN: 1,
  INPUT: 2,
  RPC: 3,
  ASP: 4,
  RELAYER: 5,
  PROOF: 6,
  CONTRACT: 7,
};

export function exitCodeForCategory(category: ErrorCategory): number {
  return EXIT_CODES[category];
}

const DEFAULT_CODE_BY_CATEGORY: Record<ErrorCategory, string> = {
  INPUT: "INPUT_ERROR",
  RPC: "RPC_ERROR",
  ASP: "ASP_ERROR",
  RELAYER: "RELAYER_ERROR",
  PROOF: "PROOF_ERROR",
  CONTRACT: "CONTRACT_ERROR",
  UNKNOWN: "UNKNOWN_ERROR",
};

export function defaultErrorCode(category: ErrorCategory): string {
  return DEFAULT_CODE_BY_CATEGORY[category];
}

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly hint?: string,
    public readonly code: string = defaultErrorCode(category),
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export function accountMigrationRequiredError(
  hint: string = "Review this account in the Privacy Pools website first. If it shows migratable legacy deposits, migrate them there, then rerun the CLI restore or sync command.",
): CLIError {
  return new CLIError(
    "Legacy pre-upgrade Pool Accounts require migration before the CLI can safely restore this account.",
    "INPUT",
    hint,
    "ACCOUNT_MIGRATION_REQUIRED",
    false,
  );
}

export function accountWebsiteRecoveryRequiredError(
  hint: string = "Review this account in the Privacy Pools website first. Legacy declined deposits cannot be restored safely in the CLI and may require website-based public recovery instead of migration.",
): CLIError {
  return new CLIError(
    "Legacy pre-upgrade Pool Accounts require website-based recovery before the CLI can safely restore this account.",
    "INPUT",
    hint,
    "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    false,
  );
}

const CONTRACT_ERROR_MAP: Record<string, { message: string; hint: string; code: string; retryable?: boolean }> = {
  NullifierAlreadySpent: {
    message: "This Pool Account has already been withdrawn.",
    hint: "Each Pool Account can only be spent once. Check 'privacy-pools accounts' for other available accounts.",
    code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
  },
  IncorrectASPRoot: {
    message: "Pool state changed since proof generation.",
    hint: "Refresh pool data and generate a new proof.",
    code: "CONTRACT_INCORRECT_ASP_ROOT",
    retryable: true,
  },
  UnknownStateRoot: {
    message: "Pool state root is outdated or unknown.",
    hint: "Run 'privacy-pools sync' and retry to generate a fresh proof against the latest state root.",
    code: "CONTRACT_UNKNOWN_STATE_ROOT",
    retryable: true,
  },
  ContextMismatch: {
    message: "Proof context does not match this withdrawal.",
    hint: "Regenerate the proof against the intended chain, pool, amount, and recipient, then retry.",
    code: "CONTRACT_CONTEXT_MISMATCH",
  },
  InvalidProcessooor: {
    message: "Withdrawal type mismatch.",
    hint: "This usually means the wrong withdrawal mode was used. Try switching between --direct and relayed (default).",
    code: "CONTRACT_INVALID_PROCESSOOOR",
  },
  InvalidProof: {
    message: "ZK proof verification failed onchain.",
    hint: "Your local proof inputs may be stale. Run 'privacy-pools sync' and retry.",
    code: "CONTRACT_INVALID_PROOF",
  },
  PrecommitmentAlreadyUsed: {
    message: "This precommitment hash was already used in a previous deposit.",
    hint: "Run a new deposit to generate fresh secrets.",
    code: "CONTRACT_PRECOMMITMENT_ALREADY_USED",
  },
  InvalidCommitment: {
    message: "The selected Pool Account commitment is no longer in the pool state.",
    hint: "Run 'privacy-pools sync' to refresh local account state before retrying.",
    code: "CONTRACT_INVALID_COMMITMENT",
  },
  OnlyOriginalDepositor: {
    message: "Only the original depositor can exit this Pool Account.",
    hint: "Use the same signer address that made the deposit.",
    code: "CONTRACT_ONLY_ORIGINAL_DEPOSITOR",
  },
  NoRootsAvailable: {
    message: "Pool state is not ready for withdrawals yet.",
    hint: "Wait for the relayer to publish the first state root, then retry.",
    code: "CONTRACT_NO_ROOTS_AVAILABLE",
    retryable: true,
  },
  MinimumDepositAmount: {
    message: "Deposit amount is below the pool minimum.",
    hint: "Increase the amount to meet the pool minimum shown by 'privacy-pools pools' or the deposit validation output, then retry.",
    code: "CONTRACT_MINIMUM_DEPOSIT_AMOUNT",
  },
  InvalidWithdrawalAmount: {
    message: "Withdrawal amount is invalid for this Pool Account.",
    hint: "Check the requested amount, available balance, and selected Pool Account, then retry with a valid withdrawal amount.",
    code: "CONTRACT_INVALID_WITHDRAWAL_AMOUNT",
  },
  PoolNotFound: {
    message: "The requested pool is not available on this chain.",
    hint: "Run 'privacy-pools pools' to confirm the asset is supported on this chain, or choose another pool or asset.",
    code: "CONTRACT_POOL_NOT_FOUND",
  },
  PoolIsDead: {
    message: "This pool is no longer accepting new activity.",
    hint: "Choose another pool or asset before retrying.",
    code: "CONTRACT_POOL_IS_DEAD",
  },
  RelayFeeGreaterThanMax: {
    message: "The relayer fee exceeds this pool's configured maximum.",
    hint: "Request a fresh quote and retry. If it persists, wait for fees to normalize or choose another pool or asset.",
    code: "CONTRACT_RELAY_FEE_GREATER_THAN_MAX",
    retryable: true,
  },
  InvalidTreeDepth: {
    message: "The proof inputs do not match this pool's tree configuration.",
    hint: "Run 'privacy-pools sync' and retry once. If it persists, update the CLI before trying again.",
    code: "CONTRACT_INVALID_TREE_DEPTH",
  },
};

export function classifyError(error: unknown): CLIError {
  if (error instanceof CLIError) return error;

  const message =
    error instanceof Error ? error.message : String(error);

  // Check for known contract revert reasons
  for (const [key, mapped] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (message.includes(key)) {
      return new CLIError(
        mapped.message,
        "CONTRACT",
        mapped.hint,
        mapped.code,
        mapped.retryable ?? false
      );
    }
  }

  // Check for SDK error codes
  if (hasCode(error)) {
    const code = (error as { code: string }).code;
    if (code === "MERKLE_ERROR") {
      return new CLIError(
        "Pool Account commitment not found in the Merkle tree.",
        "PROOF",
        "The deposit may not be indexed yet, or local tree data is stale. Run 'privacy-pools sync' and retry.",
        "PROOF_MERKLE_ERROR",
        true
      );
    }
    if (code === "PROOF_GENERATION_FAILED") {
      return new CLIError(
        "Proof generation failed.",
        "PROOF",
        "Run 'privacy-pools sync' to refresh local state and retry. If it persists, verify you are using the correct recovery phrase and that the Pool Account has not already been spent.",
        "PROOF_GENERATION_FAILED"
      );
    }
  }

  // Network/RPC errors
  if (message.includes("timeout")) {
    return new CLIError(
      `Network error: ${message}`,
      "RPC",
      "Check your RPC URL and network connectivity. If the request is timing out, try --timeout <seconds>.",
      "RPC_NETWORK_ERROR",
      true
    );
  }

  if (message.includes("429") || message.toLowerCase().includes("rate limit")) {
    return new CLIError(
      `RPC rate-limited: ${message}`,
      "RPC",
      "Your RPC provider is rate-limiting requests. Wait a moment and retry, or use a dedicated RPC URL with --rpc-url.",
      "RPC_RATE_LIMITED",
      true
    );
  }

  // Catch-all for transient transport failures (ECONNREFUSED, ENOTFOUND,
  // fetch errors, ENETUNREACH, etc.) using the shared predicate from network.ts.
  // `isTransientNetworkError` covers Error instances; the message fallback
  // handles non-Error values (e.g. raw strings) that contain network tokens.
  if (
    isTransientNetworkError(error) ||
    /fetch|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EAI_AGAIN/.test(message)
  ) {
    return new CLIError(
      `Network error: ${message}`,
      "RPC",
      "Check your RPC URL and network connectivity. If using a custom --rpc-url, verify it is reachable.",
      "RPC_NETWORK_ERROR",
      true
    );
  }

  // Insufficient gas / funds from transaction simulation
  if (
    message.includes("insufficient funds") ||
    message.includes("exceeds the balance")
  ) {
    return new CLIError(
      "Insufficient funds for transaction.",
      "CONTRACT",
      "Your wallet does not have enough ETH to cover the deposit amount plus gas fees. Check your balance with 'privacy-pools status'.",
      "CONTRACT_INSUFFICIENT_FUNDS"
    );
  }

  // Nonce errors (concurrent transactions or stuck tx)
  if (
    message.includes("nonce") &&
    (message.includes("too low") || message.includes("already known"))
  ) {
    return new CLIError(
      `Transaction nonce conflict: ${message}`,
      "CONTRACT",
      "A previous transaction may be pending. Wait for it to confirm or use a wallet management tool to resolve stuck transactions.",
      "CONTRACT_NONCE_ERROR",
      true
    );
  }

  return new CLIError(
    message,
    "UNKNOWN",
    "If this persists, please report it at https://github.com/0xmatthewb/privacy-pools-cli/issues."
  );
}

function hasCode(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

export function printError(error: unknown, json: boolean = false): void {
  const classified = classifyError(error);

  if (json) {
    printJsonError(
      {
        code: classified.code,
        category: classified.category,
        message: classified.message,
        hint: classified.hint,
        retryable: classified.retryable,
      },
      false
    );
  } else {
    process.stderr.write(dangerTone(`Error [${classified.category}]: ${classified.message}`) + "\n");
    if (classified.hint) {
      process.stderr.write(notice(`Hint: ${classified.hint}`) + "\n");
    }
  }

  process.exit(EXIT_CODES[classified.category]);
}
