import chalk from "chalk";
import { validateMnemonic as bip39ValidateMnemonic } from "@scure/bip39";
import { wordlist as bip39EnglishWordlist } from "@scure/bip39/wordlists/english.js";
import { dangerTone, notice } from "./theme.js";
import { printJsonError } from "./json.js";
import { isTransientNetworkError } from "./network.js";
import {
  isPromptCancellationError,
  isPromptInteractionUnavailableError,
  PROMPT_CANCELLATION_MESSAGE,
} from "./prompt-cancellation.js";
import {
  getTerminalColumns,
  padDisplay,
  supportsUnicodeOutput,
  visibleWidth,
  wrapDisplayText,
} from "./terminal.js";
import {
  ERROR_CODE_REGISTRY,
  type RegisteredErrorCode,
} from "./error-code-registry.js";
import {
  buildErrorRecoveryNextActions,
  getErrorRecoveryRetryPolicy,
  type ErrorRetryPolicy,
} from "./error-recovery-table.js";
import { readCliPackageInfo } from "../package-info.js";
import type { NextAction } from "../types.js";
import {
  formatDeprecationWarningCallout,
  type DeprecationWarningPayload,
} from "../output/deprecation.js";

export type ErrorCategory =
  | "CANCELLED"
  | "INPUT"
  | "SETUP"
  | "RPC"
  | "ASP"
  | "RELAYER"
  | "PROOF"
  | "CONTRACT"
  | "UNKNOWN";

export type ErrorPresentation = "inline" | "boxed";

export const EXIT_CODES: Record<ErrorCategory, number> = {
  UNKNOWN: 1,
  INPUT: 2,
  RPC: 3,
  SETUP: 4,
  RELAYER: 5,
  PROOF: 6,
  CONTRACT: 7,
  ASP: 8,
  CANCELLED: 9,
};

export function exitCodeForCategory(category: ErrorCategory): number {
  return EXIT_CODES[category];
}

const DEFAULT_CODE_BY_CATEGORY: Record<ErrorCategory, string> = {
  CANCELLED: "PROMPT_CANCELLED",
  INPUT: "INPUT_ERROR",
  SETUP: "SETUP_REQUIRED",
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

export function promptCancelledError(): CLIError {
  return createRegisteredCliError({
    message: PROMPT_CANCELLATION_MESSAGE,
    code: "PROMPT_CANCELLED",
  });
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
const SUPPORTED_MNEMONIC_WORD_COUNTS = new Set([12, 24]);
const ALPHA_WORD_PATTERN = /\b[a-z]+\b/gi;
const CLI_PACKAGE_INFO = readCliPackageInfo(import.meta.url);

function normalizeRepositoryUrl(repository: unknown): string | null {
  const raw =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" &&
          repository !== null &&
          "url" in repository &&
          typeof (repository as { url?: unknown }).url === "string"
        ? (repository as { url: string }).url
        : null;

  if (!raw) return null;

  return raw
    .replace(/^git\+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/\.git$/, "");
}

function repositoryIssueHint(): string {
  const repositoryUrl = normalizeRepositoryUrl(CLI_PACKAGE_INFO.repository);
  if (repositoryUrl?.startsWith("github.com/")) {
    return `If the problem persists, open a GitHub issue at https://${repositoryUrl}/issues.`;
  }
  if (repositoryUrl) {
    return `If the problem persists, open a GitHub issue in the repository: https://${repositoryUrl}.`;
  }
  return "If the problem persists, open a GitHub issue in the privacy-pools-cli repository.";
}

function formatDocsReference(docsSlug: string): string | null {
  const [path, anchor] = docsSlug.split("#", 2);
  if (path.startsWith("guide/")) {
    const topic = path.slice("guide/".length);
    if (!topic) return null;
    return `Docs: privacy-pools guide ${topic}`;
  }
  if (path.startsWith("reference/")) {
    const page = path.slice("reference/".length);
    if (!page) return null;
    return `Docs: docs/reference/${page}.md${anchor ? `#${anchor}` : ""}`;
  }
  return null;
}

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

  return redactMnemonicPhrases(trimmed)
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

function redactMnemonicCandidate(candidate: string): string {
  const normalized = candidate
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .join(" ");
  const wordCount = normalized ? normalized.split(" ").length : 0;
  if (!SUPPORTED_MNEMONIC_WORD_COUNTS.has(wordCount)) {
    return candidate;
  }
  return bip39ValidateMnemonic(normalized, bip39EnglishWordlist)
    ? "<redacted-mnemonic>"
    : candidate;
}

function redactMnemonicPhrases(value: string): string {
  const words = Array.from(value.matchAll(ALPHA_WORD_PATTERN)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  if (words.length === 0) return value;

  const replacements: Array<{ start: number; end: number }> = [];

  for (let index = 0; index < words.length; index += 1) {
    let matchedCount = 0;

    for (const wordCount of [24, 12]) {
      const lastWord = words[index + wordCount - 1];
      if (!lastWord) continue;

      let onlyWhitespaceBetweenWords = true;
      for (let offset = 1; offset < wordCount; offset += 1) {
        const between = value.slice(
          words[index + offset - 1].end,
          words[index + offset].start,
        );
        if (!/^\s+$/.test(between)) {
          onlyWhitespaceBetweenWords = false;
          break;
        }
      }

      if (!onlyWhitespaceBetweenWords) continue;

      const candidate = value.slice(words[index].start, lastWord.end);
      if (redactMnemonicCandidate(candidate) === "<redacted-mnemonic>") {
        replacements.push({ start: words[index].start, end: lastWord.end });
        matchedCount = wordCount;
        break;
      }
    }

    if (matchedCount > 0) {
      index += matchedCount - 1;
    }
  }

  if (replacements.length === 0) return value;

  let sanitized = value;
  for (const replacement of replacements.toReversed()) {
    sanitized =
      sanitized.slice(0, replacement.start) +
      "<redacted-mnemonic>" +
      sanitized.slice(replacement.end);
  }
  return sanitized;
}

export class CLIError extends Error {
  public readonly extra: {
    helpTopic?: string;
    nextActions?: NextAction[];
    retry?: ErrorRetryPolicy;
    recoverySource?: "table";
  };

  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly hint?: string,
    public readonly code: string = defaultErrorCode(category),
    public readonly retryable: boolean = false,
    public readonly presentation: ErrorPresentation = defaultErrorPresentation(category),
    public readonly details?: Record<string, unknown>,
    public readonly docsSlug?: string,
    extra: {
      helpTopic?: string;
      nextActions?: NextAction[];
      retry?: ErrorRetryPolicy;
      recoverySource?: "table";
    } = {},
  ) {
    super(message);
    this.name = "CLIError";
    const retry = extra.retry ?? getErrorRecoveryRetryPolicy(code);
    if (extra.nextActions && extra.nextActions.length > 0) {
      this.extra = retry ? { ...extra, retry } : extra;
      return;
    }
    const nextActions = buildErrorRecoveryNextActions(code, {
      ...(details ?? {}),
      code,
      category,
    });
    this.extra = {
      ...extra,
      ...(nextActions && nextActions.length > 0 ? { nextActions } : {}),
      ...(nextActions && nextActions.length > 0
        ? { recoverySource: "table" as const }
        : {}),
      ...(retry ? { retry } : {}),
    };
  }
}

export function mutuallyExclusive(
  entries: Array<{ name: string; value: unknown }>,
  options: { label?: string; hint?: string; code?: string } = {},
): void {
  const present = entries.filter(({ value }) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.length > 0;
    return true;
  });

  if (present.length <= 1) return;

  const names = present.map(({ name }) => name);
  const label = options.label ?? "options";
  throw new CLIError(
    `Choose only one ${label}: ${names.join(", ")}.`,
    "INPUT",
    options.hint ?? "Use one source for each secret or selector.",
    options.code ?? "INPUT_MUTUALLY_EXCLUSIVE",
  );
}

function defaultErrorPresentation(category: ErrorCategory): ErrorPresentation {
  switch (category) {
    case "INPUT":
    case "SETUP":
    case "ASP":
      return "inline";
    case "RPC":
    case "RELAYER":
    case "PROOF":
    case "CONTRACT":
      return "boxed";
    default:
      return "boxed";
  }
}

function formatHelpTopicReference(helpTopic: string): string {
  return `Help: privacy-pools help ${helpTopic}`;
}

function renderBoxedError(error: CLIError): string {
  const width = Math.max(30, getTerminalColumns() - 4);
  const vertical = supportsUnicodeOutput() ? "│" : "|";
  const horizontal = supportsUnicodeOutput() ? "─" : "-";
  const topLeft = supportsUnicodeOutput() ? "╭" : "+";
  const topRight = supportsUnicodeOutput() ? "╮" : "+";
  const bottomLeft = supportsUnicodeOutput() ? "╰" : "+";
  const bottomRight = supportsUnicodeOutput() ? "╯" : "+";
  const title = ` Error [${error.category}] `;
  const heading = chalk.bold(error.message);
  const body = [
    ...wrapDisplayText(heading, width),
    ...(error.hint
      ? wrapDisplayText(notice(`Hint: ${error.hint}`), width)
      : []),
    ...(error.docsSlug
      ? wrapDisplayText(
          notice(formatDocsReference(error.docsSlug) ?? `Docs: ${error.docsSlug}`),
          width,
        )
      : []),
    ...(error.extra.helpTopic
      ? wrapDisplayText(notice(formatHelpTopicReference(error.extra.helpTopic)), width)
      : []),
  ];
  const contentWidth = Math.max(...body.map((line) => visibleWidth(line)), 24);
  const titleWidth = visibleWidth(title);
  const borderWidth = Math.max(contentWidth + 2, titleWidth + 2);
  const titleRemainder = Math.max(0, borderWidth - titleWidth - 1);
  const top = `${topLeft}${horizontal}${dangerTone(title)}${horizontal.repeat(titleRemainder)}${topRight}`;
  const bottom = `${bottomLeft}${horizontal.repeat(borderWidth)}${bottomRight}`;
  const middle = body
    .map((line) => `${vertical} ${padDisplay(line, borderWidth - 2)} ${vertical}`)
    .join("\n");
  return `\n${dangerTone(top)}\n${middle}\n${dangerTone(bottom)}\n`;
}

function extractDeprecationWarning(
  details: Record<string, unknown> | undefined,
): DeprecationWarningPayload | null {
  const value = details?.deprecationWarning;
  if (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "replacementCommand" in value &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { replacementCommand?: unknown }).replacementCommand === "string"
  ) {
    return value as DeprecationWarningPayload;
  }
  return null;
}

function lookupRegisteredError(code: RegisteredErrorCode) {
  const entry = ERROR_CODE_REGISTRY[code];
  if (!entry) {
    throw new Error(`Missing error-code registry entry for ${code}.`);
  }
  return entry;
}

function createRegisteredCliError(params: {
  message: string;
  code: RegisteredErrorCode;
  hint?: string;
  presentation?: ErrorPresentation;
  details?: Record<string, unknown>;
  docsSlug?: string;
  extra?: {
    helpTopic?: string;
    nextActions?: NextAction[];
    recoverySource?: "table";
  };
}): CLIError {
  const { category, retryable } = lookupRegisteredError(params.code);
  return new CLIError(
    params.message,
    category,
    params.hint,
    params.code,
    retryable,
    params.presentation,
    params.details,
    params.docsSlug,
    params.extra,
  );
}

export function withErrorRecoveryContext(
  error: unknown,
  details: Record<string, unknown>,
): CLIError {
  const classified = classifyError(error, details);
  const mergedDetails = {
    ...(classified.details ?? {}),
    ...details,
  };
  const rebuiltNextActions = buildErrorRecoveryNextActions(classified.code, {
    ...mergedDetails,
    code: classified.code,
    category: classified.category,
  });
  const shouldRebuildNextActions =
    !classified.extra.nextActions ||
    classified.extra.recoverySource === "table";
  const nextActions =
    shouldRebuildNextActions &&
    rebuiltNextActions &&
    rebuiltNextActions.length > 0
      ? rebuiltNextActions
      : classified.extra.nextActions;
  const recoverySource =
    shouldRebuildNextActions &&
    rebuiltNextActions &&
    rebuiltNextActions.length > 0
      ? "table"
      : classified.extra.recoverySource;
  return new CLIError(
    classified.message,
    classified.category,
    classified.hint,
    classified.code,
    classified.retryable,
    classified.presentation,
    mergedDetails,
    classified.docsSlug,
    {
      ...(classified.extra.helpTopic
        ? { helpTopic: classified.extra.helpTopic }
        : {}),
      ...(nextActions && nextActions.length > 0 ? { nextActions } : {}),
      ...(classified.extra.retry ? { retry: classified.extra.retry } : {}),
      ...(recoverySource ? { recoverySource } : {}),
    },
  );
}

export function accountMigrationRequiredError(
  hint: string = "Review this account in the Privacy Pools website first. If it shows migratable legacy deposits, migrate them there, then rerun the CLI restore or sync command.",
): CLIError {
  return createRegisteredCliError({
    message:
      "Legacy pre-upgrade Pool Accounts require migration before the CLI can safely restore this account.",
    code: "ACCOUNT_MIGRATION_REQUIRED",
    hint,
    docsSlug: "reference/migrate#migrate-status",
  });
}

export function accountWebsiteRecoveryRequiredError(
  hint: string = "Review this account in the Privacy Pools website first. Legacy declined deposits cannot be restored safely in the CLI and may require website-based public recovery instead of migration.",
): CLIError {
  return createRegisteredCliError({
    message:
      "Legacy pre-upgrade Pool Accounts require website-based recovery before the CLI can safely restore this account.",
    code: "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    hint,
    docsSlug: "reference/migrate#migrate-status",
  });
}

export function accountMigrationReviewIncompleteError(
  hint: string = "Legacy ASP review data is temporarily unavailable. Retry this command or run 'privacy-pools migrate status' once ASP connectivity is healthy before acting on this account.",
): CLIError {
  return createRegisteredCliError({
    message:
      "The CLI could not safely determine whether legacy website migration or recovery is required because legacy ASP review data is incomplete.",
    code: "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
    hint,
    docsSlug: "reference/migrate#migrate-status",
  });
}

export function accountNotApprovedError(
  message: string,
  hint: string,
  details?: Record<string, unknown>,
): CLIError {
  return createRegisteredCliError({
    message,
    code: "ACCOUNT_NOT_APPROVED",
    hint,
    details,
  });
}

export function rpcPoolResolutionFailedError(
  message: string,
  hint: string = "Check your RPC URL and network connectivity, then retry.",
): CLIError {
  return createRegisteredCliError({
    message,
    code: "RPC_POOL_RESOLUTION_FAILED",
    hint,
  });
}

export function proofMalformedError(
  message: string,
  hint: string = "Regenerate the proof and retry.",
): CLIError {
  return createRegisteredCliError({
    message,
    code: "PROOF_MALFORMED",
    hint,
  });
}

const CONTRACT_ERROR_MAP: Record<string, {
  message: string;
  hint: string;
  code: RegisteredErrorCode;
  retryable?: boolean;
  docsSlug?: string;
}> = {
  NullifierAlreadySpent: {
    message: "This Pool Account has already been withdrawn.",
    hint: "Each Pool Account can only be spent once. Check 'privacy-pools accounts' for other available accounts.",
    code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
    docsSlug: "reference/accounts#accounts",
  },
  IncorrectASPRoot: {
    message: "Pool state changed since proof generation.",
    hint: "Refresh pool data and generate a new proof.",
    code: "CONTRACT_INCORRECT_ASP_ROOT",
    retryable: true,
    docsSlug: "reference/sync#sync",
  },
  UnknownStateRoot: {
    message: "Pool state root is outdated or unknown.",
    hint: "Run 'privacy-pools sync --chain <chain>' and retry to generate a fresh proof against the latest state root.",
    code: "CONTRACT_UNKNOWN_STATE_ROOT",
    retryable: true,
    docsSlug: "reference/sync#sync",
  },
  ScopeMismatch: {
    message: "Invalid scope for this privacy pool.",
    hint: "Run 'privacy-pools sync' to refresh pool data and retry.",
    code: "CONTRACT_SCOPE_MISMATCH",
    retryable: true,
  },
  ContextMismatch: {
    message: "Proof context does not match this withdrawal.",
    hint: "Regenerate the proof against the intended chain, pool, amount, and recipient, then retry.",
    code: "CONTRACT_CONTEXT_MISMATCH",
  },
  InvalidProcessooor: {
    message: "Withdrawal type mismatch.",
    hint: "This usually means the wrong withdrawal mode was used. If you used --direct, retry without it (relayed is the default). Otherwise, run 'privacy-pools sync --chain <chain>' and retry.",
    code: "CONTRACT_INVALID_PROCESSOOOR",
  },
  InvalidProof: {
    message: "ZK proof verification failed onchain.",
    hint: "Your local proof inputs may be stale. Run 'privacy-pools sync --chain <chain>' and retry.",
    code: "CONTRACT_INVALID_PROOF",
    docsSlug: "guide/troubleshooting",
  },
  PrecommitmentAlreadyUsed: {
    message: "This precommitment hash was already used in a previous deposit.",
    hint: "Run a new deposit to generate fresh secrets.",
    code: "CONTRACT_PRECOMMITMENT_ALREADY_USED",
  },
  InvalidCommitment: {
    message: "The selected Pool Account is no longer in the pool state.",
    hint: "Run 'privacy-pools sync' to refresh local account state before retrying.",
    code: "CONTRACT_INVALID_COMMITMENT",
  },
  OnlyOriginalDepositor: {
    message: "Only the original depositor can ragequit this Pool Account.",
    hint: "Use the same signer address that made the deposit.",
    code: "CONTRACT_ONLY_ORIGINAL_DEPOSITOR",
    docsSlug: "reference/ragequit#ragequit",
  },
  NotYetRagequitteable: {
    message: "This Pool Account cannot be ragequit yet.",
    hint: "The deposit must be onchain for a minimum period before public recovery is available. Wait and retry later.",
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
    docsSlug: "reference/pools#pools",
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
    docsSlug: "reference/withdraw#withdraw",
  },
  PoolNotFound: {
    message: "The requested pool is not available on this chain.",
    hint: "Run 'privacy-pools pools' to confirm the asset is supported on this chain, or choose another pool or asset.",
    code: "CONTRACT_POOL_NOT_FOUND",
    docsSlug: "reference/pools#pools",
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

export function classifyError(
  error: unknown,
  recoveryDetails: Record<string, unknown> = {},
): CLIError {
  if (error instanceof CLIError) return error;

  if (isPromptCancellationError(error)) {
    return promptCancelledError();
  }

  if (isPromptInteractionUnavailableError(error)) {
    return new CLIError(
      error.message,
      "INPUT",
      error.hint,
      error.code,
    );
  }

  const rawMessage =
    error instanceof Error ? error.message : String(error);
  const message = sanitizeDiagnosticText(rawMessage);
  const recoveryContextDetails =
    Object.keys(recoveryDetails).length > 0 ? recoveryDetails : undefined;

  // Check for known contract revert reasons
  for (const [key, mapped] of Object.entries(CONTRACT_ERROR_MAP)) {
    if (rawMessage.includes(key)) {
      return createRegisteredCliError({
        message: mapped.message,
        code: mapped.code,
        hint: mapped.hint,
        details: recoveryContextDetails,
        docsSlug: mapped.docsSlug,
      });
    }
  }

  // Check for SDK error codes
  if (hasCode(error)) {
    const code = (error as { code: string }).code;
    if (code === "MERKLE_ERROR") {
      return createRegisteredCliError({
        message: "Pool Account not found in the Merkle tree.",
        code: "PROOF_MERKLE_ERROR",
        hint:
          "The deposit may not be indexed yet, or local tree data is stale. Run 'privacy-pools sync --chain <chain>' and retry.",
        details: recoveryContextDetails,
        docsSlug: "reference/sync#sync",
      });
    }
    if (code === "PROOF_GENERATION_FAILED") {
      return createRegisteredCliError({
        message: "Proof generation failed.",
        code: "PROOF_GENERATION_FAILED",
        hint:
          "Run 'privacy-pools sync' to refresh local state and retry. If it persists, verify you are using the correct recovery phrase and that the Pool Account has not already been spent.",
        details: recoveryContextDetails,
        docsSlug: "guide/troubleshooting",
      });
    }
    if (code === "PROOF_VERIFICATION_FAILED") {
      return createRegisteredCliError({
        message: "Proof verification failed.",
        code: "PROOF_VERIFICATION_FAILED",
        hint:
          "Run 'privacy-pools sync' to refresh local state and retry. If it persists, reinstall the CLI to refresh the bundled circuit artifacts.",
        details: recoveryContextDetails,
        docsSlug: "guide/troubleshooting",
      });
    }
  }

  // Network/RPC errors
  if (rawMessage.includes("timeout")) {
    return createRegisteredCliError({
      message: `Network error: ${message}`,
      code: "RPC_NETWORK_ERROR",
      hint:
        "Check your RPC URL and network connectivity. If the request is timing out, try --timeout <seconds>.",
      details: recoveryContextDetails,
      docsSlug: "guide/troubleshooting",
    });
  }

  if (
    rawMessage.includes("429") ||
    rawMessage.toLowerCase().includes("rate limit")
  ) {
    return createRegisteredCliError({
      message: `RPC rate-limited: ${message}`,
      code: "RPC_RATE_LIMITED",
      hint:
        "Your RPC provider is rate-limiting requests. Wait a moment and retry, or use a dedicated RPC URL with --rpc-url.",
      details: recoveryContextDetails,
      docsSlug: "guide/troubleshooting",
    });
  }

  // Catch-all for transient transport failures (ECONNREFUSED, ENOTFOUND,
  // fetch errors, ENETUNREACH, etc.) using the shared predicate from network.ts.
  // `isTransientNetworkError` covers Error instances; the message fallback
  // handles non-Error values (e.g. raw strings) that contain network tokens.
  if (
    isTransientNetworkError(error) ||
    /fetch|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EAI_AGAIN/.test(rawMessage)
  ) {
    return createRegisteredCliError({
      message: `Network error: ${message}`,
      code: "RPC_NETWORK_ERROR",
      hint:
        "Check your RPC URL and network connectivity. If using a custom --rpc-url, verify it is reachable.",
      details: recoveryContextDetails,
      docsSlug: "guide/troubleshooting",
    });
  }

  // Insufficient gas / funds from transaction simulation
  if (
    rawMessage.includes("insufficient funds") ||
    rawMessage.includes("exceeds the balance")
  ) {
    return createRegisteredCliError({
      message: "Insufficient balance.",
      code: "CONTRACT_INSUFFICIENT_FUNDS",
      hint:
        "Your wallet does not have enough ETH to cover the deposit amount plus gas fees. Check your signer wallet balance in a block explorer or wallet app, then fund it before retrying.",
      details: recoveryContextDetails,
      docsSlug: "guide/troubleshooting",
    });
  }

  // Nonce errors (concurrent transactions or stuck tx)
  if (
    rawMessage.includes("nonce") &&
    (rawMessage.includes("too low") || rawMessage.includes("already known"))
  ) {
    return createRegisteredCliError({
      message: `Transaction nonce conflict: ${message}`,
      code: "CONTRACT_NONCE_ERROR",
      hint:
        "A previous transaction may be pending. Wait for it to confirm or use a wallet management tool to resolve stuck transactions.",
      details: recoveryContextDetails,
      docsSlug: "guide/troubleshooting",
    });
  }

  return createRegisteredCliError({
    message,
    code: "UNKNOWN_ERROR",
    hint: `Try 'privacy-pools sync' to refresh local state, then retry. ${repositoryIssueHint()}`,
    details: recoveryContextDetails,
    docsSlug: "guide/troubleshooting",
  });
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

export function printError(error: unknown, json: boolean = false, quiet?: boolean): void {
  const classified = classifyError(error);

  if (json) {
    printJsonError(
      {
        code: classified.code,
        category: classified.category,
        message: classified.message,
        hint: classified.hint,
        retryable: classified.retryable,
        details: classified.details,
        docsSlug: classified.docsSlug,
        helpTopic: classified.extra.helpTopic,
        nextActions: classified.extra.nextActions,
        retry: classified.extra.retry,
      },
      false
    );
  } else if (quiet ?? argvRequestsQuiet()) {
    process.stderr.write(
      dangerTone(
        `Error [${classified.category}: ${classified.code}]: ${classified.message}`,
      ) + "\n",
    );
  } else {
    if (classified.presentation === "boxed") {
      process.stderr.write(renderBoxedError(classified));
    } else {
      process.stderr.write(dangerTone(`Error [${classified.category}]: ${classified.message}`) + "\n");
      if (classified.hint) {
        process.stderr.write(notice(`Hint: ${classified.hint}`) + "\n");
      }
      if (classified.docsSlug) {
        process.stderr.write(
          notice(
            formatDocsReference(classified.docsSlug) ?? `Docs: ${classified.docsSlug}`,
          ) + "\n",
        );
      }
      if (classified.extra.helpTopic) {
        process.stderr.write(
          notice(formatHelpTopicReference(classified.extra.helpTopic)) + "\n",
        );
      }
    }
    const deprecationWarning = extractDeprecationWarning(classified.details);
    if (deprecationWarning) {
      process.stderr.write(formatDeprecationWarningCallout(deprecationWarning));
    }
  }

  // Preserve stdout/stderr flushing, especially for JSON/agent mode in piped output.
  process.exitCode = EXIT_CODES[classified.category];
}
