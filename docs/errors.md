# Privacy Pools CLI Error Codes

This file is generated from `src/utils/error-code-registry.ts` plus error-code literals in `src/` and `native/shell/src/`. Each heading is a stable target for `error.docUrl` in JSON error envelopes.

| Code | Category | Retryable |
| --- | --- | --- |
| [`ACCOUNT_MIGRATION_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-migration-required) | INPUT | no |
| [`ACCOUNT_MIGRATION_REVIEW_INCOMPLETE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-migration-review-incomplete) | ASP | yes |
| [`ACCOUNT_NOT_APPROVED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-not-approved) | INPUT | no |
| [`ACCOUNT_NOT_FOUND`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-not-found) | INPUT | no |
| [`ACCOUNT_WEBSITE_RECOVERY_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-website-recovery-required) | INPUT | no |
| [`ASP_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#asp-error) | ASP | no |
| [`ASP_HOST`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#asp-host) | ASP | no |
| [`COMMAND_ALIAS_DEPRECATED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#command-alias-deprecated) | UNKNOWN | no |
| [`CONTRACT_BROADCAST_REVERTED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-broadcast-reverted) | CONTRACT | no |
| [`CONTRACT_CONTEXT_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-context-mismatch) | CONTRACT | no |
| [`CONTRACT_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-error) | CONTRACT | no |
| [`CONTRACT_INCORRECT_ASP_ROOT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-incorrect-asp-root) | CONTRACT | yes |
| [`CONTRACT_INSUFFICIENT_FUNDS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-insufficient-funds) | CONTRACT | no |
| [`CONTRACT_INVALID_COMMITMENT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-commitment) | CONTRACT | no |
| [`CONTRACT_INVALID_DEPOSIT_VALUE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-deposit-value) | CONTRACT | no |
| [`CONTRACT_INVALID_PROCESSOOOR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-processooor) | CONTRACT | no |
| [`CONTRACT_INVALID_PROOF`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-proof) | CONTRACT | no |
| [`CONTRACT_INVALID_TREE_DEPTH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-tree-depth) | CONTRACT | no |
| [`CONTRACT_INVALID_WITHDRAWAL_AMOUNT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-withdrawal-amount) | CONTRACT | no |
| [`CONTRACT_MAX_TREE_DEPTH_REACHED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-max-tree-depth-reached) | CONTRACT | no |
| [`CONTRACT_MINIMUM_DEPOSIT_AMOUNT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-minimum-deposit-amount) | CONTRACT | no |
| [`CONTRACT_NATIVE_ASSET_TRANSFER_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-native-asset-transfer-failed) | CONTRACT | no |
| [`CONTRACT_NO_ROOTS_AVAILABLE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-no-roots-available) | CONTRACT | yes |
| [`CONTRACT_NONCE_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-nonce-error) | CONTRACT | yes |
| [`CONTRACT_NOT_YET_RAGEQUITTEABLE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-not-yet-ragequitteable) | CONTRACT | yes |
| [`CONTRACT_NULLIFIER_ALREADY_SPENT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-nullifier-already-spent) | CONTRACT | no |
| [`CONTRACT_ONLY_ORIGINAL_DEPOSITOR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-only-original-depositor) | CONTRACT | no |
| [`CONTRACT_POOL_IS_DEAD`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-pool-is-dead) | CONTRACT | no |
| [`CONTRACT_POOL_NOT_FOUND`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-pool-not-found) | CONTRACT | no |
| [`CONTRACT_PRECOMMITMENT_ALREADY_USED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-precommitment-already-used) | CONTRACT | no |
| [`CONTRACT_RELAY_FEE_GREATER_THAN_MAX`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-relay-fee-greater-than-max) | CONTRACT | yes |
| [`CONTRACT_SCOPE_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-scope-mismatch) | CONTRACT | yes |
| [`CONTRACT_UNKNOWN_STATE_ROOT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-unknown-state-root) | CONTRACT | yes |
| [`INPUT_ADDRESS_CHECKSUM_INVALID`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-address-checksum-invalid) | INPUT | no |
| [`INPUT_AGENT_ACCOUNTS_WATCH_UNSUPPORTED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-agent-accounts-watch-unsupported) | INPUT | no |
| [`INPUT_AGENT_FLOW_WATCH_UNSUPPORTED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-agent-flow-watch-unsupported) | INPUT | no |
| [`INPUT_APPROVAL_REQUIRED_NO_WAIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-approval-required-no-wait) | INPUT | no |
| [`INPUT_APPROVED_POOL_ACCOUNT_RAGEQUIT_REQUIRES_OVERRIDE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-approved-pool-account-ragequit-requires-override) | INPUT | no |
| [`INPUT_APPROVED_WORKFLOW_RAGEQUIT_REQUIRES_OVERRIDE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-approved-workflow-ragequit-requires-override) | INPUT | no |
| [`INPUT_BAD_ADDRESS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-bad-address) | INPUT | no |
| [`INPUT_BELOW_MINIMUM_DEPOSIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-below-minimum-deposit) | INPUT | no |
| [`INPUT_BROADCAST_CHAIN_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-chain-mismatch) | INPUT | no |
| [`INPUT_BROADCAST_CHAIN_OVERRIDE_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-chain-override-mismatch) | INPUT | no |
| [`INPUT_BROADCAST_EMPTY_STDIN`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-empty-stdin) | INPUT | no |
| [`INPUT_BROADCAST_INLINE_JSON_UNSUPPORTED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-inline-json-unsupported) | INPUT | no |
| [`INPUT_BROADCAST_INPUT_NOT_FOUND`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-input-not-found) | INPUT | no |
| [`INPUT_BROADCAST_INPUT_UNREADABLE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-input-unreadable) | INPUT | no |
| [`INPUT_BROADCAST_INVALID_ENVELOPE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-invalid-envelope) | INPUT | no |
| [`INPUT_BROADCAST_INVALID_JSON`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-invalid-json) | INPUT | no |
| [`INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-invalid-signed-transaction) | INPUT | no |
| [`INPUT_BROADCAST_MISSING_RELAYER_HOST`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-missing-relayer-host) | INPUT | no |
| [`INPUT_BROADCAST_MISSING_SIGNED_TRANSACTIONS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-missing-signed-transactions) | INPUT | no |
| [`INPUT_BROADCAST_MIXED_SIGNERS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-mixed-signers) | INPUT | no |
| [`INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-relayer-request-mismatch) | INPUT | no |
| [`INPUT_BROADCAST_REQUIRES_ENVELOPE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-requires-envelope) | INPUT | no |
| [`INPUT_BROADCAST_SIGNED_TRANSACTION_COUNT_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-signed-transaction-count-mismatch) | INPUT | no |
| [`INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-signed-transaction-mismatch) | INPUT | no |
| [`INPUT_BROADCAST_SIGNER_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-signer-mismatch) | INPUT | no |
| [`INPUT_BROADCAST_STDIN_READ_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-stdin-read-failed) | INPUT | no |
| [`INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-direct-withdraw-recipient-mismatch) | INPUT | no |
| [`INPUT_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-error) | INPUT | no |
| [`INPUT_FLAG_CONFLICT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-flag-conflict) | INPUT | no |
| [`INPUT_FLOW_RECIPIENT_RETRY_LIMIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-flow-recipient-retry-limit) | INPUT | no |
| [`INPUT_INIT_GENERATE_REQUIRES_CAPTURE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-init-generate-requires-capture) | INPUT | no |
| [`INPUT_INIT_RECOVERY_PHRASE_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-init-recovery-phrase-required) | INPUT | no |
| [`INPUT_INIT_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-init-required) | INPUT | no |
| [`INPUT_INSUFFICIENT_BALANCE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-insufficient-balance) | INPUT | no |
| [`INPUT_INSUFFICIENT_GAS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-insufficient-gas) | INPUT | no |
| [`INPUT_INVALID_AMOUNT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-amount) | INPUT | no |
| [`INPUT_INVALID_ASSET`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-asset) | INPUT | no |
| [`INPUT_INVALID_JQ`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-jq) | INPUT | no |
| [`INPUT_INVALID_VALUE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-value) | INPUT | no |
| [`INPUT_JSON_FIELDS_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-json-fields-required) | INPUT | no |
| [`INPUT_MISSING_AMOUNT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-amount) | INPUT | no |
| [`INPUT_MISSING_ARGUMENT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-argument) | INPUT | no |
| [`INPUT_MISSING_ASSET`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-asset) | INPUT | no |
| [`INPUT_MISSING_FLOW_SUBCOMMAND`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-flow-subcommand) | INPUT | no |
| [`INPUT_MISSING_RECIPIENT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-recipient) | INPUT | no |
| [`INPUT_MUTUALLY_EXCLUSIVE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-mutually-exclusive) | INPUT | no |
| [`INPUT_NO_GAS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-no-gas) | INPUT | no |
| [`INPUT_NONROUND_AMOUNT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-nonround-amount) | INPUT | no |
| [`INPUT_PARSE_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-parse-error) | INPUT | no |
| [`INPUT_RAGEQUIT_CONFIRMATION_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-ragequit-confirmation-required) | INPUT | no |
| [`INPUT_RECIPIENT_BURN_ADDRESS`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recipient-burn-address) | INPUT | no |
| [`INPUT_RECIPIENT_RETRY_LIMIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recipient-retry-limit) | INPUT | no |
| [`INPUT_RECOVERY_PHRASE_RETRY_LIMIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recovery-phrase-retry-limit) | INPUT | no |
| [`INPUT_RECOVERY_VERIFICATION_RETRY_LIMIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recovery-verification-retry-limit) | INPUT | no |
| [`INPUT_REMAINDER_BELOW_RELAYER_MINIMUM`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-remainder-below-relayer-minimum) | INPUT | no |
| [`INPUT_SIMULATE_UNSIGNED_UNSUPPORTED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-simulate-unsigned-unsupported) | INPUT | no |
| [`INPUT_UNKNOWN_ASSET`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-asset) | INPUT | no |
| [`INPUT_UNKNOWN_CHAIN`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-chain) | INPUT | no |
| [`INPUT_UNKNOWN_COMMAND`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-command) | INPUT | no |
| [`INPUT_UNKNOWN_JSON_FIELD`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-json-field) | INPUT | no |
| [`INPUT_UNKNOWN_OPTION`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-option) | INPUT | no |
| [`INPUT_UNKNOWN_SUBMISSION`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-submission) | INPUT | no |
| [`PROMPT_CANCELLED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#prompt-cancelled) | CANCELLED | no |
| [`PROOF_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-error) | PROOF | no |
| [`PROOF_GENERATION_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-generation-failed) | PROOF | no |
| [`PROOF_MALFORMED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-malformed) | PROOF | no |
| [`PROOF_MERKLE_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-merkle-error) | PROOF | yes |
| [`PROOF_VERIFICATION_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-verification-failed) | PROOF | no |
| [`RELAYER_BROADCAST_QUOTE_EXPIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-broadcast-quote-expired) | RELAYER | yes |
| [`RELAYER_BROADCAST_RELAYER_HOST_MISMATCH`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-broadcast-relayer-host-mismatch) | RELAYER | no |
| [`RELAYER_BROADCAST_SUBMISSION_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-broadcast-submission-failed) | RELAYER | yes |
| [`RELAYER_CONFIRMATION_RETRY_LIMIT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-confirmation-retry-limit) | RELAYER | yes |
| [`RELAYER_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-error) | RELAYER | no |
| [`RELAYER_HOST`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-host) | RELAYER | no |
| [`RPC_BROADCAST_CONFIRMATION_TIMEOUT`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-broadcast-confirmation-timeout) | RPC | yes |
| [`RPC_BROADCAST_SUBMISSION_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-broadcast-submission-failed) | RPC | yes |
| [`RPC_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-error) | RPC | no |
| [`RPC_NETWORK_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-network-error) | RPC | yes |
| [`RPC_POOL_RESOLUTION_FAILED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-pool-resolution-failed) | RPC | yes |
| [`RPC_RATE_LIMITED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-rate-limited) | RPC | yes |
| [`SETUP_INVALID_RECOVERY_PHRASE`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-invalid-recovery-phrase) | SETUP | no |
| [`SETUP_INVALID_SIGNER_KEY`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-invalid-signer-key) | SETUP | no |
| [`SETUP_RECOVERY_PHRASE_MISSING`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-recovery-phrase-missing) | SETUP | no |
| [`SETUP_REQUIRED`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-required) | SETUP | no |
| [`SETUP_SIGNER_KEY_MISSING`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-signer-key-missing) | SETUP | no |
| [`UNKNOWN_ERROR`](https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#unknown-error) | UNKNOWN | no |

## ACCOUNT_MIGRATION_REQUIRED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-migration-required

## ACCOUNT_MIGRATION_REVIEW_INCOMPLETE

- Category: `ASP`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-migration-review-incomplete

## ACCOUNT_NOT_APPROVED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-not-approved

## ACCOUNT_NOT_FOUND

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-not-found

## ACCOUNT_WEBSITE_RECOVERY_REQUIRED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#account-website-recovery-required

## ASP_ERROR

- Category: `ASP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#asp-error

## ASP_HOST

- Category: `ASP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#asp-host

## COMMAND_ALIAS_DEPRECATED

- Category: `UNKNOWN`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#command-alias-deprecated

## CONTRACT_BROADCAST_REVERTED

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-broadcast-reverted

## CONTRACT_CONTEXT_MISMATCH

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-context-mismatch

## CONTRACT_ERROR

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-error
- Note: For ERC-20 deposit failures, `error.details.approvalTxHash` may be non-null. That indicates the approval transaction may have succeeded while the deposit failed; inspect the approval transaction, then reset allowance or retry the deposit.

## CONTRACT_INCORRECT_ASP_ROOT

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-incorrect-asp-root

## CONTRACT_INSUFFICIENT_FUNDS

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-insufficient-funds

## CONTRACT_INVALID_COMMITMENT

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-commitment

## CONTRACT_INVALID_DEPOSIT_VALUE

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-deposit-value

## CONTRACT_INVALID_PROCESSOOOR

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-processooor

## CONTRACT_INVALID_PROOF

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-proof

## CONTRACT_INVALID_TREE_DEPTH

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-tree-depth

## CONTRACT_INVALID_WITHDRAWAL_AMOUNT

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-invalid-withdrawal-amount

## CONTRACT_MAX_TREE_DEPTH_REACHED

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-max-tree-depth-reached

## CONTRACT_MINIMUM_DEPOSIT_AMOUNT

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-minimum-deposit-amount

## CONTRACT_NATIVE_ASSET_TRANSFER_FAILED

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-native-asset-transfer-failed

## CONTRACT_NO_ROOTS_AVAILABLE

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-no-roots-available

## CONTRACT_NONCE_ERROR

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-nonce-error

## CONTRACT_NOT_YET_RAGEQUITTEABLE

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-not-yet-ragequitteable

## CONTRACT_NULLIFIER_ALREADY_SPENT

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-nullifier-already-spent

## CONTRACT_ONLY_ORIGINAL_DEPOSITOR

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-only-original-depositor

## CONTRACT_POOL_IS_DEAD

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-pool-is-dead

## CONTRACT_POOL_NOT_FOUND

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-pool-not-found

## CONTRACT_PRECOMMITMENT_ALREADY_USED

- Category: `CONTRACT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-precommitment-already-used

## CONTRACT_RELAY_FEE_GREATER_THAN_MAX

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-relay-fee-greater-than-max

## CONTRACT_SCOPE_MISMATCH

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-scope-mismatch

## CONTRACT_UNKNOWN_STATE_ROOT

- Category: `CONTRACT`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#contract-unknown-state-root

## INPUT_ADDRESS_CHECKSUM_INVALID

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-address-checksum-invalid

## INPUT_AGENT_ACCOUNTS_WATCH_UNSUPPORTED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-agent-accounts-watch-unsupported

## INPUT_AGENT_FLOW_WATCH_UNSUPPORTED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-agent-flow-watch-unsupported

## INPUT_APPROVAL_REQUIRED_NO_WAIT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-approval-required-no-wait

## INPUT_APPROVED_POOL_ACCOUNT_RAGEQUIT_REQUIRES_OVERRIDE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-approved-pool-account-ragequit-requires-override

## INPUT_APPROVED_WORKFLOW_RAGEQUIT_REQUIRES_OVERRIDE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-approved-workflow-ragequit-requires-override

## INPUT_BAD_ADDRESS

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-bad-address

## INPUT_BELOW_MINIMUM_DEPOSIT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-below-minimum-deposit

## INPUT_BROADCAST_CHAIN_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-chain-mismatch

## INPUT_BROADCAST_CHAIN_OVERRIDE_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-chain-override-mismatch

## INPUT_BROADCAST_EMPTY_STDIN

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-empty-stdin

## INPUT_BROADCAST_INLINE_JSON_UNSUPPORTED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-inline-json-unsupported

## INPUT_BROADCAST_INPUT_NOT_FOUND

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-input-not-found

## INPUT_BROADCAST_INPUT_UNREADABLE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-input-unreadable

## INPUT_BROADCAST_INVALID_ENVELOPE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-invalid-envelope

## INPUT_BROADCAST_INVALID_JSON

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-invalid-json

## INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-invalid-signed-transaction

## INPUT_BROADCAST_MISSING_RELAYER_HOST

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-missing-relayer-host

## INPUT_BROADCAST_MISSING_SIGNED_TRANSACTIONS

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-missing-signed-transactions

## INPUT_BROADCAST_MIXED_SIGNERS

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-mixed-signers

## INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-relayer-request-mismatch

## INPUT_BROADCAST_REQUIRES_ENVELOPE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-requires-envelope

## INPUT_BROADCAST_SIGNED_TRANSACTION_COUNT_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-signed-transaction-count-mismatch

## INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-signed-transaction-mismatch

## INPUT_BROADCAST_SIGNER_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-signer-mismatch

## INPUT_BROADCAST_STDIN_READ_FAILED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-broadcast-stdin-read-failed

## INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-direct-withdraw-recipient-mismatch

## INPUT_ERROR

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-error

## INPUT_FLAG_CONFLICT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-flag-conflict

## INPUT_FLOW_RECIPIENT_RETRY_LIMIT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-flow-recipient-retry-limit

## INPUT_INIT_GENERATE_REQUIRES_CAPTURE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-init-generate-requires-capture

## INPUT_INIT_RECOVERY_PHRASE_REQUIRED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-init-recovery-phrase-required

## INPUT_INIT_REQUIRED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-init-required

## INPUT_INSUFFICIENT_BALANCE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-insufficient-balance

## INPUT_INSUFFICIENT_GAS

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-insufficient-gas

## INPUT_INVALID_AMOUNT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-amount

## INPUT_INVALID_ASSET

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-asset

## INPUT_INVALID_JQ

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-jq

## INPUT_INVALID_VALUE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-invalid-value

## INPUT_JSON_FIELDS_REQUIRED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-json-fields-required

## INPUT_MISSING_AMOUNT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-amount

## INPUT_MISSING_ARGUMENT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-argument

## INPUT_MISSING_ASSET

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-asset

## INPUT_MISSING_FLOW_SUBCOMMAND

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-flow-subcommand

## INPUT_MISSING_RECIPIENT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-missing-recipient

## INPUT_MUTUALLY_EXCLUSIVE

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-mutually-exclusive

## INPUT_NO_GAS

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-no-gas

## INPUT_NONROUND_AMOUNT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-nonround-amount

## INPUT_PARSE_ERROR

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-parse-error

## INPUT_RAGEQUIT_CONFIRMATION_REQUIRED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-ragequit-confirmation-required

## INPUT_RECIPIENT_BURN_ADDRESS

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recipient-burn-address

## INPUT_RECIPIENT_RETRY_LIMIT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recipient-retry-limit

## INPUT_RECOVERY_PHRASE_RETRY_LIMIT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recovery-phrase-retry-limit

## INPUT_RECOVERY_VERIFICATION_RETRY_LIMIT

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-recovery-verification-retry-limit

## INPUT_REMAINDER_BELOW_RELAYER_MINIMUM

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-remainder-below-relayer-minimum

## INPUT_SIMULATE_UNSIGNED_UNSUPPORTED

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-simulate-unsigned-unsupported

## INPUT_UNKNOWN_ASSET

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-asset

## INPUT_UNKNOWN_CHAIN

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-chain

## INPUT_UNKNOWN_COMMAND

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-command

## INPUT_UNKNOWN_JSON_FIELD

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-json-field

## INPUT_UNKNOWN_OPTION

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-option

## INPUT_UNKNOWN_SUBMISSION

- Category: `INPUT`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#input-unknown-submission

## PROMPT_CANCELLED

- Category: `CANCELLED`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#prompt-cancelled

## PROOF_ERROR

- Category: `PROOF`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-error

## PROOF_GENERATION_FAILED

- Category: `PROOF`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-generation-failed

## PROOF_MALFORMED

- Category: `PROOF`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-malformed

## PROOF_MERKLE_ERROR

- Category: `PROOF`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-merkle-error

## PROOF_VERIFICATION_FAILED

- Category: `PROOF`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#proof-verification-failed

## RELAYER_BROADCAST_QUOTE_EXPIRED

- Category: `RELAYER`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-broadcast-quote-expired

## RELAYER_BROADCAST_RELAYER_HOST_MISMATCH

- Category: `RELAYER`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-broadcast-relayer-host-mismatch

## RELAYER_BROADCAST_SUBMISSION_FAILED

- Category: `RELAYER`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-broadcast-submission-failed

## RELAYER_CONFIRMATION_RETRY_LIMIT

- Category: `RELAYER`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-confirmation-retry-limit

## RELAYER_ERROR

- Category: `RELAYER`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-error

## RELAYER_HOST

- Category: `RELAYER`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#relayer-host

## RPC_BROADCAST_CONFIRMATION_TIMEOUT

- Category: `RPC`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-broadcast-confirmation-timeout

## RPC_BROADCAST_SUBMISSION_FAILED

- Category: `RPC`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-broadcast-submission-failed

## RPC_ERROR

- Category: `RPC`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-error

## RPC_NETWORK_ERROR

- Category: `RPC`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-network-error

## RPC_POOL_RESOLUTION_FAILED

- Category: `RPC`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-pool-resolution-failed

## RPC_RATE_LIMITED

- Category: `RPC`
- Retryable: `true`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#rpc-rate-limited

## SETUP_INVALID_RECOVERY_PHRASE

- Category: `SETUP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-invalid-recovery-phrase

## SETUP_INVALID_SIGNER_KEY

- Category: `SETUP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-invalid-signer-key

## SETUP_RECOVERY_PHRASE_MISSING

- Category: `SETUP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-recovery-phrase-missing

## SETUP_REQUIRED

- Category: `SETUP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-required

## SETUP_SIGNER_KEY_MISSING

- Category: `SETUP`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#setup-signer-key-missing

## UNKNOWN_ERROR

- Category: `UNKNOWN`
- Retryable: `false`
- Stable URL: https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#unknown-error
