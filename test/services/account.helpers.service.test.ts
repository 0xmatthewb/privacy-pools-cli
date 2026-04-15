import { afterEach, describe, expect, mock, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import {
  ACCOUNT_FILE_VERSION,
  buildPartialInitializationState,
  clonePoolAccountsMap,
  getStoredLegacyPoolAccounts,
  getStoredLegacyReadinessStatus,
  legacyReadinessError,
  mergeRebuiltScopes,
  preserveRegressedScopeEntries,
  resolveStoredLegacyPoolAccounts,
  savedAccountNeedsLegacyRefresh,
  staleAccountRefreshFailedError,
  staleAccountRefreshRequiredError,
  summarizeInitErrors,
  summarizeScopePreservations,
  toPoolInfo,
  rebuildAccountScopesFromEvents,
  warnOnPartialInitialization,
  withStoredLegacyPoolAccounts,
  withStoredLegacyState,
} from "../../src/services/account.ts";
import { CLIError } from "../../src/utils/errors.ts";

const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;

async function loadAccountHelpersWithMigrationMocks(params: {
  collectLegacyMigrationCandidates?: (...args: unknown[]) => unknown[];
  loadDeclinedLegacyLabels?: (...args: unknown[]) => Promise<Set<string> | null>;
  buildMigrationChainReadiness?: (...args: unknown[]) => unknown;
  buildMigrationChainReadinessFromLegacyAccount?: (...args: unknown[]) => Promise<unknown>;
}) {
  mock.module("../../src/services/migration.ts", () => ({
    buildMigrationChainReadiness:
      params.buildMigrationChainReadiness ??
      (() => ({ status: "fully_migrated", requiresWebsiteRecovery: false })),
    buildMigrationChainReadinessFromLegacyAccount:
      params.buildMigrationChainReadinessFromLegacyAccount ??
      (async () => ({ status: "no_legacy", requiresWebsiteRecovery: false })),
    collectLegacyMigrationCandidates:
      params.collectLegacyMigrationCandidates ?? (() => []),
    loadDeclinedLegacyLabels:
      params.loadDeclinedLegacyLabels ?? (async () => new Set<string>()),
  }));

  return await import(
    `../../src/services/account.ts?legacy-helper=${Date.now()}-${Math.random()}`
  );
}

function sampleAccount(overrides: Record<string, unknown> = {}) {
  return {
    masterKeys: [1n, 2n],
    poolAccounts: new Map<bigint, Array<{ label: bigint; deposit?: Record<string, unknown>; children: unknown[] }>>([
      [1n, [{ label: 11n, deposit: { hash: 101n }, children: [] }]],
      [2n, [{ label: 22n, deposit: { hash: 202n }, children: [] }]],
    ]),
    creationTimestamp: 0n,
    lastUpdateTimestamp: 0n,
    ...overrides,
  };
}

describe("account helper coverage", () => {
  afterEach(() => {
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    mock.restore();
  });

  test("savedAccountNeedsLegacyRefresh checks version, legacy pool history, and readiness metadata", () => {
    expect(
      savedAccountNeedsLegacyRefresh(
        sampleAccount({
          __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
          __legacyPoolAccounts: new Map(),
          __legacyMigrationReadinessStatus: "no_legacy",
        }) as never,
      ),
    ).toBe(false);
    expect(
      savedAccountNeedsLegacyRefresh(
        sampleAccount({ __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION }) as never,
      ),
    ).toBe(true);
    expect(
      savedAccountNeedsLegacyRefresh(
        sampleAccount({
          __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
          __legacyPoolAccounts: new Map(),
        }) as never,
      ),
    ).toBe(true);
  });

  test("clonePoolAccountsMap deep-clones legacy pool-account state", () => {
    const original = new Map([
      [1n, [{ label: 11n, deposit: { hash: 101n }, children: [{ hash: 1n }], ragequit: { txHash: "0x1" } }]],
    ]);

    const cloned = clonePoolAccountsMap(original as never);

    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned?.get(1n)?.[0]).not.toBe(original.get(1n)?.[0]);
    expect(clonePoolAccountsMap(undefined)).toBeUndefined();
  });

  test("legacy storage helpers fail closed for malformed inputs and clear persisted readiness in place", () => {
    const current = sampleAccount({
      __legacyPoolAccounts: [["bad", "data"]],
      __legacyMigrationReadinessStatus: "review_incomplete",
    });

    expect(clonePoolAccountsMap(null as never)).toBeUndefined();
    expect(
      resolveStoredLegacyPoolAccounts(current as never, {
        account: { poolAccounts: [["still", "bad"]] },
      } as never),
    ).toEqual(new Map());

    const cleared = withStoredLegacyState(current as never, undefined, undefined);
    expect(getStoredLegacyReadinessStatus(cleared as never)).toBeUndefined();
    expect(getStoredLegacyPoolAccounts(cleared as never)).toEqual(new Map());
  });

  test("resolveStoredLegacyPoolAccounts prefers cloned legacy input and falls back to existing stored state", () => {
    const current = sampleAccount({
      __legacyPoolAccounts: new Map([[9n, [{ label: 99n, children: [] }]]]),
    });
    const legacy = {
      account: {
        poolAccounts: new Map([[7n, [{ label: 77n, children: [] }]]]),
      },
    };

    const resolvedFromLegacy = resolveStoredLegacyPoolAccounts(
      current as never,
      legacy as never,
    );
    expect(Array.from(resolvedFromLegacy.entries())).toEqual([
      [7n, [expect.objectContaining({ label: 77n })]],
    ]);
    expect(resolvedFromLegacy).not.toBe(legacy.account.poolAccounts);

    const resolvedFromCurrent = resolveStoredLegacyPoolAccounts(current as never);
    expect(resolvedFromCurrent).toBe(
      getStoredLegacyPoolAccounts(current as never),
    );

    const resolvedEmpty = resolveStoredLegacyPoolAccounts(sampleAccount() as never);
    expect(resolvedEmpty).toEqual(new Map());
  });

  test("resolveStoredLegacyPoolAccounts reuses the same stored legacy map when the replacement source matches exactly", () => {
    const sharedLegacyPoolAccounts = new Map([[7n, [{ label: 77n, children: [] }]]]);
    const current = sampleAccount({
      __legacyPoolAccounts: sharedLegacyPoolAccounts,
    });

    const resolved = resolveStoredLegacyPoolAccounts(current as never, {
      account: {
        poolAccounts: sharedLegacyPoolAccounts,
      },
    } as never);

    expect(resolved).toBe(sharedLegacyPoolAccounts);
  });

  test("withStoredLegacyState persists and clears readiness metadata alongside legacy pool accounts", () => {
    const current = sampleAccount();
    const legacy = {
      account: {
        poolAccounts: new Map([[3n, [{ label: 33n, children: [] }]]]),
      },
    };

    const stored = withStoredLegacyState(
      current as never,
      legacy as never,
      "website_recovery_required",
    );
    expect(Array.from(getStoredLegacyPoolAccounts(stored as never)?.entries() ?? [])).toEqual([
      [3n, [expect.objectContaining({ label: 33n })]],
    ]);
    expect(getStoredLegacyReadinessStatus(stored as never)).toBe(
      "website_recovery_required",
    );

    const cleared = withStoredLegacyState(stored as never, undefined, undefined);
    expect(getStoredLegacyReadinessStatus(cleared as never)).toBeUndefined();
  });

  test("withStoredLegacyPoolAccounts keeps the existing stored map when no replacement source is provided", () => {
    const existingStoredMap = new Map([[9n, [{ label: 99n, children: [] }]]]);
    const current = sampleAccount({
      __legacyPoolAccounts: existingStoredMap,
    });

    const stored = withStoredLegacyPoolAccounts(current as never);

    expect(getStoredLegacyPoolAccounts(stored as never)).toBe(existingStoredMap);
  });

  test("getStoredLegacyPoolAccounts and getStoredLegacyReadinessStatus ignore malformed persisted metadata", () => {
    const malformedAccount = sampleAccount({
      __legacyPoolAccounts: [["not", "a map"]],
      __legacyMigrationReadinessStatus: 42,
    });

    expect(getStoredLegacyPoolAccounts(malformedAccount as never)).toBeUndefined();
    expect(getStoredLegacyReadinessStatus(malformedAccount as never)).toBeUndefined();
  });

  test("legacyReadinessError maps website, review, and migration states to targeted CLI errors", () => {
    expect(legacyReadinessError("no_legacy")).toBeNull();
    expect(legacyReadinessError("fully_migrated")).toBeNull();
    expect(legacyReadinessError("website_recovery_required")?.code).toBe(
      "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    );
    expect(legacyReadinessError("review_incomplete")?.code).toBe(
      "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
    );
    expect(legacyReadinessError("migration_required")?.code).toBe(
      "ACCOUNT_MIGRATION_REQUIRED",
    );
  });

  test("summarizeInitErrors and summarizeScopePreservations trim to the first three scopes", () => {
    expect(
      summarizeInitErrors([
        { scope: 1n, reason: "rpc timeout" },
        { scope: 2n, reason: "bad\nmessage" },
        { scope: 3n, reason: "oops" },
        { scope: 4n, reason: "ignored" },
      ]),
    ).toBe("scope 1: rpc timeout; scope 2: bad\nmessage; scope 3: oops");
    expect(summarizeScopePreservations([1n, 2n, 3n, 4n])).toBe(
      "scope 1; scope 2; scope 3",
    );
  });

  test("warnOnPartialInitialization emits only when warnings are enabled", () => {
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      warnOnPartialInitialization(false, "partial refresh");
      warnOnPartialInitialization(true, "suppressed refresh");
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(writes).toEqual(["Warning: partial refresh\n"]);
  });

  test("buildPartialInitializationState attaches empty stored legacy history", () => {
    const accountService = {
      account: sampleAccount(),
    } as unknown as AccountService;

    const state = buildPartialInitializationState(accountService, true);

    expect(state.rebuiltLegacyAccount).toBe(true);
    expect(state.skipImmediateSync).toBe(false);
    expect(state.legacyDeclinedLabels).toBeNull();
    expect(getStoredLegacyPoolAccounts(state.accountService.account as never)).toEqual(
      new Map(),
    );
  });

  test("mergeRebuiltScopes keeps untouched scopes and preserveRegressedScopeEntries keeps richer saved scopes", () => {
    const current = sampleAccount({
      poolAccounts: new Map([
        [1n, [{ label: 11n, children: [] }]],
        [2n, [{ label: 22n, children: [] }]],
      ]),
    });
    const rebuilt = sampleAccount({
      poolAccounts: new Map([
        [1n, [{ label: 111n, children: [] }]],
        [3n, [{ label: 333n, children: [] }]],
      ]),
    });

    const merged = mergeRebuiltScopes(current as never, rebuilt as never, [
      1n,
      3n,
    ] as never);
    expect(merged.poolAccounts.get(1n)).toEqual([{ label: 111n, children: [] }]);
    expect(merged.poolAccounts.get(2n)).toEqual([{ label: 22n, children: [] }]);
    expect(merged.poolAccounts.get(3n)).toEqual([{ label: 333n, children: [] }]);

    const mergedWithUntouchedRebuiltScope = mergeRebuiltScopes(
      current as never,
      sampleAccount({
        poolAccounts: new Map([
          [1n, [{ label: 111n, children: [] }]],
          [4n, [{ label: 444n, children: [] }]],
        ]),
      }) as never,
      [1n] as never,
    );
    expect(mergedWithUntouchedRebuiltScope.poolAccounts.get(4n)).toEqual([
      { label: 444n, children: [] },
    ]);

    const regressed = sampleAccount({
      poolAccounts: new Map([
        [1n, [{ label: 111n, children: [] }]],
      ]),
    });
    const preserved = preserveRegressedScopeEntries(
      current as never,
      regressed as never,
      [1n, 2n] as never,
    );
    expect(preserved.preservedScopes).toEqual([2n]);
    expect(preserved.account.poolAccounts.get(2n)).toEqual([
      { label: 22n, children: [] },
    ]);

    const untouched = preserveRegressedScopeEntries(
      current as never,
      rebuilt as never,
      [1n] as never,
    );
    expect(untouched.preservedScopes).toEqual([]);
    expect(untouched.account).toBe(rebuilt);

    const mergedDeletingUnknownRequestedScope = mergeRebuiltScopes(
      sampleAccount({
        poolAccounts: new Map([[1n, [{ label: 11n, children: [] }]]]),
      }) as never,
      sampleAccount({
        poolAccounts: new Map(),
      }) as never,
      [3n] as never,
    );
    expect(mergedDeletingUnknownRequestedScope.poolAccounts.has(3n)).toBe(false);

    const preservedWithoutCurrentEntries = preserveRegressedScopeEntries(
      sampleAccount({
        poolAccounts: new Map([[1n, []]]),
      }) as never,
      rebuilt as never,
      [1n] as never,
    );
    expect(preservedWithoutCurrentEntries.preservedScopes).toEqual([]);
    expect(preservedWithoutCurrentEntries.account).toBe(rebuilt);

    const keepsPreviouslyObservedScope = mergeRebuiltScopes(
      sampleAccount({
        poolAccounts: new Map([
          [1n, [{ label: 11n, children: [] }]],
          [2n, [{ label: 22n, children: [] }]],
        ]),
      }) as never,
      sampleAccount({
        poolAccounts: new Map([
          [2n, [{ label: 222n, children: [] }]],
        ]),
      }) as never,
      [1n, 2n] as never,
    );
    expect(keepsPreviouslyObservedScope.poolAccounts.get(1n)).toEqual([
      { label: 11n, children: [] },
    ]);
  });

  test("stale account refresh errors stay fail-closed and retryable where intended", () => {
    expect(staleAccountRefreshRequiredError()).toMatchObject({
      category: "INPUT",
      retryable: false,
    });
    expect(staleAccountRefreshFailedError("disk unavailable")).toMatchObject({
      category: "RPC",
      retryable: true,
    });
  });

  test("toPoolInfo preserves canonical pool fields for SDK event rebuilds", () => {
    expect(
      toPoolInfo({
        chainId: 1,
        address: "0x1111111111111111111111111111111111111111",
        scope: 123n,
        deploymentBlock: 456n,
      }),
    ).toEqual({
      chainId: 1,
      address: "0x1111111111111111111111111111111111111111",
      scope: 123n,
      deploymentBlock: 456n,
    });
  });

  test("withStoredLegacyPoolAccounts preserves an existing legacy map when no replacement source is provided", () => {
    const current = sampleAccount({
      __legacyPoolAccounts: new Map([[9n, [{ label: 99n, children: [] }]]]),
    });

    const stored = withStoredLegacyPoolAccounts(current as never);

    expect(getStoredLegacyPoolAccounts(stored as never)).toEqual(
      new Map([[9n, [{ label: 99n, children: [] }]]]),
    );
  });

  test("savedAccountNeedsLegacyRefresh stays false for nullish state and true for missing readiness metadata", () => {
    expect(savedAccountNeedsLegacyRefresh(null as never)).toBe(false);
    expect(savedAccountNeedsLegacyRefresh(undefined as never)).toBe(false);
    expect(
      savedAccountNeedsLegacyRefresh(
        sampleAccount({
          __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION,
          __legacyPoolAccounts: new Map(),
          __legacyMigrationReadinessStatus: undefined,
        }) as never,
      ),
    ).toBe(true);
  });

  test("savedAccountNeedsLegacyRefresh fails closed on version drift even when legacy metadata exists", () => {
    expect(
      savedAccountNeedsLegacyRefresh(
        sampleAccount({
          __privacyPoolsCliAccountVersion: ACCOUNT_FILE_VERSION - 1,
          __legacyPoolAccounts: new Map(),
          __legacyMigrationReadinessStatus: "no_legacy",
        }) as never,
      ),
    ).toBe(true);
  });

  test("clonePoolAccountsMap ignores malformed non-map legacy metadata", () => {
    expect(clonePoolAccountsMap([["not", "a map"]] as never)).toBeUndefined();
    expect(clonePoolAccountsMap(null)).toBeUndefined();
  });

  test("clonePoolAccountsMap replaces malformed per-scope entries with empty arrays", () => {
    const cloned = clonePoolAccountsMap(
      new Map([[1n, "not-an-array"]]) as never,
    );

    expect(cloned).toEqual(new Map([[1n, []]]));
  });

  test("clonePoolAccountsMap preserves empty scopes and withStoredLegacyState can clear readiness in place", () => {
    const storedLegacyPoolAccounts = new Map([[5n, []]]);
    const cloned = clonePoolAccountsMap(storedLegacyPoolAccounts as never);

    expect(cloned).toEqual(new Map([[5n, []]]));
    expect(cloned).not.toBe(storedLegacyPoolAccounts);

    const current = sampleAccount({
      __legacyPoolAccounts: storedLegacyPoolAccounts,
      __legacyMigrationReadinessStatus: "review_incomplete",
    });
    const cleared = withStoredLegacyState(current as never, undefined, undefined);

    expect(getStoredLegacyPoolAccounts(cleared as never)).toBe(storedLegacyPoolAccounts);
    expect(getStoredLegacyReadinessStatus(cleared as never)).toBeUndefined();
  });

  test("resolveStoredLegacyPoolAccounts ignores malformed replacement metadata and keeps stored legacy state", () => {
    const existingStoredMap = new Map([[9n, [{ label: 99n, children: [] }]]]);
    const current = sampleAccount({
      __legacyPoolAccounts: existingStoredMap,
    });

    const resolved = resolveStoredLegacyPoolAccounts(current as never, {
      account: {
        poolAccounts: "not-a-map",
      },
    } as never);

    expect(resolved).toBe(existingStoredMap);
  });

  test("rebuildAccountScopesFromEvents returns the current account unchanged when no pools are requested", async () => {
    const currentAccount = sampleAccount();

    await expect(
      rebuildAccountScopesFromEvents(
        {} as never,
        "mnemonic",
        currentAccount as never,
        [],
      ),
    ).resolves.toEqual({
      account: currentAccount,
      legacyAccount: undefined,
      errors: [],
    });
  });

  test("resolveLegacyReadiness falls back to legacy-account readiness when candidates are absent or unclassified", async () => {
    const noCandidatesHelpers = await loadAccountHelpersWithMigrationMocks({
      collectLegacyMigrationCandidates: () => [],
      buildMigrationChainReadinessFromLegacyAccount: async () => ({
        status: "review_incomplete",
        requiresWebsiteRecovery: false,
      }),
    });

    await expect(
      noCandidatesHelpers.resolveLegacyReadiness(
        { account: { poolAccounts: new Map() } },
        1,
      ),
    ).resolves.toEqual({
      readiness: {
        status: "review_incomplete",
        requiresWebsiteRecovery: false,
      },
      declinedLabels: new Set(),
    });

    const unresolvedHelpers = await loadAccountHelpersWithMigrationMocks({
      collectLegacyMigrationCandidates: () => [{ kind: "legacy" }],
      loadDeclinedLegacyLabels: async () => null,
      buildMigrationChainReadinessFromLegacyAccount: async () => ({
        status: "website_recovery_required",
        requiresWebsiteRecovery: true,
      }),
    });

    await expect(
      unresolvedHelpers.resolveLegacyReadiness(
        { account: { poolAccounts: new Map() } },
        1,
      ),
    ).resolves.toEqual({
      readiness: {
        status: "website_recovery_required",
        requiresWebsiteRecovery: true,
      },
      declinedLabels: null,
    });
  });

  test("resolveLegacyReadiness returns classified readiness when declined labels load successfully", async () => {
    const classifiedHelpers = await loadAccountHelpersWithMigrationMocks({
      collectLegacyMigrationCandidates: () => [{ kind: "legacy", label: 7n }],
      loadDeclinedLegacyLabels: async () => new Set(["7"]),
      buildMigrationChainReadiness: () => ({
        status: "migration_required",
        requiresWebsiteRecovery: false,
      }),
    });

    await expect(
      classifiedHelpers.resolveLegacyReadiness(
        { account: { poolAccounts: new Map() } },
        1,
      ),
    ).resolves.toEqual({
      readiness: {
        status: "migration_required",
        requiresWebsiteRecovery: false,
      },
      declinedLabels: new Set(["7"]),
    });
  });

  test("resolveLegacyInitializationPolicy preserves allowed website-recovery visibility and blocks other restore states", async () => {
    const visibleHelpers = await loadAccountHelpersWithMigrationMocks({
      collectLegacyMigrationCandidates: () => [{ kind: "legacy" }],
      loadDeclinedLegacyLabels: async () => new Set(["7"]),
      buildMigrationChainReadiness: () => ({
        status: "website_recovery_required",
        requiresWebsiteRecovery: true,
      }),
    });

    await expect(
      visibleHelpers.resolveLegacyInitializationPolicy(
        { account: { poolAccounts: new Map() } },
        1,
        true,
      ),
    ).resolves.toEqual({
      readiness: {
        status: "website_recovery_required",
        requiresWebsiteRecovery: true,
      },
      declinedLabels: new Set(["7"]),
    });

    const blockingHelpers = await loadAccountHelpersWithMigrationMocks({
      collectLegacyMigrationCandidates: () => [{ kind: "legacy" }],
      loadDeclinedLegacyLabels: async () => new Set(["7"]),
      buildMigrationChainReadiness: () => ({
        status: "migration_required",
        requiresWebsiteRecovery: false,
      }),
    });

    await expect(
      blockingHelpers.resolveLegacyInitializationPolicy(
        { account: { poolAccounts: new Map() } },
        1,
        false,
      ),
    ).rejects.toBeInstanceOf(CLIError);
  });

  test("resolveLegacyInitializationPolicy still blocks website recovery when visibility is disabled", async () => {
    const hiddenHelpers = await loadAccountHelpersWithMigrationMocks({
      collectLegacyMigrationCandidates: () => [{ kind: "legacy" }],
      loadDeclinedLegacyLabels: async () => new Set(["7"]),
      buildMigrationChainReadiness: () => ({
        status: "website_recovery_required",
        requiresWebsiteRecovery: true,
      }),
    });

    await expect(
      hiddenHelpers.resolveLegacyInitializationPolicy(
        { account: { poolAccounts: new Map() } },
        1,
        false,
      ),
    ).rejects.toMatchObject({
      code: "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    });
  });

  test("legacy restore helper predicates and empty rebuilds stay fail-closed", async () => {
    const helpers = await loadAccountHelpersWithMigrationMocks({});

    expect(
      helpers.isLegacyRestoreBlockingError(
        new CLIError(
          "migration required",
          "INPUT",
          "migrate first",
          "ACCOUNT_MIGRATION_REQUIRED",
        ),
      ),
    ).toBe(true);
    expect(
      helpers.isLegacyRestoreBlockingError(
        new CLIError("input error", "INPUT", "fix input", "INPUT_ERROR"),
      ),
    ).toBe(false);

    const current = sampleAccount();
    await expect(
      helpers.rebuildAccountScopesFromEvents(
        { kind: "data-service" },
        "test test test test test test test test test test test junk",
        current,
        [],
      ),
    ).resolves.toEqual({
      account: current,
      legacyAccount: undefined,
      errors: [],
    });
  });

  test("rebuildAccountScopesFromEvents merges rebuilt scopes and surfaces event rebuild errors", async () => {
    const helpers = await loadAccountHelpersWithMigrationMocks({});
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: sampleAccount({
          poolAccounts: new Map([
            [1n, [{ label: 111n, children: [] }]],
            [3n, [{ label: 333n, children: [] }]],
          ]),
        }),
      } as never,
      legacyAccount: {
        account: {
          poolAccounts: new Map([[9n, [{ label: 99n, children: [] }]]]),
        },
      } as never,
      errors: [{ scope: 3n, reason: "rpc timeout" }],
    })) as typeof AccountService.initializeWithEvents;

    const rebuilt = await helpers.rebuildAccountScopesFromEvents(
      { kind: "data-service" } as never,
      "test test test test test test test test test test test junk",
      sampleAccount({
        poolAccounts: new Map([
          [1n, [{ label: 11n, children: [] }]],
          [2n, [{ label: 22n, children: [] }]],
        ]),
      }) as never,
      [
        {
          chainId: 1,
          address: "0x1111111111111111111111111111111111111111",
          scope: 1n,
          deploymentBlock: 1n,
        },
        {
          chainId: 1,
          address: "0x3333333333333333333333333333333333333333",
          scope: 3n,
          deploymentBlock: 3n,
        },
      ],
    );

    expect(rebuilt.account.poolAccounts.get(1n)).toEqual([
      { label: 111n, children: [] },
    ]);
    expect(rebuilt.account.poolAccounts.get(2n)).toEqual([
      { label: 22n, children: [] },
    ]);
    expect(rebuilt.account.poolAccounts.get(3n)).toEqual([
      { label: 333n, children: [] },
    ]);
    expect(rebuilt.legacyAccount).toMatchObject({
      account: {
        poolAccounts: new Map([[9n, [{ label: 99n, children: [] }]]]),
      },
    });
    expect(rebuilt.errors).toEqual([{ scope: 3n, reason: "rpc timeout" }]);
  });
});
