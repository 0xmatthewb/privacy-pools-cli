import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import {
  AccountService,
  DataService,
  type PoolInfo,
} from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import { getAccountsDir, ensureConfigDir } from "./config.js";
import {
  CLIError,
  accountMigrationRequiredError,
  accountMigrationReviewIncompleteError,
  accountWebsiteRecoveryRequiredError,
  sanitizeDiagnosticText,
} from "../utils/errors.js";
import {
  buildMigrationChainReadinessFromLegacyAccount,
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
  return (
    savedAccount !== null &&
    savedAccount?.__privacyPoolsCliAccountVersion !== ACCOUNT_FILE_VERSION
  );
}

export interface InitializeAccountServiceStateOptions {
  allowLegacyAccountRebuild?: boolean;
  forceSyncSavedAccount?: boolean;
  suppressWarnings?: boolean;
  strictSync?: boolean;
}

export interface InitializeAccountServiceState {
  accountService: AccountService;
  /**
   * True when initialization already completed a full onchain refresh and
   * stamped sync freshness, so callers can skip an immediate second pass.
   */
  skipImmediateSync: boolean;
  rebuiltLegacyAccount: boolean;
}

type AccountState = AccountService["account"];
type AccountScope = Parameters<AccountState["poolAccounts"]["delete"]>[0];

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

async function assertNoLegacyMigrationRequired(
  legacyAccount: AccountService | undefined,
  chainId: number,
): Promise<void> {
  const readiness = await buildMigrationChainReadinessFromLegacyAccount(
    legacyAccount,
    chainId,
  );

  if (readiness.status === "no_legacy" || readiness.status === "fully_migrated") {
    return;
  }

  if (readiness.status === "website_recovery_required") {
    throw accountWebsiteRecoveryRequiredError(
      "Review this account in the Privacy Pools website first. Legacy declined deposits cannot be restored safely in the CLI and may require website-based public recovery instead of migration.",
    );
  }

  if (readiness.status === "review_incomplete") {
    throw accountMigrationReviewIncompleteError(
      "Legacy ASP review data is temporarily unavailable. Retry this command or run 'privacy-pools migrate status' after ASP connectivity recovers before acting on this account.",
    );
  }

  throw accountMigrationRequiredError();
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
  return {
    accountService,
    skipImmediateSync: false,
    rebuiltLegacyAccount,
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
    poolAccounts.delete(scope);
  }
  for (const [scope, accounts] of rebuiltAccount.poolAccounts.entries()) {
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
  errors: Array<{ scope: bigint; reason: string }>;
}> {
  if (pools.length === 0) {
    return { account: currentAccount, errors: [] };
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
  } = options;
  // Try to load existing account state
  const savedAccount = loadAccount(chainId);
  const hasCurrentAccountVersion =
    savedAccount?.__privacyPoolsCliAccountVersion === ACCOUNT_FILE_VERSION;
  const needsSavedAccountRefresh =
    savedAccount !== null && pools.length > 0 && !hasCurrentAccountVersion;

  if (needsSavedAccountRefresh) {
    if (!allowLegacyAccountRebuild) {
      throw staleAccountRefreshRequiredError();
    }

    try {
      const poolInfos = pools.map(toPoolInfo);
      const result = await withSuppressedSdkStdout(async () =>
        AccountService.initializeWithEvents(
          dataService,
          { mnemonic },
          poolInfos,
        ),
      );
      await assertNoLegacyMigrationRequired(result.legacyAccount, chainId);

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
      };
    } catch (err) {
      if (isLegacyRestoreBlockingError(err)) {
        throw err;
      }
      if (strictSync) {
        throw new CLIError(
          `Failed to rebuild legacy account state from onchain events: ${err instanceof Error ? err.message : String(err)}`,
          "RPC",
          "Check your RPC connectivity and retry.",
        );
      }
      if (!suppressWarnings) {
        process.stderr.write(
          `Warning: legacy account rebuild failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      throw staleAccountRefreshFailedError(err);
    }
  }

  if (savedAccount) {
    const service = await withSuppressedSdkStdout(
      async () => new AccountService(dataService, { account: savedAccount }),
    );

    if (forceSyncSavedAccount && pools.length > 0) {
      const { account, errors } = await rebuildAccountScopesFromEvents(
        dataService,
        mnemonic,
        service.account,
        pools,
      );

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
        service.account = account;
      }
    }

    return {
      accountService: service,
      skipImmediateSync: false,
      rebuiltLegacyAccount: false,
    };
  }

  // Fresh initialization
  const accountService = await withSuppressedSdkStdout(
    async () => new AccountService(dataService, { mnemonic }),
  );

  // Initialize with events if pools are provided
  if (pools.length > 0) {
    try {
      const poolInfos = pools.map(toPoolInfo);
      const result = await withSuppressedSdkStdout(async () =>
        AccountService.initializeWithEvents(
          dataService,
          { mnemonic },
          poolInfos,
        ),
      );
      await assertNoLegacyMigrationRequired(result.legacyAccount, chainId);

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
      };
    } catch (err) {
      if (isLegacyRestoreBlockingError(err)) {
        throw err;
      }
      if (strictSync) {
        throw new CLIError(
          `Failed to initialize account from onchain events: ${err instanceof Error ? err.message : String(err)}`,
          "RPC",
          "Check your RPC connectivity and retry.",
        );
      }
      if (!suppressWarnings) {
        process.stderr.write(
          `Warning: fresh account initialization failed, using empty account: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }

  return {
    accountService,
    skipImmediateSync: false,
    rebuiltLegacyAccount: false,
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
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify({ lastSyncTime: Date.now() }), {
    encoding: "utf-8",
    mode: 0o600,
  });
  renameSync(tmpPath, path);
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
  if (!opts.force && isSyncFresh(chainId)) {
    logVerbose("Skipping sync (recently synced)", opts.isVerbose, opts.silent);
    return false;
  }

  const { account, errors } = await rebuildAccountScopesFromEvents(
    opts.dataService,
    opts.mnemonic,
    accountService.account,
    poolInfos,
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

  accountService.account = account;

  const releaseLock = acquireProcessLock();
  try {
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
