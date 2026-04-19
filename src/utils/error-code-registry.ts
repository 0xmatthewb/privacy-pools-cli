import type { ErrorCategory } from "./errors.js";

export interface ErrorCodeRegistryEntry {
  category: ErrorCategory;
  retryable: boolean;
}

// This registry intentionally tracks the agent-docs conformance surface.
export const ERROR_CODE_REGISTRY = {
  INPUT_ERROR: { category: "INPUT", retryable: false },
  PROMPT_CANCELLED: { category: "INPUT", retryable: false },
  RPC_ERROR: { category: "RPC", retryable: false },
  RPC_NETWORK_ERROR: { category: "RPC", retryable: true },
  RPC_RATE_LIMITED: { category: "RPC", retryable: true },
  RPC_POOL_RESOLUTION_FAILED: { category: "RPC", retryable: true },
  ASP_ERROR: { category: "ASP", retryable: false },
  RELAYER_ERROR: { category: "RELAYER", retryable: false },
  PROOF_ERROR: { category: "PROOF", retryable: false },
  PROOF_GENERATION_FAILED: { category: "PROOF", retryable: false },
  PROOF_MERKLE_ERROR: { category: "PROOF", retryable: true },
  PROOF_MALFORMED: { category: "PROOF", retryable: false },
  PROOF_VERIFICATION_FAILED: { category: "PROOF", retryable: false },
  CONTRACT_NULLIFIER_ALREADY_SPENT: { category: "CONTRACT", retryable: false },
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
  ACCOUNT_WEBSITE_RECOVERY_REQUIRED: {
    category: "INPUT",
    retryable: false,
  },
  ACCOUNT_MIGRATION_REVIEW_INCOMPLETE: {
    category: "ASP",
    retryable: true,
  },
  ACCOUNT_NOT_APPROVED: { category: "INPUT", retryable: false },
  UNKNOWN_ERROR: { category: "UNKNOWN", retryable: false },
} satisfies Record<string, ErrorCodeRegistryEntry>;

export type RegisteredErrorCode = keyof typeof ERROR_CODE_REGISTRY;
