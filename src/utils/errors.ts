import chalk from "chalk";
import { printJsonError } from "./json.js";

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

const CONTRACT_ERROR_MAP: Record<string, { message: string; hint: string; code: string; retryable?: boolean }> = {
  NullifierAlreadySpent: {
    message: "This Pool Account has already been withdrawn.",
    hint: "Each Pool Account can only be spent once. Check 'privacy-pools accounts' for other spendable accounts.",
    code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
  },
  IncorrectASPRoot: {
    message: "Pool state changed since proof generation.",
    hint: "Refresh pool data and generate a new proof.",
    code: "CONTRACT_INCORRECT_ASP_ROOT",
    retryable: true,
  },
  InvalidProcessooor: {
    message: "Withdrawal type mismatch.",
    hint: "This usually means the wrong withdrawal mode was used. Try switching between --direct and relayed (default).",
    code: "CONTRACT_INVALID_PROCESSOOOR",
  },
  InvalidProof: {
    message: "ZK proof verification failed on-chain.",
    hint: "Your local proof inputs may be stale. Run 'privacy-pools sync' and retry.",
    code: "CONTRACT_INVALID_PROOF",
  },
  PrecommitmentAlreadyUsed: {
    message: "This precommitment hash was already used in a previous deposit.",
    hint: "Retry the deposit command to generate fresh deposit secrets.",
    code: "CONTRACT_PRECOMMITMENT_ALREADY_USED",
  },
  OnlyOriginalDepositor: {
    message: "Only the original depositor can exit this Pool Account.",
    hint: "Use the same signer address that made the deposit.",
    code: "CONTRACT_ONLY_ORIGINAL_DEPOSITOR",
  },
  NoRootsAvailable: {
    message: "Pool state is not ready for withdrawals yet.",
    hint: "Wait for the withdrawal service to publish the first state root, then retry.",
    code: "CONTRACT_NO_ROOTS_AVAILABLE",
    retryable: true,
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
        "Run 'privacy-pools sync' and retry. If it persists, verify you are using the correct signer/mnemonic.",
        "PROOF_GENERATION_FAILED"
      );
    }
  }

  // Network/RPC errors
  if (
    message.includes("fetch") ||
    message.includes("ECONNREFUSED") ||
    message.includes("timeout")
  ) {
    return new CLIError(
      `Network error: ${message}`,
      "RPC",
      "Check your RPC URL and network connectivity.",
      "RPC_NETWORK_ERROR",
      true
    );
  }

  return new CLIError(message, "UNKNOWN");
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
    console.error(chalk.red(`Error [${classified.category}]: ${classified.message}`));
    if (classified.hint) {
      console.error(chalk.yellow(`Hint: ${classified.hint}`));
    }
  }

  process.exit(EXIT_CODES[classified.category]);
}
