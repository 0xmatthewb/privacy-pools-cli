import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import {
  AccountService,
  DataService,
  type PoolAccount,
  type PoolInfo,
} from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import {
  getAccountsDir,
  ensureConfigDir,
  writePrivateFileAtomic,
} from "./config.js";
import {
  CLIError,
  accountMigrationRequiredError,
  accountMigrationReviewIncompleteError,
  accountWebsiteRecoveryRequiredError,
  sanitizeDiagnosticText,
} from "../utils/errors.js";
import {
  buildMigrationChainReadiness,
  buildMigrationChainReadinessFromLegacyAccount,
  collectLegacyMigrationCandidates,
  loadDeclinedLegacyLabels,
  type MigrationChainReadiness,
  type MigrationChainStatus,
} from "./migration.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../utils/critical-section.js";
import { warn, verbose as logVerbose } from "../utils/format.js";
import {
  withSuppressedConsole,
  withSuppressedConsoleSync,
} from "../utils/console-guard.js";
export {
  ACCOUNT_FILE_VERSION,
  accountExists,
  accountHasDeposits,
  deserialize,
  loadAccount,
  saveAccount,
  serialize,
} from "./account-storage.js";
import {
  ACCOUNT_FILE_VERSION,
  loadAccount,
  saveAccount,
} from "./account-storage.js";

/**
 * Cast raw pool data to SDK PoolInfo (handles branded Hash type for scope)
 */
export function toPoolInfo(pool: {
  chainId: number;
  address: Address;
  scope: bigint;
  deploymentBlock: bigint;
}): PoolInfo {
  return pool as unknown as PoolInfo;
}

/**
 * The SDK emits diagnostic logs directly through console methods.
 * Suppress them while we call into the SDK so retries and debug chatter
 * cannot leak into CLI output, especially in JSON/agent mode.
 */
// ── SDK console suppression ──────────────────────────────────────────────────
// The core SDK (@0xbow/privacy-pools-core-sdk) emits diagnostic messages via
// console.log/warn/error.  We suppress these in CLI output.
//
// Two layers:
//   1. `withSuppressedSdkStdout` — swap-and-restore guard around individual SDK
//      calls.  Handles the common case where SDK work completes synchronously
//      within the awaited promise.
//   2. `installConsoleGuard` — permanent no-op replacement of console methods.
//      Called once from the CLI entry point.  Catches deferred SDK callbacks
//      (e.g. `setTimeout`-based retries) that fire after the swap-and-restore
//      guard has already restored the originals.
//
// The CLI itself never uses console.* — all output goes through process.stderr.write
// and process.stdout.write — so the permanent guard is safe.

export async function withSuppressedSdkStdout<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return withSuppressedConsole(fn);
}

export function withSuppressedSdkStdoutSync<T>(fn: () => T): T {
  return withSuppressedConsoleSync(fn);
}

export function needsLegacyAccountRebuild(chainId: number): boolean {
  const savedAccount = loadAccount(chainId);
  return savedAccountNeedsLegacyRefresh(savedAccount);
}

export interface InitializeAccountServiceStateOptions {
  allowLegacyAccountRebuild?: boolean;
  forceSyncSavedAccount?: boolean;
  suppressWarnings?: boolean;
  strictSync?: boolean;
  allowLegacyRecoveryVisibility?: boolean;
}

export interface InitializeAccountServiceState {
  accountService: AccountService;
  /**
   * True when initialization already completed a full onchain refresh and
   * stamped sync freshness, so callers can skip an immediate second pass.
   */
  skipImmediateSync: boolean;
  rebuiltLegacyAccount: boolean;
  legacyDeclinedLabels?: ReadonlySet<string> | null;
}

type AccountState = AccountService["account"];
type AccountScope = Parameters<AccountState["poolAccounts"]["delete"]>[0];
const LEGACY_POOL_ACCOUNTS_FIELD = "__legacyPoolAccounts" as const;
const LEGACY_READINESS_STATUS_FIELD =
  "__legacyMigrationReadinessStatus" as const;
type StoredLegacyPoolAccounts = Map<AccountScope, PoolAccount[]>;
type StoredAccountState = AccountState & {
  __privacyPoolsCliAccountVersion?: number;
  [LEGACY_POOL_ACCOUNTS_FIELD]?: StoredLegacyPoolAccounts;
  [LEGACY_READINESS_STATUS_FIELD]?: MigrationChainStatus;
};

interface LegacyAccountSource {
  account?: { poolAccounts?: Map<unknown, unknown[]> };
}

interface LegacyReadinessResolution {
  readiness: MigrationChainReadiness;
  declinedLabels: ReadonlySet<string> | null;
}

function savedAccountNeedsLegacyRefresh(
  savedAccount: AccountState | null | undefined,
): boolean {
  const storedAccount = savedAccount as StoredAccountState | null | undefined;
  const storedLegacyPoolAccounts = getStoredLegacyPoolAccounts(storedAccount);
  const storedLegacyReadinessStatus =
    getStoredLegacyReadinessStatus(storedAccount);
  return (
    storedAccount !== null &&
    storedAccount !== undefined &&
    (
      storedAccount.__privacyPoolsCliAccountVersion !== ACCOUNT_FILE_VERSION ||
      storedLegacyPoolAccounts === undefined ||
      storedLegacyReadinessStatus === undefined
    )
  );
}

function clonePoolAccountsMap(
  poolAccounts: Map<AccountScope, PoolAccount[]> | null | undefined,
): StoredLegacyPoolAccounts | undefined {
  if (!(poolAccounts instanceof Map)) {
    return undefined;
  }

  return new Map(
    Array.from(poolAccounts.entries(), ([scope, accounts]) => [
      scope,
      Array.isArray(accounts)
        ? accounts.map((account) => ({
            ...account,
            deposit: { ...account.deposit },
            children: account.children.map((child) => ({ ...child })),
            ragequit: account.ragequit ? { ...account.ragequit } : account.ragequit,
          }))
        : [],
    ]),
  );
}

export function getStoredLegacyPoolAccounts(
  account: AccountState | null | undefined,
): StoredLegacyPoolAccounts | undefined {
  const stored = (account as StoredAccountState | null | undefined)?.[
    LEGACY_POOL_ACCOUNTS_FIELD
  ];
  return clonePoolAccountsMap(stored);
}

export function getStoredLegacyReadinessStatus(
  account: AccountState | null | undefined,
): MigrationChainStatus | undefined {
  const stored = (account as StoredAccountState | null | undefined)?.[
    LEGACY_READINESS_STATUS_FIELD
  ];
  return typeof stored === "string" ? stored : undefined;
}

function withStoredLegacyPoolAccounts(
  account: AccountState,
  legacyAccount?: LegacyAccountSource,
): StoredAccountState {
  const storedLegacyPoolAccounts =
    clonePoolAccountsMap(
      (legacyAccount?.account?.poolAccounts as Map<AccountScope, PoolAccount[]> | undefined)
        ?? getStoredLegacyPoolAccounts(account),
    ) ?? new Map<AccountScope, PoolAccount[]>();

  return {
    ...(account as StoredAccountState),
    [LEGACY_POOL_ACCOUNTS_FIELD]: storedLegacyPoolAccounts,
  };
}

function withStoredLegacyState(
  account: AccountState,
  legacyAccount?: LegacyAccountSource,
  readinessStatus?: MigrationChainStatus,
): StoredAccountState {
  const nextAccount = withStoredLegacyPoolAccounts(account, legacyAccount);
  if (readinessStatus === undefined) {
    delete nextAccount[LEGACY_READINESS_STATUS_FIELD];
    return nextAccount;
  }

  nextAccount[LEGACY_READINESS_STATUS_FIELD] = readinessStatus;
  return nextAccount;
}

function staleAccountRefreshRequiredError(): CLIError {
  return new CLIError(
    "Stored account state is outdated and must be refreshed before it can be used safely.",
    "INPUT",
    "Run 'privacy-pools sync' or rerun this command without --no-sync once RPC access is available.",
  );
}

function staleAccountRefreshFailedError(error: unknown): CLIError {
  return new CLIError(
    `Stored account state could not be refreshed safely: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
    "RPC",
    "Restore RPC access and rerun 'privacy-pools sync' before using this account.",
    undefined,
    true,
  );
}

function legacyReadinessError(status: MigrationChainStatus): CLIError | null {
  if (status === "no_legacy" || status === "fully_migrated") {
    return null;
  }

  if (status === "website_recovery_required") {
    return accountWebsiteRecoveryRequiredError(
      "Review this account in the Privacy Pools website first. Legacy declined deposits cannot be restored safely in the CLI and may require website-based public recovery instead of migration.",
    );
  }

  if (status === "review_incomplete") {
    return accountMigrationReviewIncompleteError(
      "Legacy ASP review data is temporarily unavailable. Retry this command or run 'privacy-pools migrate status' after ASP connectivity recovers before acting on this account.",
    );
  }

  return accountMigrationRequiredError();
}

async function resolveLegacyReadiness(
  legacyAccount: AccountService | LegacyAccountSource | undefined,
  chainId: number,
): Promise<LegacyReadinessResolution> {
  const candidates = collectLegacyMigrationCandidates(legacyAccount);
  if (candidates.length === 0) {
    return {
      readiness: await buildMigrationChainReadinessFromLegacyAccount(
        legacyAccount,
        chainId,
      ),
      declinedLabels: new Set<string>(),
    };
  }

  const declinedLabels = await loadDeclinedLegacyLabels(chainId, candidates);
  if (declinedLabels === null) {
    return {
      readiness: await buildMigrationChainReadinessFromLegacyAccount(
        legacyAccount,
        chainId,
      ),
      declinedLabels: null,
    };
  }

  return {
    readiness: buildMigrationChainReadiness(candidates, declinedLabels),
    declinedLabels,
  };
}

async function resolveLegacyInitializationPolicy(
  legacyAccount: AccountService | LegacyAccountSource | undefined,
  chainId: number,
  allowLegacyRecoveryVisibility: boolean,
): Promise<LegacyReadinessResolution> {
  const resolved = await resolveLegacyReadiness(legacyAccount, chainId);
  const blockingError = legacyReadinessError(resolved.readiness.status);

  if (!blockingError) {
    return resolved;
  }

  if (
    allowLegacyRecoveryVisibility
    // Mixed legacy wallets can need website recovery for declined deposits while
    // still requiring website migration for other commitments. Read-only account
    // views should keep those declined legacy deposits visible either way.
    && resolved.readiness.requiresWebsiteRecovery
  ) {
    return resolved;
  }

  throw blockingError;
}

function summarizeInitErrors(
  initErrors: Array<{ scope: bigint; reason: string }>,
): string {
  return initErrors
    .slice(0, 3)
    .map((e) => `scope ${e.scope.toString()}: ${sanitizeDiagnosticText(e.reason)}`)
    .join("; ");
}

function warnOnPartialInitialization(
  suppressWarnings: boolean,
  message: string,
): void {
  if (!suppressWarnings) {
    process.stderr.write(`Warning: ${message}\n`);
  }
}

function buildPartialInitializationState(
  accountService: AccountService,
  rebuiltLegacyAccount: boolean,
): InitializeAccountServiceState {
  accountService.account = withStoredLegacyPoolAccounts(accountService.account);
  return {
    accountService,
    skipImmediateSync: false,
    rebuiltLegacyAccount,
    legacyDeclinedLabels: null,
  };
}

function isLegacyRestoreBlockingError(error: unknown): boolean {
  return (
    error instanceof CLIError &&
    (error.code === "ACCOUNT_MIGRATION_REQUIRED" ||
      error.code === "ACCOUNT_WEBSITE_RECOVERY_REQUIRED" ||
      error.code === "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE")
  );
}

function mergeRebuiltScopes(
  currentAccount: AccountState,
  rebuiltAccount: AccountState,
  scopes: AccountScope[],
): AccountState {
  const poolAccounts = new Map(currentAccount.poolAccounts);
  for (const scope of scopes) {
    const rebuiltScopeAccounts = rebuiltAccount.poolAccounts.get(scope);
    if (Array.isArray(rebuiltScopeAccounts) && rebuiltScopeAccounts.length > 0) {
      poolAccounts.set(scope, rebuiltScopeAccounts);
      continue;
    }

    // Fail closed for event-sync gaps: once we have ever observed a Pool Account
    // for a scope, a later rebuild should not erase that scope entirely. Even a
    // fully spent or exited history remains durable account state.
    if (!poolAccounts.has(scope)) {
      poolAccounts.delete(scope);
    }
  }

  for (const [scope, accounts] of rebuiltAccount.poolAccounts.entries()) {
    if (scopes.includes(scope as AccountScope)) {
      continue;
    }
    poolAccounts.set(scope, accounts);
  }
  return {
    ...currentAccount,
    masterKeys: rebuiltAccount.masterKeys,
    creationTimestamp: rebuiltAccount.creationTimestamp,
    lastUpdateTimestamp: rebuiltAccount.lastUpdateTimestamp,
    poolAccounts,
  };
}

function preserveRegressedScopeEntries(
  currentAccount: AccountState,
  rebuiltAccount: AccountState,
  scopes: AccountScope[],
): {
  account: AccountState;
  preservedScopes: AccountScope[];
} {
  let nextPoolAccounts: Map<AccountScope, AccountState["poolAccounts"] extends Map<any, infer V> ? V : never> | null = null;
  const preservedScopes: AccountScope[] = [];

  for (const scope of scopes) {
    const currentEntries = currentAccount.poolAccounts.get(scope) ?? [];
    if (currentEntries.length === 0) continue;

    const rebuiltEntries = rebuiltAccount.poolAccounts.get(scope) ?? [];
    if (rebuiltEntries.length >= currentEntries.length) continue;

    if (!nextPoolAccounts) {
      nextPoolAccounts = new Map(rebuiltAccount.poolAccounts);
    }
    nextPoolAccounts.set(scope, currentEntries);
    preservedScopes.push(scope);
  }

  if (!nextPoolAccounts) {
    return {
      account: rebuiltAccount,
      preservedScopes,
    };
  }

  return {
    account: {
      ...rebuiltAccount,
      poolAccounts: nextPoolAccounts,
    },
    preservedScopes,
  };
}

function summarizeScopePreservations(scopes: AccountScope[]): string {
  return scopes
    .slice(0, 3)
    .map((scope) => `scope ${scope.toString()}`)
    .join("; ");
}

async function rebuildAccountScopesFromEvents(
  dataService: DataService,
  mnemonic: string,
  currentAccount: AccountState,
  pools: Array<{
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
  }>,
): Promise<{
  account: AccountState;
  legacyAccount?: AccountService;
  errors: Array<{ scope: bigint; reason: string }>;
}> {
  if (pools.length === 0) {
    return { account: currentAccount, legacyAccount: undefined, errors: [] };
  }

  const result = await withSuppressedSdkStdout(async () =>
    AccountService.initializeWithEvents(
      dataService,
      { mnemonic },
      pools.map(toPoolInfo),
    ),
  );

  return {
    account: mergeRebuiltScopes(
      currentAccount,
      result.account.account,
      pools.map((pool) => pool.scope as AccountScope),
    ),
    legacyAccount: result.legacyAccount,
    errors: result.errors ?? [],
  };
}

export async function initializeAccountServiceWithState(
  dataService: DataService,
  mnemonic: string,
  pools: Array<{
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
  }>,
  chainId: number,
  options: InitializeAccountServiceStateOptions = {},
): Promise<InitializeAccountServiceState> {
  const {
    allowLegacyAccountRebuild = false,
    forceSyncSavedAccount = false,
    suppressWarnings = false,
    strictSync = false,
    allowLegacyRecoveryVisibility = false,
  } = options;
  // Try to load existing account state
  const savedAccount = loadAccount(chainId);
  const needsSavedAccountRefresh =
    pools.length > 0 && savedAccountNeedsLegacyRefresh(savedAccount);

  if (needsSavedAccountRefresh) {
    if (!allowLegacyAccountRebuild) {
      throw staleAccountRefreshRequiredError();
    }

    try {
      const releaseLock = acquireProcessLock();
      try {
        const poolInfos = pools.map(toPoolInfo);
        const result = await withSuppressedSdkStdout(async () =>
          AccountService.initializeWithEvents(
            dataService,
            { mnemonic },
            poolInfos,
          ),
        );
        const {
          readiness,
          declinedLabels,
        } = await resolveLegacyInitializationPolicy(
          result.legacyAccount,
          chainId,
          allowLegacyRecoveryVisibility,
        );
        result.account.account = withStoredLegacyState(
          result.account.account,
          result.legacyAccount,
          readiness.status,
        );

        const initErrors = result.errors ?? [];
        if (initErrors.length > 0) {
          const details = summarizeInitErrors(initErrors);

          if (strictSync) {
            throw new CLIError(
              `Failed to rebuild legacy account state from onchain events for ${initErrors.length} pool(s). ${details}`,
              "RPC",
              "Check your RPC connectivity and retry.",
            );
          }

          warnOnPartialInitialization(
            suppressWarnings,
            `legacy account rebuild had partial failures for ${initErrors.length} pool(s): ${details}`,
          );

          return buildPartialInitializationState(result.account, true);
        }

        saveAccount(chainId, result.account.account);
        saveSyncMeta(chainId);
        return {
          accountService: result.account,
          skipImmediateSync: true,
          rebuiltLegacyAccount: true,
          legacyDeclinedLabels: declinedLabels,
        };
      } finally {
        releaseLock();
      }
    } catch (err) {
      if (isLegacyRestoreBlockingError(err)) {
        throw err;
      }
      if (strictSync) {
        throw new CLIError(
          `Failed to rebuild legacy account state from onchain events: ${sanitizeDiagnosticText(err instanceof Error ? err.message : String(err))}`,
          "RPC",
          "Check your RPC connectivity and retry.",
        );
      }
      if (!suppressWarnings) {
        process.stderr.write(
          `Warning: legacy account rebuild failed: ${sanitizeDiagnosticText(err instanceof Error ? err.message : String(err))}\n`,
        );
      }
      throw staleAccountRefreshFailedError(err);
    }
  }

  if (savedAccount) {
    const service = await withSuppressedSdkStdout(
      async () => new AccountService(dataService, { account: savedAccount }),
    );
    const storedLegacyReadinessStatus =
      getStoredLegacyReadinessStatus(savedAccount);
    const storedLegacyPoolAccounts = getStoredLegacyPoolAccounts(savedAccount);
    let legacyDeclinedLabels: ReadonlySet<string> | null = null;

    if (storedLegacyReadinessStatus && !forceSyncSavedAccount) {
      const blockingError = legacyReadinessError(storedLegacyReadinessStatus);
      if (blockingError && !allowLegacyRecoveryVisibility) {
        throw blockingError;
      }

      if (allowLegacyRecoveryVisibility) {
        const resolved = await resolveLegacyInitializationPolicy(
          storedLegacyPoolAccounts
            ? { account: { poolAccounts: storedLegacyPoolAccounts } }
            : undefined,
          chainId,
          true,
        );
        legacyDeclinedLabels = resolved.declinedLabels;
        service.account = withStoredLegacyState(
          service.account,
          storedLegacyPoolAccounts
            ? { account: { poolAccounts: storedLegacyPoolAccounts } }
            : undefined,
          storedLegacyReadinessStatus,
        );
      }
    }

    if (forceSyncSavedAccount && pools.length > 0) {
      const { account, legacyAccount, errors } = await rebuildAccountScopesFromEvents(
        dataService,
        mnemonic,
        service.account,
        pools,
      );
      const resolved = await resolveLegacyInitializationPolicy(
        legacyAccount,
        chainId,
        allowLegacyRecoveryVisibility,
      );
      legacyDeclinedLabels = resolved.declinedLabels;

      if (errors.length > 0) {
        const details = summarizeInitErrors(errors);
        if (strictSync) {
          throw new CLIError(
            `Failed to sync account state for ${errors.length} pool(s). ${details}`,
            "RPC",
            "Check your RPC connectivity and retry.",
          );
        }
        warnOnPartialInitialization(
          suppressWarnings,
          `account sync had partial failures for ${errors.length} pool(s): ${details}`,
        );
      } else {
        const requestedScopes = pools.map((pool) => pool.scope as AccountScope);
        const {
          account: reconciledAccount,
          preservedScopes,
        } = preserveRegressedScopeEntries(
          service.account,
          account,
          requestedScopes,
        );
        if (preservedScopes.length > 0) {
          const details = summarizeScopePreservations(preservedScopes);
          warnOnPartialInitialization(
            suppressWarnings,
            `account sync returned fewer Pool Accounts than the saved state for ${preservedScopes.length} pool(s); keeping the saved account entries for ${details}`,
          );
        }
        const reconciledAccountWithLegacy = withStoredLegacyPoolAccounts(
          reconciledAccount,
          legacyAccount,
        );
        const releaseLock = acquireProcessLock();
        try {
          service.account = withStoredLegacyState(
            reconciledAccountWithLegacy,
            legacyAccount,
            resolved.readiness.status,
          );
          guardCriticalSection();
          try {
            saveAccount(chainId, service.account);
            saveSyncMeta(chainId);
          } finally {
            releaseCriticalSection();
          }
        } finally {
          releaseLock();
        }
      }
    }

    return {
      accountService: service,
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
      legacyDeclinedLabels,
    };
  }

  // Fresh initialization
  const accountService = await withSuppressedSdkStdout(
    async () => new AccountService(dataService, { mnemonic }),
  );

  // Initialize with events if pools are provided
  if (pools.length > 0) {
    try {
      const releaseLock = acquireProcessLock();
      try {
        const poolInfos = pools.map(toPoolInfo);
        const result = await withSuppressedSdkStdout(async () =>
          AccountService.initializeWithEvents(
            dataService,
            { mnemonic },
            poolInfos,
          ),
        );
        const {
          readiness,
          declinedLabels,
        } = await resolveLegacyInitializationPolicy(
          result.legacyAccount,
          chainId,
          allowLegacyRecoveryVisibility,
        );
        result.account.account = withStoredLegacyState(
          result.account.account,
          result.legacyAccount,
          readiness.status,
        );

        const initErrors = result.errors ?? [];
        if (initErrors.length > 0) {
          const details = summarizeInitErrors(initErrors);

          if (strictSync) {
            throw new CLIError(
              `Failed to initialize account from onchain events for ${initErrors.length} pool(s). ${details}`,
              "RPC",
              "Check your RPC connectivity and retry.",
            );
          }

          warnOnPartialInitialization(
            suppressWarnings,
            `account initialization had partial failures for ${initErrors.length} pool(s): ${details}`,
          );

          return buildPartialInitializationState(result.account, false);
        }

        saveAccount(chainId, result.account.account);
        saveSyncMeta(chainId);
        return {
          accountService: result.account,
          skipImmediateSync: true,
          rebuiltLegacyAccount: false,
          legacyDeclinedLabels: declinedLabels,
        };
      } finally {
        releaseLock();
      }
    } catch (err) {
      if (isLegacyRestoreBlockingError(err)) {
        throw err;
      }
      if (strictSync) {
        throw new CLIError(
          `Failed to initialize account from onchain events: ${sanitizeDiagnosticText(err instanceof Error ? err.message : String(err))}`,
          "RPC",
          "Check your RPC connectivity and retry.",
        );
      }
      if (!suppressWarnings) {
        process.stderr.write(
          `Warning: fresh account initialization failed, using empty account: ${sanitizeDiagnosticText(err instanceof Error ? err.message : String(err))}\n`,
        );
      }
    }
  }

  return {
    accountService,
    skipImmediateSync: false,
    rebuiltLegacyAccount: false,
    legacyDeclinedLabels: null,
  };
}

export async function initializeAccountService(
  dataService: DataService,
  mnemonic: string,
  pools: Array<{
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
  }>,
  chainId: number,
  /** When true, sync events even for saved accounts to catch external changes */
  forceSync: boolean = false,
  /** When true, suppress best-effort sync warnings to keep machine stderr clean */
  suppressWarnings: boolean = false,
  /** When true, treat sync/initialization failures as hard errors (fail-closed). */
  strictSync: boolean = false,
): Promise<AccountService> {
  const { accountService } = await initializeAccountServiceWithState(
    dataService,
    mnemonic,
    pools,
    chainId,
    {
      allowLegacyAccountRebuild: forceSync,
      forceSyncSavedAccount: forceSync,
      suppressWarnings,
      strictSync,
    },
  );
  return accountService;
}

// ── Sync metadata (freshness tracking) ──────────────────────────────

/** How long a previous sync stays "fresh" before query commands re-sync. */
const SYNC_FRESHNESS_MS = 120_000; // 2 minutes

function getSyncMetaPath(chainId: number): string {
  return join(getAccountsDir(), `${chainId}.sync.json`);
}

/** Read sync metadata for a chain. Returns null if missing or corrupt. */
export function loadSyncMeta(chainId: number): { lastSyncTime: number } | null {
  const path = getSyncMetaPath(chainId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.lastSyncTime === "number") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Stamp the current time as the last successful sync for a chain. */
export function saveSyncMeta(chainId: number): void {
  ensureConfigDir();
  const path = getSyncMetaPath(chainId);
  writePrivateFileAtomic(path, JSON.stringify({ lastSyncTime: Date.now() }));
}

/** True if the chain was synced within the TTL window. */
export function isSyncFresh(
  chainId: number,
  ttlMs: number = SYNC_FRESHNESS_MS,
): boolean {
  const meta = loadSyncMeta(chainId);
  if (!meta) return false;
  return Date.now() - meta.lastSyncTime < ttlMs;
}

// ── Shared sync-events helper ───────────────────────────────────────

export interface SyncEventsOptions {
  /** When true, skip sync entirely (--no-sync). */
  skip: boolean;
  /** When true, ignore freshness TTL and always sync. */
  force: boolean;
  silent: boolean;
  isJson: boolean;
  isVerbose: boolean;
  /** Prefix for error messages, e.g. "Balance" or "Sync". */
  errorLabel: string;
  dataService: DataService;
  mnemonic: string;
  allowLegacyRecoveryVisibility?: boolean;
}

/**
 * Sync account events if needed (respects freshness TTL and --no-sync).
 * On success the account state and sync metadata are persisted atomically.
 * Returns true if a sync was actually performed.
 */
export async function syncAccountEvents(
  accountService: AccountService,
  poolInfos: Array<{
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
  }>,
  pools: Array<{ pool: string; symbol: string }>,
  chainId: number,
  opts: SyncEventsOptions,
): Promise<boolean> {
  if (opts.skip) return false;
  const releaseLock = acquireProcessLock();
  try {
    if (!opts.force && isSyncFresh(chainId)) {
      logVerbose("Skipping sync (recently synced)", opts.isVerbose, opts.silent);
      return false;
    }

    const persistedAccount = loadAccount(chainId);
    const { account, legacyAccount, errors } = await rebuildAccountScopesFromEvents(
      opts.dataService,
      opts.mnemonic,
      persistedAccount ?? accountService.account,
      poolInfos,
    );
    const resolved = await resolveLegacyInitializationPolicy(
      legacyAccount,
      chainId,
      opts.allowLegacyRecoveryVisibility ?? false,
    );

    if (errors.length > 0) {
      for (const error of errors) {
        const symbol =
          pools.find((pool) => {
            const poolInfo = poolInfos.find((info) => info.scope === error.scope);
            return poolInfo ? pool.pool.toLowerCase() === poolInfo.address.toLowerCase() : false;
          })?.symbol ?? error.scope.toString();
        warn(
          `Sync failed for ${symbol} pool: ${sanitizeDiagnosticText(error.reason)}`,
          opts.silent,
        );
      }
    }

    if (errors.length > 0) {
      throw new CLIError(
        `${opts.errorLabel} sync failed for ${errors.length} pool(s).`,
        "RPC",
        "Retry with a healthy RPC before using this data.",
        undefined,
        true,
      );
    }

    const requestedScopes = poolInfos.map((poolInfo) => poolInfo.scope as AccountScope);
    const {
      account: reconciledAccount,
      preservedScopes,
    } = preserveRegressedScopeEntries(
      persistedAccount ?? accountService.account,
      account,
      requestedScopes,
    );
    if (preservedScopes.length > 0) {
      const details = summarizeScopePreservations(preservedScopes);
      warn(
        `Sync rebuilt fewer Pool Accounts than the saved state for ${preservedScopes.length} pool(s); keeping the saved account entries for ${details}.`,
        opts.silent,
      );
    }

    accountService.account = withStoredLegacyPoolAccounts(
      reconciledAccount,
      legacyAccount,
    );
    accountService.account = withStoredLegacyState(
      accountService.account,
      legacyAccount,
      resolved.readiness.status,
    );
    guardCriticalSection();
    try {
      saveAccount(chainId, accountService.account);
      saveSyncMeta(chainId);
    } finally {
      releaseCriticalSection();
    }
  } finally {
    releaseLock();
  }

  return true;
}
