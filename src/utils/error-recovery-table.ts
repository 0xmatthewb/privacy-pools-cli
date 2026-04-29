import { POA_PORTAL_URL } from "../config/chains.js";
import type {
  NextAction,
  NextActionOptionValue,
  NextActionParameter,
  NextActionWhen,
} from "../types.js";
import {
  ERROR_CODE_REGISTRY,
  type RegisteredErrorCode,
} from "./error-code-registry.js";

export type ErrorRecoveryClassification =
  | "actionable"
  | "retry-only"
  | "terminal-input";

export interface ErrorRetryPolicy {
  strategy: "exponential-backoff" | "fixed-backoff" | "manual-retry";
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  note?: string;
}

export interface SerializedErrorRecoveryEntry {
  classification: ErrorRecoveryClassification;
  symptom: string;
  firstTry: string;
  fallback?: string;
  retry?: ErrorRetryPolicy;
  nextActions?: NextAction[];
}

interface ErrorRecoveryContext extends Record<string, unknown> {}

interface ErrorRecoveryEntryBase {
  classification: ErrorRecoveryClassification;
  symptom: string;
  firstTry: string;
  fallback?: string;
}

interface ActionableErrorRecoveryEntry extends ErrorRecoveryEntryBase {
  classification: "actionable";
  buildNextActions: (context: ErrorRecoveryContext) => NextAction[];
}

interface RetryOnlyErrorRecoveryEntry extends ErrorRecoveryEntryBase {
  classification: "retry-only";
  retry: ErrorRetryPolicy;
}

interface TerminalInputErrorRecoveryEntry extends ErrorRecoveryEntryBase {
  classification: "terminal-input";
  terminal: true;
}

export type ErrorRecoveryEntry =
  | ActionableErrorRecoveryEntry
  | RetryOnlyErrorRecoveryEntry
  | TerminalInputErrorRecoveryEntry;

type ActionConfig = {
  args?: string[];
  options?: Record<string, NextActionOptionValue | undefined>;
  parameters?: NextActionParameter[];
  runnable?: boolean;
};

function camelToKebab(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function hasPlaceholder(value: unknown): boolean {
  return typeof value === "string" && /^<[^>]+>$/.test(value);
}

function buildCliCommand(action: NextAction, includeAgent: boolean): string {
  const parts = ["privacy-pools", action.command];
  if (action.args) {
    parts.push(...action.args);
  }
  if (includeAgent || action.options?.agent === true) {
    parts.push("--agent");
  }
  if (action.options) {
    for (const [key, value] of Object.entries(action.options)) {
      if (key === "agent" || value === undefined || value === null) continue;
      const flag = camelToKebab(key);
      if (typeof value === "boolean") {
        parts.push(value ? `--${flag}` : `--no-${flag}`);
      } else {
        parts.push(`--${flag}`, String(value));
      }
    }
  }
  return parts.join(" ");
}

function recoveryNextAction(
  command: string,
  reason: string,
  when: NextActionWhen,
  config: ActionConfig = {},
): NextAction {
  const options = config.options
    ? Object.fromEntries(
        Object.entries(config.options).filter(
          ([key, value]) =>
            key !== "agent" &&
            value !== undefined &&
            value !== null,
        ),
      ) as Record<string, NextActionOptionValue>
    : undefined;
  const action: NextAction = {
    command,
    reason,
    when,
    ...(config.args && config.args.length > 0 ? { args: config.args } : {}),
    ...(options && Object.keys(options).length > 0 ? { options } : {}),
    ...(config.parameters && config.parameters.length > 0
      ? { parameters: config.parameters }
      : {}),
    ...(config.runnable === false ? { runnable: false } : {}),
  };
  const runnable =
    config.runnable === false ||
    action.args?.some(hasPlaceholder) ||
    Object.values(action.options ?? {}).some(hasPlaceholder)
      ? false
      : true;
  if (!runnable) {
    return { ...action, runnable: false };
  }
  return {
    ...action,
    cliCommand: buildCliCommand(
      {
        ...action,
        options: {
          ...(action.options ?? {}),
          ...(config.options?.agent === true ? { agent: true } : {}),
        },
      },
      config.options?.agent === true,
    ),
  };
}

function stringValue(
  context: ErrorRecoveryContext,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = context[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "bigint") {
      return value.toString();
    }
  }
  return fallback;
}

function optionalString(
  context: ErrorRecoveryContext,
  keys: string[],
): string | undefined {
  const value = stringValue(context, keys, "");
  return value.length > 0 ? value : undefined;
}

function chainOption(context: ErrorRecoveryContext): Record<string, string> {
  const chain = optionalString(context, ["chain", "chainName", "selectedChain"]);
  return chain ? { chain } : {};
}

function quoteNextAction(context: ErrorRecoveryContext): NextAction[] {
  const amount = stringValue(
    context,
    ["amountInput", "amount", "withdrawAmount", "suggestedRoundAmount"],
    "<amount>",
  );
  const asset = stringValue(
    context,
    ["assetInput", "asset", "assetSymbol"],
    "<asset>",
  );
  const recipient = stringValue(
    context,
    ["recipient", "recipientAddress", "to"],
    "<addr>",
  );
  return [
    recoveryNextAction(
      "withdraw quote",
      "Request a fresh relayer quote before retrying the withdrawal.",
      "after_quote",
      {
        args: [amount, asset],
        options: { agent: true, ...chainOption(context), to: recipient },
        parameters: [
          { name: "amount", type: "token_amount", required: true },
          { name: "asset", type: "asset", required: true },
          { name: "to", type: "address", required: true },
        ],
      },
    ),
  ];
}

function syncNextAction(context: ErrorRecoveryContext): NextAction[] {
  return [
    recoveryNextAction(
      "sync",
      "Refresh local pool state and roots, then retry the original command.",
      "after_sync",
      { options: { agent: true, ...chainOption(context) } },
    ),
  ];
}

function accountsNextAction(
  context: ErrorRecoveryContext,
  reason: string,
  pendingOnly = false,
): NextAction {
  return recoveryNextAction("accounts", reason, pendingOnly ? "has_pending" : "after_sync", {
    options: {
      agent: true,
      ...chainOption(context),
      ...(pendingOnly ? { pendingOnly: true } : {}),
    },
  });
}

function txStatusNextAction(context: ErrorRecoveryContext): NextAction[] {
  const submissionId = stringValue(context, ["submissionId"], "<submissionId>");
  return [
    recoveryNextAction(
      "tx-status",
      "Poll the accepted submission instead of rebroadcasting.",
      "after_submit",
      {
        args: [submissionId],
        options: { agent: true },
        parameters: [{ name: "submissionId", type: "uuid", required: true }],
      },
    ),
  ];
}

function migrateStatusNextAction(): NextAction[] {
  return [
    recoveryNextAction(
      "migrate status",
      "Check legacy account migration or recovery readiness before retrying.",
      "accounts_restore_check",
      { options: { agent: true, includeTestnets: true } },
    ),
  ];
}

function initNextAction(): NextAction[] {
  return [
    recoveryNextAction(
      "init",
      "Complete CLI setup before retrying wallet-dependent commands.",
      "status_not_ready",
      { options: { agent: true } },
    ),
  ];
}

function flowStartTemplate(): NextAction[] {
  return [
    recoveryNextAction(
      "flow start",
      "Create a saved workflow before requesting workflow status.",
      "flow_manual_followup",
      {
        options: { agent: true },
        runnable: false,
        parameters: [
          { name: "amount", type: "token_amount", required: true },
          { name: "asset", type: "asset", required: true },
          { name: "to", type: "address", required: true },
        ],
      },
    ),
  ];
}

function nonRoundAmountNextActions(context: ErrorRecoveryContext): NextAction[] {
  const command = stringValue(context, ["command", "sourceCommand"], "deposit");
  const asset = stringValue(context, ["asset", "assetSymbol", "assetInput"], "<asset>");
  const originalAmount = stringValue(
    context,
    ["amountInput", "originalAmountInput", "amount"],
    "<amount>",
  );
  const suggestedAmount = stringValue(
    context,
    ["suggestedRoundAmount", "roundAmount"],
    "<roundAmount>",
  );
  const recipient = optionalString(context, ["recipient", "recipientAddress", "to"]);
  const baseOptions = {
    agent: true,
    ...chainOption(context),
    ...(recipient ? { to: recipient } : {}),
  };
  const parameters = [
    { name: "amount", type: "round_token_amount", required: true },
    { name: "asset", type: "asset", required: true },
    ...(command === "flow start"
      ? [{ name: "to", type: "address", required: true }]
      : []),
  ];
  const retryWithRoundAmount = recoveryNextAction(
    command,
    "Retry with the nearest lower round amount to reduce amount fingerprinting.",
    "flow_manual_followup",
    {
      args: [suggestedAmount, asset],
      options: baseOptions,
      parameters,
    },
  );
  const escape = recoveryNextAction(
    command,
    "Retry with the explicit non-round amount override only if the operator accepts the privacy tradeoff.",
    "flow_manual_followup",
    {
      args: [originalAmount, asset],
      options: { ...baseOptions, allowNonRoundAmounts: true },
      parameters,
    },
  );
  return [retryWithRoundAmount, escape];
}

function accountNotApprovedNextActions(context: ErrorRecoveryContext): NextAction[] {
  const status = optionalString(context, ["aspStatus", "status"]);
  const asset = stringValue(context, ["asset", "assetSymbol"], "<asset>");
  const poolAccount = stringValue(
    context,
    ["poolAccount", "poolAccountId"],
    "<PA-#>",
  );
  if (status === "pending") {
    return [
      accountsNextAction(
        context,
        "Poll pending ASP review until this Pool Account leaves the pending set.",
        true,
      ),
    ];
  }
  if (status === "declined") {
    return [
      recoveryNextAction(
        "ragequit",
        "Recover a declined Pool Account publicly to the original depositor.",
        "flow_public_recovery_required",
        {
          args: [asset],
          options: { agent: true, ...chainOption(context), poolAccount },
          parameters: [
            { name: "asset", type: "asset", required: true },
            { name: "poolAccount", type: "pool_account_id", required: true },
          ],
        },
      ),
    ];
  }
  if (status === "poa_required") {
    return [
      accountsNextAction(
        context,
        `Complete Proof of Association at ${POA_PORTAL_URL}, then re-check account approval status.`,
      ),
    ];
  }
  return [
    accountsNextAction(
      context,
      "Check current ASP review status before deciding whether to wait, complete PoA, or recover publicly.",
    ),
    recoveryNextAction(
      "ragequit",
      "If accounts shows the Pool Account was declined, recover it publicly.",
      "flow_public_recovery_optional",
      {
        args: [asset],
        options: { agent: true, ...chainOption(context), poolAccount },
        parameters: [
          { name: "asset", type: "asset", required: true },
          { name: "poolAccount", type: "pool_account_id", required: true },
        ],
      },
    ),
  ];
}

const ACTIONABLE_RECOVERY_ENTRIES = {
  INPUT_AGENT_ACCOUNTS_WATCH_UNSUPPORTED: {
    symptom: "accounts --watch was requested in agent mode",
    firstTry: "poll accounts --pending-only externally",
    buildNextActions: (context) => [
      accountsNextAction(
        context,
        "Take one machine-readable pending snapshot, then poll externally.",
        true,
      ),
    ],
  },
  INPUT_AGENT_FLOW_WATCH_UNSUPPORTED: {
    symptom: "flow watch was requested in agent mode",
    firstTry: "use flow status plus flow step",
    buildNextActions: () => [
      recoveryNextAction(
        "flow status",
        "Read the saved workflow snapshot without attaching a watcher.",
        "flow_resume",
        {
          args: ["latest"],
          options: { agent: true },
        },
      ),
      recoveryNextAction(
        "flow step",
        "Advance the saved workflow by one actionable step.",
        "flow_resume",
        {
          args: ["latest"],
          options: { agent: true },
        },
      ),
    ],
  },
  INPUT_APPROVAL_REQUIRED_NO_WAIT: {
    symptom: "ERC-20 approval is required before deposit submission",
    firstTry: "rerun deposit without --no-wait so approval can confirm",
    buildNextActions: (context) => [
      recoveryNextAction(
        "deposit",
        "Retry without --no-wait so the CLI can confirm token approval before submitting the deposit.",
        "flow_manual_followup",
        {
          args: [
            stringValue(context, ["amountInput", "amount"], "<amount>"),
            stringValue(context, ["asset", "assetSymbol"], "<asset>"),
          ],
          options: { agent: true, ...chainOption(context) },
          parameters: [
            { name: "amount", type: "token_amount", required: true },
            { name: "asset", type: "asset", required: true },
          ],
        },
      ),
    ],
  },
  INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH: {
    symptom: "direct withdrawal recipient differs from the signer",
    firstTry: "retry the default relayed withdrawal path",
    buildNextActions: quoteNextAction,
  },
  INPUT_INIT_REQUIRED: {
    symptom: "wallet-dependent command was run before setup completed",
    firstTry: "run init",
    buildNextActions: initNextAction,
  },
  INPUT_MISSING_FLOW_SUBCOMMAND: {
    symptom: "flow was called without a subcommand in machine mode",
    firstTry: "choose flow start, status, step, or ragequit",
    buildNextActions: flowStartTemplate,
  },
  INPUT_NONROUND_AMOUNT: {
    symptom: "amount may fingerprint this transaction",
    firstTry: "retry with the suggested round amount",
    fallback: "use --allow-non-round-amounts only when the privacy tradeoff is intentional",
    buildNextActions: nonRoundAmountNextActions,
  },
  INPUT_NO_SAVED_WORKFLOWS: {
    symptom: "latest workflow was requested but no workflow is saved locally",
    firstTry: "start a new saved flow",
    buildNextActions: flowStartTemplate,
  },
  INPUT_REMAINDER_BELOW_RELAYER_MINIMUM: {
    symptom: "withdrawal would leave dust below the relayer minimum",
    firstTry: "withdraw the full balance with --all",
    fallback: "recover the remainder publicly with ragequit if needed",
    buildNextActions: (context) => [
      recoveryNextAction(
        "withdraw",
        "Withdraw the full Pool Account balance to avoid leaving a relayer-blocked remainder.",
        "flow_manual_followup",
        {
          args: [stringValue(context, ["asset", "assetSymbol"], "<asset>")],
          options: {
            agent: true,
            ...chainOption(context),
            all: true,
            to: stringValue(context, ["recipient", "to"], "<addr>"),
            poolAccount: stringValue(context, ["poolAccountId", "poolAccount"], "<PA-#>"),
          },
          parameters: [
            { name: "asset", type: "asset", required: true },
            { name: "to", type: "address", required: true },
            { name: "poolAccount", type: "pool_account_id", required: true },
          ],
        },
      ),
    ],
  },
  INPUT_UNKNOWN_SUBMISSION: {
    symptom: "tx-status was called with an unknown submission id",
    firstTry: "rerun the original command with --no-wait and capture the returned submissionId",
    buildNextActions: () => [
      recoveryNextAction(
        "status",
        "Check local setup and pending submission state before retrying.",
        "status_ready_has_accounts",
        { options: { agent: true, aggregated: true } },
      ),
    ],
  },
  INPUT_WORKFLOW_NOT_FOUND: {
    symptom: "requested workflow id is not saved locally",
    firstTry: "inspect the latest saved workflow",
    fallback: "start a new flow if no saved workflow exists",
    buildNextActions: () => [
      recoveryNextAction(
        "flow status",
        "Inspect the most recent saved workflow.",
        "flow_resume",
        { args: ["latest"], options: { agent: true } },
      ),
    ],
  },
  SETUP_REQUIRED: {
    symptom: "CLI wallet setup is incomplete",
    firstTry: "run init",
    buildNextActions: initNextAction,
  },
  SETUP_RECOVERY_PHRASE_MISSING: {
    symptom: "no recovery phrase is configured",
    firstTry: "run init",
    buildNextActions: initNextAction,
  },
  SETUP_SIGNER_KEY_MISSING: {
    symptom: "no signer key is configured",
    firstTry: "run init --signer-only or set PRIVACY_POOLS_PRIVATE_KEY",
    buildNextActions: () => [
      recoveryNextAction(
        "init",
        "Finish signer setup before retrying commands that submit transactions.",
        "status_not_ready",
        { options: { agent: true, signerOnly: true } },
      ),
    ],
  },
  RPC_BROADCAST_CONFIRMATION_TIMEOUT: {
    symptom: "broadcast accepted a transaction but confirmation timed out",
    firstTry: "poll tx-status with the returned submission id",
    fallback: "inspect the submitted tx hash before retrying",
    buildNextActions: txStatusNextAction,
  },
  RELAYER_FEE_EXCEEDS_MAX: {
    symptom: "quoted relayer fee exceeds the allowed maximum",
    firstTry: "request a fresh quote",
    fallback: "wait for fees to normalize or choose another pool",
    buildNextActions: quoteNextAction,
  },
  RELAYER_BROADCAST_QUOTE_EXPIRED: {
    symptom: "relayed broadcast quote expired",
    firstTry: "request a fresh quote and regenerate the envelope",
    buildNextActions: quoteNextAction,
  },
  FLOW_RELAYER_MINIMUM_BLOCKED: {
    symptom: "saved flow cannot use the relayer minimum-safe private path",
    firstTry: "use saved-flow public recovery",
    buildNextActions: (context) => [
      recoveryNextAction(
        "flow ragequit",
        "Recover the saved workflow publicly because relayed private withdrawal is blocked.",
        "flow_public_recovery_required",
        {
          args: [stringValue(context, ["workflowId"], "latest")],
          options: { agent: true },
        },
      ),
    ],
  },
  PROOF_GENERATION_FAILED: {
    symptom: "proof generation failed with local inputs",
    firstTry: "sync local state and retry",
    fallback: "verify the recovery phrase and account state",
    buildNextActions: syncNextAction,
  },
  PROOF_MERKLE_ERROR: {
    symptom: "Pool Account was not found in local Merkle data",
    firstTry: "sync local state and retry",
    buildNextActions: syncNextAction,
  },
  PROOF_VERIFICATION_FAILED: {
    symptom: "generated proof failed verification",
    firstTry: "sync local state and retry",
    fallback: "reinstall or upgrade to refresh circuit artifacts",
    buildNextActions: syncNextAction,
  },
  CONTRACT_NULLIFIER_ALREADY_SPENT: {
    symptom: "selected Pool Account was already spent",
    firstTry: "reconcile account state",
    buildNextActions: (context) => [
      accountsNextAction(
        context,
        "Refresh and reconcile Pool Account state before choosing another account.",
      ),
    ],
  },
  CONTRACT_INCORRECT_ASP_ROOT: {
    symptom: "ASP root changed since proof generation",
    firstTry: "sync and retry the original command",
    buildNextActions: syncNextAction,
  },
  CONTRACT_UNKNOWN_STATE_ROOT: {
    symptom: "state root is stale or unknown",
    firstTry: "sync and retry the original command",
    buildNextActions: syncNextAction,
  },
  CONTRACT_SCOPE_MISMATCH: {
    symptom: "proof scope does not match the current pool state",
    firstTry: "sync and retry the original command",
    buildNextActions: syncNextAction,
  },
  CONTRACT_INVALID_PROOF: {
    symptom: "onchain proof verification failed",
    firstTry: "sync and regenerate the proof",
    buildNextActions: syncNextAction,
  },
  CONTRACT_INVALID_PROCESSOOOR: {
    symptom: "withdrawal mode did not match the proof context",
    firstTry: "request a fresh quote and retry the default relayed path",
    fallback: "sync if the mismatch persists",
    buildNextActions: quoteNextAction,
  },
  CONTRACT_INVALID_COMMITMENT: {
    symptom: "selected commitment is no longer in local pool state",
    firstTry: "sync account state and retry",
    buildNextActions: syncNextAction,
  },
  CONTRACT_RELAY_FEE_GREATER_THAN_MAX: {
    symptom: "onchain relay fee exceeds the pool maximum",
    firstTry: "request a fresh quote",
    fallback: "wait for fees to normalize",
    buildNextActions: quoteNextAction,
  },
  ACCOUNT_MIGRATION_REQUIRED: {
    symptom: "legacy pre-upgrade account needs migration review",
    firstTry: "run migrate status across supported chains",
    buildNextActions: migrateStatusNextAction,
  },
  ACCOUNT_WEBSITE_RECOVERY_REQUIRED: {
    symptom: "legacy account needs website-based recovery",
    firstTry: "run migrate status to confirm readiness and affected chains",
    fallback: "complete website recovery before restoring in the CLI",
    buildNextActions: migrateStatusNextAction,
  },
  ACCOUNT_MIGRATION_REVIEW_INCOMPLETE: {
    symptom: "legacy ASP review data is incomplete",
    firstTry: "retry when ASP connectivity is healthy",
    fallback: "run migrate status before acting on the account",
    buildNextActions: migrateStatusNextAction,
  },
  ACCOUNT_NOT_APPROVED: {
    symptom: "selected Pool Account is not approved for private withdrawal",
    firstTry: "check accounts to branch on aspStatus",
    fallback: "pending: poll; declined: ragequit; poa_required: complete PoA",
    buildNextActions: accountNotApprovedNextActions,
  },
} satisfies Partial<
  Record<
    RegisteredErrorCode,
    Omit<ActionableErrorRecoveryEntry, "classification">
  >
>;

const ACTIONABLE_RECOVERY_ENTRY_MAP: Partial<
  Record<
    RegisteredErrorCode,
    Omit<ActionableErrorRecoveryEntry, "classification">
  >
> = ACTIONABLE_RECOVERY_ENTRIES;

const RETRY_ONLY_CODES = [
  "RPC_BROADCAST_SUBMISSION_FAILED",
  "RPC_NETWORK_ERROR",
  "RPC_RATE_LIMITED",
  "RPC_POOL_RESOLUTION_FAILED",
  "RELAYER_BROADCAST_SUBMISSION_FAILED",
  "RELAYER_CONFIRMATION_RETRY_LIMIT",
  "CONTRACT_NOT_YET_RAGEQUITTEABLE",
  "CONTRACT_NO_ROOTS_AVAILABLE",
  "CONTRACT_NONCE_ERROR",
  "LOCK_HELD",
  "UPGRADE_CHECK_FAILED",
  "UPGRADE_INSTALL_FAILED",
] satisfies RegisteredErrorCode[];

const RETRY_POLICIES: Partial<Record<RegisteredErrorCode, ErrorRetryPolicy>> = {
  LOCK_HELD: {
    strategy: "fixed-backoff",
    maxAttempts: 5,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    note: "Retry after the active privacy-pools process releases the lock.",
  },
  CONTRACT_NO_ROOTS_AVAILABLE: {
    strategy: "fixed-backoff",
    maxAttempts: 5,
    initialDelayMs: 30_000,
    maxDelayMs: 60_000,
    note: "Retry after the relayer publishes pool roots.",
  },
  CONTRACT_NOT_YET_RAGEQUITTEABLE: {
    strategy: "fixed-backoff",
    maxAttempts: 5,
    initialDelayMs: 30_000,
    maxDelayMs: 60_000,
    note: "Retry after the onchain ragequit delay has elapsed.",
  },
};

function defaultRetryPolicy(code: RegisteredErrorCode): ErrorRetryPolicy {
  return RETRY_POLICIES[code] ?? {
    strategy: "exponential-backoff",
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 8000,
  };
}

function terminalEntry(code: RegisteredErrorCode): TerminalInputErrorRecoveryEntry {
  return {
    classification: "terminal-input",
    terminal: true,
    symptom: `${code} requires corrected input or operator review`,
    firstTry: "fix the request using error.message, error.hint, and error.details, then rerun the command",
  };
}

function buildErrorRecoveryTable(): Record<RegisteredErrorCode, ErrorRecoveryEntry> {
  const actionableCodes = new Set(Object.keys(ACTIONABLE_RECOVERY_ENTRIES));
  const retryOnlyCodes = new Set<RegisteredErrorCode>(RETRY_ONLY_CODES);
  return Object.fromEntries(
    (Object.keys(ERROR_CODE_REGISTRY) as RegisteredErrorCode[]).map((code) => {
      const actionable = ACTIONABLE_RECOVERY_ENTRY_MAP[code];
      if (actionable) {
        return [
          code,
          {
            classification: "actionable",
            ...actionable,
          } satisfies ActionableErrorRecoveryEntry,
        ];
      }
      if (retryOnlyCodes.has(code)) {
        return [
          code,
          {
            classification: "retry-only",
            symptom: `${code} is retryable`,
            firstTry: "retry with backoff",
            retry: defaultRetryPolicy(code),
          } satisfies RetryOnlyErrorRecoveryEntry,
        ];
      }
      if (!actionableCodes.has(code)) {
        return [code, terminalEntry(code)];
      }
      return [code, terminalEntry(code)];
    }),
  ) as Record<RegisteredErrorCode, ErrorRecoveryEntry>;
}

export const ERROR_RECOVERY_TABLE = buildErrorRecoveryTable();

export function getErrorRecoveryEntry(
  code: string,
): ErrorRecoveryEntry | undefined {
  return ERROR_RECOVERY_TABLE[code as RegisteredErrorCode];
}

export function buildErrorRecoveryNextActions(
  code: string,
  context: ErrorRecoveryContext | undefined,
): NextAction[] | undefined {
  const entry = getErrorRecoveryEntry(code);
  if (!entry || entry.classification !== "actionable") {
    return undefined;
  }
  const actions = entry.buildNextActions(context ?? {});
  return actions.length > 0 ? actions : undefined;
}

export function serializeErrorRecoveryTable(
  context: ErrorRecoveryContext = {},
): Record<string, SerializedErrorRecoveryEntry> {
  return Object.fromEntries(
    Object.entries(ERROR_RECOVERY_TABLE).map(([code, entry]) => {
      if (entry.classification === "actionable") {
        const nextActions = entry.buildNextActions(context);
        return [
          code,
          {
            classification: entry.classification,
            symptom: entry.symptom,
            firstTry: entry.firstTry,
            ...(entry.fallback ? { fallback: entry.fallback } : {}),
            ...(nextActions.length > 0 ? { nextActions } : {}),
          },
        ];
      }
      if (entry.classification === "retry-only") {
        return [
          code,
          {
            classification: entry.classification,
            symptom: entry.symptom,
            firstTry: entry.firstTry,
            retry: entry.retry,
          },
        ];
      }
      return [
        code,
        {
          classification: entry.classification,
          symptom: entry.symptom,
          firstTry: entry.firstTry,
        },
      ];
    }),
  );
}
