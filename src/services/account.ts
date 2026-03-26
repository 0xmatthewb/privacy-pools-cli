import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import {
  AccountService,
  DataService,
  type PoolInfo,
} from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import { CHAINS, resolveChainOverrides } from "../config/chains.js";
import { getAccountsDir, ensureConfigDir } from "./config.js";
import { fetchDepositReviewStatuses } from "./asp.js";
import {
  CLIError,
  accountMigrationRequiredError,
  accountWebsiteRecoveryRequiredError,
} from "../utils/errors.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../utils/critical-section.js";
import { warn, verbose as logVerbose } from "../utils/format.js";
import { normalizeAspApprovalStatus } from "../utils/statuses.js";
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

interface LegacyCommitmentLike {
  label?: bigint | null;
  value?: bigint | null;
}

interface LegacyPoolAccountLike {
  label?: bigint | null;
  ragequit?: unknown;
  isMigrated?: boolean;
  deposit?: LegacyCommitmentLike | null;
  children?: LegacyCommitmentLike[] | null;
}

interface LegacyMigrationCandidate {
  scope: bigint;
  label: string;
}

function latestLegacyCommitment(
  account: LegacyPoolAccountLike,
): LegacyCommitmentLike | null {
  const children = Array.isArray(account.children) ? account.children : [];
  return children.length > 0
    ? children[children.length - 1] ?? null
    : account.deposit ?? null;
}

function resolveLegacyDepositLabel(account: LegacyPoolAccountLike): string | null {
  const label =
    typeof account.deposit?.label === "bigint"
      ? account.deposit.label
      : typeof account.label === "bigint"
        ? account.label
        : null;

  return label === null ? null : label.toString();
}

function collectLegacyMigrationCandidates(
  legacyAccount: AccountService | undefined,
): LegacyMigrationCandidate[] {
  const poolAccounts = (
    legacyAccount as unknown as {
      account?: { poolAccounts?: Map<unknown, unknown[]> };
    }
  )?.account?.poolAccounts;

  if (!(poolAccounts instanceof Map)) return [];

  const candidates: LegacyMigrationCandidate[] = [];

  for (const [rawScope, rawAccounts] of poolAccounts.entries()) {
    if (typeof rawScope !== "bigint" || !Array.isArray(rawAccounts)) continue;

    for (const rawAccount of rawAccounts) {
      const account = rawAccount as LegacyPoolAccountLike;
      if (account.ragequit || account.isMigrated) continue;

      const latestCommitment = latestLegacyCommitment(account);
      const remainingValue =
        typeof latestCommitment?.value === "bigint"
          ? latestCommitment.value
          : null;
      if (remainingValue === null || remainingValue <= 0n) continue;

      const label = resolveLegacyDepositLabel(account);
      if (!label) continue;

      candidates.push({
        scope: rawScope,
        label,
      });
    }
  }

  return candidates;
}

function resolveChainConfigById(chainId: number) {
  const baseConfig = Object.values(CHAINS).find((chain) => chain.id === chainId);
  return baseConfig ? resolveChainOverrides(baseConfig) : null;
}

async function loadDeclinedLegacyLabels(
  chainId: number,
  candidates: readonly LegacyMigrationCandidate[],
): Promise<Set<string> | null> {
  if (candidates.length === 0) return new Set<string>();

  const chainConfig = resolveChainConfigById(chainId);
  if (!chainConfig) return null;

  const labelsByScope = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const scopeKey = candidate.scope.toString();
    const labels = labelsByScope.get(scopeKey) ?? new Set<string>();
    labels.add(candidate.label);
    labelsByScope.set(scopeKey, labels);
  }

  let unavailable = false;
  const declinedLabels = new Set<string>();

  await Promise.all(
    [...labelsByScope.entries()].map(async ([scopeKey, labels]) => {
      const statuses = await fetchDepositReviewStatuses(
        chainConfig,
        BigInt(scopeKey),
        [...labels],
      );
      if (statuses === null) {
        unavailable = true;
        return;
      }

      for (const [label, status] of statuses.entries()) {
        if (normalizeAspApprovalStatus(status) === "declined") {
          declinedLabels.add(label);
        }
      }
    }),
  );

  return unavailable ? null : declinedLabels;
}

function hasUnmigratedLegacyCommitments(
  candidates: readonly LegacyMigrationCandidate[],
  declinedLabels: ReadonlySet<string> | null,
): boolean {
  for (const candidate of candidates) {
    if (declinedLabels?.has(candidate.label)) continue;
    return true;
  }

  return false;
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
    `Stored account state could not be refreshed safely: ${error instanceof Error ? error.message : String(error)}`,
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
  const candidates = collectLegacyMigrationCandidates(legacyAccount);
  if (candidates.length === 0) return;

  const declinedLabels = await loadDeclinedLegacyLabels(chainId, candidates);
  if (!hasUnmigratedLegacyCommitments(candidates, declinedLabels)) {
    throw accountWebsiteRecoveryRequiredError(
      "Review this account in the Privacy Pools website first. Legacy declined deposits cannot be restored safely in the CLI and may require website-based public recovery instead of migration.",
    );
  }

  throw accountMigrationRequiredError();
}

function summarizeInitErrors(
  initErrors: Array<{ scope: bigint; reason: string }>,
): string {
  return initErrors
    .slice(0, 3)
    .map((e) => `scope ${e.scope.toString()}: ${e.reason}`)
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

function isMigrationRequiredError(error: unknown): boolean {
  return error instanceof CLIError && error.code === "ACCOUNT_MIGRATION_REQUIRED";
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
      if (isMigrationRequiredError(err)) {
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

    // Sync to pick up any events that happened since last save
    if (forceSyncSavedAccount && pools.length > 0) {
      let syncFailures = 0;
      for (const pool of pools) {
        const poolInfo = toPoolInfo(pool);
        try {
          await withSuppressedSdkStdout(async () => {
            await service.getDepositEvents(poolInfo);
            await service.getWithdrawalEvents(poolInfo);
            await service.getRagequitEvents(poolInfo);
          });
        } catch (err) {
          syncFailures++;
          if (!suppressWarnings) {
            process.stderr.write(
              `Warning: sync failed for pool ${pool.address}: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
      }
      if (strictSync && syncFailures > 0) {
        throw new CLIError(
          `Failed to sync account state for ${syncFailures} pool(s).`,
          "RPC",
          "Check your RPC connectivity and retry.",
        );
      }
      // Caller is responsible for saving within a critical section guard.
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
      if (isMigrationRequiredError(err)) {
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

  let syncFailures = 0;
  for (const poolInfo of poolInfos) {
    const pi = toPoolInfo(poolInfo);
    try {
      await withSuppressedSdkStdout(async () => {
        await accountService.getDepositEvents(pi);
        await accountService.getWithdrawalEvents(pi);
        await accountService.getRagequitEvents(pi);
      });
    } catch (err) {
      syncFailures++;
      const symbol =
        pools.find(
          (p) => p.pool.toLowerCase() === poolInfo.address.toLowerCase(),
        )?.symbol ?? poolInfo.address;
      warn(
        `Sync failed for ${symbol} pool: ${err instanceof Error ? err.message : String(err)}`,
        opts.silent,
      );
    }
  }

  if (syncFailures > 0 && opts.isJson) {
    throw new CLIError(
      `${opts.errorLabel} sync failed for ${syncFailures} pool(s).`,
      "RPC",
      "Retry with a healthy RPC before using this data.",
    );
  }

  if (syncFailures > 0) {
    // Keep partial in-memory progress for the current invocation, but never
    // persist a mixed snapshot that could hide legacy-account or sync gaps.
    return true;
  }

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
