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

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s'")]+/gi;
const IPV4_HOST_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
const HOSTNAME_PATTERN = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s'")]+/g;
const POSIX_PATH_PATTERN = /(^|[\s(])\/(?:[^/\s'")]+\/)*[^/\s'")]+/g;
const PRIVATE_KEY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
const LONG_HEX_PATTERN = /\b0x[0-9a-fA-F]{80,}\b/g;
const ADDRESS_PATTERN = /\b0x[0-9a-fA-F]{40}\b/g;
const URL_SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]+$/;

function isSensitiveEndpointSegment(segment: string): boolean {
  const decoded = segment.trim();
  if (!decoded) return false;
  if (!URL_SAFE_SEGMENT_PATTERN.test(decoded)) return false;
  if (decoded.length >= 16) return true;
  return (
    decoded.length >= 12 &&
    /[A-Za-z]/.test(decoded) &&
    /\d/.test(decoded)
  );
}

export function sanitizeEndpointForDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const hadExplicitTrailingSlash = /\/\/[^/]+\/$/.test(trimmed);
    const sanitizedSegments = parsed.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        const decoded = decodeURIComponent(segment);
        return isSensitiveEndpointSegment(decoded)
          ? "<redacted-segment>"
          : segment;
      });
    const sanitizedPath =
      sanitizedSegments.length > 0
        ? `/${sanitizedSegments.join("/")}`
        : hadExplicitTrailingSlash
          ? "/"
          : "";
    return `${parsed.protocol}//${parsed.host}${sanitizedPath}`;
  } catch {
    return sanitizeDiagnosticText(trimmed);
  }
}

export function sanitizeDiagnosticText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "unknown error";

  return trimmed
    .replace(URL_PATTERN, "<redacted-url>")
    .replace(PRIVATE_KEY_PATTERN, "<redacted-private-key>")
    .replace(LONG_HEX_PATTERN, "<redacted-hex>")
    .replace(ADDRESS_PATTERN, "<redacted-address>")
    .replace(WINDOWS_PATH_PATTERN, "<redacted-path>")
    .replace(
      POSIX_PATH_PATTERN,
      (_match, prefix: string) => `${prefix}<redacted-path>`,
    )
    .replace(
      /\b(?:ENOTFOUND|EAI_AGAIN)\s+\S+/gi,
      (match) => `${match.split(/\s+/, 1)[0]} <redacted-host>`,
    )
    .replace(IPV4_HOST_PATTERN, "<redacted-host>")
    .replace(HOSTNAME_PATTERN, "<redacted-host>");
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

export function accountMigrationReviewIncompleteError(
  hint: string = "Legacy ASP review data is temporarily unavailable. Retry this command or run 'privacy-pools migrate status' once ASP connectivity is healthy before acting on this account.",
): CLIError {
  return new CLIError(
    "The CLI could not safely determine whether legacy website migration or recovery is required because legacy ASP review data is incomplete.",
    "ASP",
    hint,
    "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
    true,
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
  NotYetRagequitteable: {
    message: "This Pool Account cannot be exited yet.",
    hint: "Wait for the deposit to become ragequitteable onchain, then retry the public recovery path.",
    code: "CONTRACT_NOT_YET_RAGEQUITTEABLE",
    retryable: true,
  },
  MaxTreeDepthReached: {
    message: "This pool cannot accept more deposits right now.",
    hint: "Choose another pool or asset, or retry later after the protocol expands pool capacity.",
    code: "CONTRACT_MAX_TREE_DEPTH_REACHED",
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
  InvalidDepositValue: {
    message: "Deposit amount is too large for this pool.",
    hint: "Reduce the deposit amount and retry with a smaller value.",
    code: "CONTRACT_INVALID_DEPOSIT_VALUE",
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
  NativeAssetTransferFailed: {
    message: "Native asset transfer failed during settlement.",
    hint: "The destination address may not be able to receive native ETH. Retry with another recipient or a standard EOA that can accept native ETH.",
    code: "CONTRACT_NATIVE_ASSET_TRANSFER_FAILED",
  },
  FailedToSendNativeAsset: {
    message: "Native asset transfer failed during settlement.",
    hint: "The destination address may not be able to receive native ETH. Retry with another recipient or a standard EOA that can accept native ETH.",
    code: "CONTRACT_NATIVE_ASSET_TRANSFER_FAILED",
  },
};

export function classifyError(error: unknown): CLIError {
  if (error instanceof CLIError) return error;

  const rawMessage =
    error instanceof Error ? error.message : String(error);
  const message = sanitizeDiagnosticText(rawMessage);

  // Check for known contract revert reasons
  for (const [key, mapped] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (rawMessage.includes(key)) {
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
  if (rawMessage.includes("timeout")) {
    return new CLIError(
      `Network error: ${message}`,
      "RPC",
      "Check your RPC URL and network connectivity. If the request is timing out, try --timeout <seconds>.",
      "RPC_NETWORK_ERROR",
      true
    );
  }

  if (
    rawMessage.includes("429") ||
    rawMessage.toLowerCase().includes("rate limit")
  ) {
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
    /fetch|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EAI_AGAIN/.test(rawMessage)
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
    rawMessage.includes("insufficient funds") ||
    rawMessage.includes("exceeds the balance")
  ) {
    return new CLIError(
      "Insufficient funds for transaction.",
      "CONTRACT",
      "Your wallet does not have enough ETH to cover the deposit amount plus gas fees. Check your signer wallet balance in a block explorer or wallet app, then fund it before retrying.",
      "CONTRACT_INSUFFICIENT_FUNDS"
    );
  }

  // Nonce errors (concurrent transactions or stuck tx)
  if (
    rawMessage.includes("nonce") &&
    (rawMessage.includes("too low") || rawMessage.includes("already known"))
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
    "Try 'privacy-pools sync' to reconcile local state, then retry. If the problem persists, please report it at https://github.com/0xmatthewb/privacy-pools-cli/issues."
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

function argvRequestsQuiet(argv: readonly string[] = process.argv.slice(2)): boolean {
  return argv.some((token) => token === "--quiet" || /^-[^-]*q[^-]*$/.test(token));
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
  } else if (!argvRequestsQuiet()) {
    process.stderr.write(dangerTone(`Error [${classified.category}]: ${classified.message}`) + "\n");
    if (classified.hint) {
      process.stderr.write(notice(`Hint: ${classified.hint}`) + "\n");
    }
  }

  process.exit(EXIT_CODES[classified.category]);
}
