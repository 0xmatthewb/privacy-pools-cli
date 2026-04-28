import type { ErrorCategory } from "./errors.js";

export interface ErrorCodeRegistryEntry {
  category: ErrorCategory;
  retryable: boolean;
}

// This registry intentionally tracks the agent-docs conformance surface.
export const ERROR_CODE_REGISTRY = {
  INPUT_ERROR: { category: "INPUT", retryable: false },
  INPUT_ADDRESS_CHECKSUM_INVALID: { category: "INPUT", retryable: false },
  INPUT_AGENT_ACCOUNTS_WATCH_UNSUPPORTED: { category: "INPUT", retryable: false },
  INPUT_AGENT_FLOW_WATCH_UNSUPPORTED: { category: "INPUT", retryable: false },
  INPUT_APPROVAL_REQUIRED_NO_WAIT: { category: "INPUT", retryable: false },
  INPUT_APPROVED_POOL_ACCOUNT_RAGEQUIT_REQUIRES_OVERRIDE: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_APPROVED_WORKFLOW_RAGEQUIT_REQUIRES_OVERRIDE: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BAD_ADDRESS: { category: "INPUT", retryable: false },
  INPUT_BELOW_MINIMUM_DEPOSIT: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_CHAIN_MISMATCH: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_CHAIN_OVERRIDE_MISMATCH: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_EMPTY_STDIN: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_INLINE_JSON_UNSUPPORTED: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_INPUT_NOT_FOUND: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_INPUT_UNREADABLE: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_INVALID_ENVELOPE: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_INVALID_JSON: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_MISSING_RELAYER_HOST: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_MISSING_SIGNED_TRANSACTIONS: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_MIXED_SIGNERS: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_REQUIRES_ENVELOPE: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_SIGNED_TRANSACTION_COUNT_MISMATCH: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_BROADCAST_SIGNER_MISMATCH: { category: "INPUT", retryable: false },
  INPUT_BROADCAST_STDIN_READ_FAILED: { category: "INPUT", retryable: false },
  INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_DIRECT_WITHDRAW_CONSENT_REQUIRED: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_DIRECT_WITHDRAW_AGENT_ACK_REQUIRED: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_FLAG_CONFLICT: { category: "INPUT", retryable: false },
  INPUT_FLOW_RECIPIENT_RETRY_LIMIT: { category: "INPUT", retryable: false },
  INPUT_INIT_GENERATE_REQUIRES_CAPTURE: {
    category: "INPUT",
    retryable: false,
  },
  INIT_GENERATED_RECOVERY_WORD_COUNT_INVALID: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_INIT_REQUIRED: { category: "INPUT", retryable: false },
  INPUT_INIT_RECOVERY_PHRASE_REQUIRED: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_INSUFFICIENT_BALANCE: { category: "INPUT", retryable: false },
  INPUT_INSUFFICIENT_GAS: { category: "INPUT", retryable: false },
  INPUT_INVALID_AMOUNT: { category: "INPUT", retryable: false },
  INPUT_INVALID_ASSET: { category: "INPUT", retryable: false },
  INPUT_INVALID_OPTION: { category: "INPUT", retryable: false },
  INPUT_INVALID_JQ: { category: "INPUT", retryable: false },
  INPUT_INVALID_RPC_URL: { category: "INPUT", retryable: false },
  INPUT_INVALID_VALUE: { category: "INPUT", retryable: false },
  INPUT_MISSING_AMOUNT: { category: "INPUT", retryable: false },
  INPUT_MISSING_ARGUMENT: { category: "INPUT", retryable: false },
  INPUT_MISSING_ASSET: { category: "INPUT", retryable: false },
  INPUT_MISSING_FLOW_SUBCOMMAND: { category: "INPUT", retryable: false },
  INPUT_MISSING_RECIPIENT: { category: "INPUT", retryable: false },
  INPUT_MUTUALLY_EXCLUSIVE: { category: "INPUT", retryable: false },
  INPUT_NONROUND_AMOUNT: { category: "INPUT", retryable: false },
  INPUT_NO_SAVED_WORKFLOWS: { category: "INPUT", retryable: false },
  INPUT_NO_GAS: { category: "INPUT", retryable: false },
  INPUT_NO_COMMAND: { category: "INPUT", retryable: false },
  PROMPT_REQUIRED_NOT_INTERACTIVE: { category: "INPUT", retryable: false },
  INPUT_PARSE_ERROR: { category: "INPUT", retryable: false },
  INPUT_RAGEQUIT_CONFIRMATION_REQUIRED: {
    category: "INPUT",
    retryable: false,
  },
  PROMPT_CANCELLED: { category: "CANCELLED", retryable: false },
  INPUT_RECIPIENT_RETRY_LIMIT: { category: "INPUT", retryable: false },
  INPUT_RECIPIENT_BURN_ADDRESS: { category: "INPUT", retryable: false },
  INPUT_RECOVERY_PHRASE_RETRY_LIMIT: { category: "INPUT", retryable: false },
  INPUT_RECOVERY_VERIFICATION_RETRY_LIMIT: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_REMAINDER_BELOW_RELAYER_MINIMUM: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_SIMULATE_UNSIGNED_UNSUPPORTED: { category: "INPUT", retryable: false },
  INPUT_UNKNOWN_ASSET: { category: "INPUT", retryable: false },
  INPUT_UNKNOWN_CHAIN: { category: "INPUT", retryable: false },
  INPUT_UNKNOWN_COMMAND: { category: "INPUT", retryable: false },
  INPUT_UNKNOWN_JSON_FIELD: { category: "INPUT", retryable: false },
  INPUT_JSON_FIELDS_REQUIRED: { category: "INPUT", retryable: false },
  INPUT_UNKNOWN_OPTION: { category: "INPUT", retryable: false },
  INPUT_UNKNOWN_SUBMISSION: { category: "INPUT", retryable: false },
  INPUT_WATCH_REQUIRES_TTY: { category: "INPUT", retryable: false },
  INPUT_WORKFLOW_INVALID_STRUCTURE: { category: "INPUT", retryable: false },
  INPUT_WORKFLOW_LATEST_AMBIGUOUS_INVALID_FILES: {
    category: "INPUT",
    retryable: false,
  },
  INPUT_WORKFLOW_NOT_FOUND: { category: "INPUT", retryable: false },
  INPUT_WORKFLOW_UNSUPPORTED_SCHEMA_VERSION: {
    category: "INPUT",
    retryable: false,
  },
  SETUP_REQUIRED: { category: "SETUP", retryable: false },
  SETUP_INVALID_RECOVERY_PHRASE: { category: "SETUP", retryable: false },
  SETUP_INVALID_SIGNER_KEY: { category: "SETUP", retryable: false },
  SETUP_RECOVERY_PHRASE_MISSING: { category: "SETUP", retryable: false },
  SETUP_SIGNER_KEY_MISSING: { category: "SETUP", retryable: false },
  RPC_ERROR: { category: "RPC", retryable: false },
  RPC_BROADCAST_CONFIRMATION_TIMEOUT: { category: "RPC", retryable: true },
  RPC_BROADCAST_SUBMISSION_FAILED: { category: "RPC", retryable: true },
  RPC_NETWORK_ERROR: { category: "RPC", retryable: true },
  RPC_RATE_LIMITED: { category: "RPC", retryable: true },
  RPC_POOL_RESOLUTION_FAILED: { category: "RPC", retryable: true },
  ASP_ERROR: { category: "ASP", retryable: false },
  RELAYER_ERROR: { category: "RELAYER", retryable: false },
  RELAYER_BROADCAST_QUOTE_EXPIRED: { category: "RELAYER", retryable: true },
  RELAYER_BROADCAST_RELAYER_HOST_MISMATCH: {
    category: "RELAYER",
    retryable: false,
  },
  RELAYER_BROADCAST_SUBMISSION_FAILED: {
    category: "RELAYER",
    retryable: true,
  },
  RELAYER_CONFIRMATION_RETRY_LIMIT: { category: "RELAYER", retryable: true },
  FLOW_RELAYER_MINIMUM_BLOCKED: { category: "RELAYER", retryable: false },
  PROOF_ERROR: { category: "PROOF", retryable: false },
  PROOF_GENERATION_FAILED: { category: "PROOF", retryable: false },
  PROOF_MERKLE_ERROR: { category: "PROOF", retryable: true },
  PROOF_MALFORMED: { category: "PROOF", retryable: false },
  PROOF_VERIFICATION_FAILED: { category: "PROOF", retryable: false },
  CONTRACT_NULLIFIER_ALREADY_SPENT: { category: "CONTRACT", retryable: false },
  CONTRACT_BROADCAST_REVERTED: { category: "CONTRACT", retryable: false },
  CONTRACT_ERROR: { category: "CONTRACT", retryable: false },
  CONTRACT_INCORRECT_ASP_ROOT: { category: "CONTRACT", retryable: true },
  CONTRACT_UNKNOWN_STATE_ROOT: { category: "CONTRACT", retryable: true },
  CONTRACT_SCOPE_MISMATCH: { category: "CONTRACT", retryable: true },
  CONTRACT_CONTEXT_MISMATCH: { category: "CONTRACT", retryable: false },
  CONTRACT_INVALID_PROOF: { category: "CONTRACT", retryable: false },
  CONTRACT_INVALID_PROCESSOOOR: { category: "CONTRACT", retryable: false },
  CONTRACT_INVALID_COMMITMENT: { category: "CONTRACT", retryable: false },
  CONTRACT_PRECOMMITMENT_ALREADY_USED: {
    category: "CONTRACT",
    retryable: false,
  },
  CONTRACT_ONLY_ORIGINAL_DEPOSITOR: {
    category: "CONTRACT",
    retryable: false,
  },
  CONTRACT_NOT_YET_RAGEQUITTEABLE: {
    category: "CONTRACT",
    retryable: true,
  },
  CONTRACT_MAX_TREE_DEPTH_REACHED: { category: "CONTRACT", retryable: false },
  CONTRACT_NO_ROOTS_AVAILABLE: { category: "CONTRACT", retryable: true },
  CONTRACT_MINIMUM_DEPOSIT_AMOUNT: {
    category: "CONTRACT",
    retryable: false,
  },
  CONTRACT_INVALID_DEPOSIT_VALUE: { category: "CONTRACT", retryable: false },
  CONTRACT_INVALID_WITHDRAWAL_AMOUNT: {
    category: "CONTRACT",
    retryable: false,
  },
  CONTRACT_POOL_NOT_FOUND: { category: "CONTRACT", retryable: false },
  CONTRACT_POOL_IS_DEAD: { category: "CONTRACT", retryable: false },
  CONTRACT_RELAY_FEE_GREATER_THAN_MAX: {
    category: "CONTRACT",
    retryable: true,
  },
  CONTRACT_INVALID_TREE_DEPTH: { category: "CONTRACT", retryable: false },
  CONTRACT_NATIVE_ASSET_TRANSFER_FAILED: {
    category: "CONTRACT",
    retryable: false,
  },
  CONTRACT_INSUFFICIENT_FUNDS: { category: "CONTRACT", retryable: false },
  CONTRACT_NONCE_ERROR: { category: "CONTRACT", retryable: true },
  ACCOUNT_MIGRATION_REQUIRED: { category: "INPUT", retryable: false },
  ACCOUNT_NOT_FOUND: { category: "INPUT", retryable: false },
  ACCOUNT_WEBSITE_RECOVERY_REQUIRED: {
    category: "INPUT",
    retryable: false,
  },
  ACCOUNT_MIGRATION_REVIEW_INCOMPLETE: {
    category: "ASP",
    retryable: true,
  },
  ACCOUNT_NOT_APPROVED: { category: "INPUT", retryable: false },
  LOCK_HELD: { category: "INPUT", retryable: true },
  UPGRADE_UNSUPPORTED_CONTEXT: { category: "INPUT", retryable: false },
  UPGRADE_CHECK_FAILED: { category: "UNKNOWN", retryable: true },
  UPGRADE_INSTALL_FAILED: { category: "UNKNOWN", retryable: true },
  UNKNOWN_ERROR: { category: "UNKNOWN", retryable: false },
} satisfies Record<string, ErrorCodeRegistryEntry>;

export type RegisteredErrorCode = keyof typeof ERROR_CODE_REGISTRY;

export const ERROR_DOCS_URL_BASE =
  "https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md";

export function errorDocAnchor(code: string): string {
  return code.trim().toLowerCase().replace(/_/g, "-");
}

export function errorDocUrl(code: string): string {
  return `${ERROR_DOCS_URL_BASE}#${errorDocAnchor(code)}`;
}
