import { expect, test } from "bun:test";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "./output.ts";
import {
  fakeNestedCommand,
  getReadonlyCommandHandlers,
  readonlyHarnessMocks,
  useIsolatedHome,
} from "./account-readonly-command-handlers.harness.ts";

export function registerReadonlyMigrateStatusTests(): void {
  test("migrate status reports migration-required readiness on a single chain", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("migrate");
    expect(json.action).toBe("status");
    expect(json.operation).toBe("migrate.status");
    expect(json.chain).toBe("mainnet");
    expect(json.status).toBe("migration_required");
    expect(json.requiresMigration).toBe(true);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.readinessResolved).toBe(true);
    expect(json.chainReadiness).toEqual([
      expect.objectContaining({
        chain: "mainnet",
        status: "migration_required",
        expectedLegacyCommitments: 1,
      }),
    ]);
  });

  test("migrate status reports no_legacy when no legacy commitments remain", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.buildMigrationChainReadinessFromLegacyAccountMock.mockImplementationOnce(
      async () => ({
        status: "no_legacy",
        candidateLegacyCommitments: 0,
        expectedLegacyCommitments: 0,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: false,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        scopes: [],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("no_legacy");
    expect(json.requiresMigration).toBe(false);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.isFullyMigrated).toBe(true);
    expect(json.requiredChainIds).toEqual([]);
  });

  test("migrate status reports fully_migrated when all known legacy commitments are already migrated", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.buildMigrationChainReadinessFromLegacyAccountMock.mockImplementationOnce(
      async () => ({
        status: "fully_migrated",
        candidateLegacyCommitments: 2,
        expectedLegacyCommitments: 2,
        migratedCommitments: 2,
        legacyMasterSeedNullifiedCount: 2,
        hasPostMigrationCommitments: true,
        isMigrated: true,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 2,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        scopes: ["1"],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("fully_migrated");
    expect(json.requiresMigration).toBe(false);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.isFullyMigrated).toBe(true);
    expect(json.migratedChainIds).toContain(1);
  });

  test("migrate status fails closed when one queried chain cannot be loaded", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();

    readonlyHarnessMocks.initializeWithEventsMock.mockImplementation(
      async (
        _dataService: unknown,
        _wallet: unknown,
        poolInfos: Array<{ chainId: number }>,
      ) => {
        if (poolInfos[0]?.chainId === 42161) {
          throw new Error("arbitrum rpc down");
        }
        return {
          legacyAccount: { poolAccounts: new Map() },
          errors: [],
        };
      },
    );

    readonlyHarnessMocks.buildMigrationChainReadinessFromLegacyAccountMock.mockImplementation(
      async (_legacyAccount: unknown, chainId: number) => ({
        status: chainId === 1 ? "no_legacy" : "fully_migrated",
        candidateLegacyCommitments: 0,
        expectedLegacyCommitments: 0,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: chainId !== 1,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 0,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        scopes: [],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand({}, fakeNestedCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("review_incomplete");
    expect(json.readinessResolved).toBe(false);
    expect(json.unresolvedChainIds).toContain(42161);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain: "arbitrum",
        }),
      ]),
    );
  });

  test("migrate status keeps website-recovery states in the top-level summary", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();

    readonlyHarnessMocks.buildMigrationChainReadinessFromLegacyAccountMock.mockImplementationOnce(
      async () => ({
        status: "website_recovery_required",
        candidateLegacyCommitments: 1,
        expectedLegacyCommitments: 0,
        migratedCommitments: 0,
        legacyMasterSeedNullifiedCount: 0,
        hasPostMigrationCommitments: false,
        isMigrated: false,
        legacySpendableCommitments: 0,
        upgradedSpendableCommitments: 0,
        declinedLegacyCommitments: 1,
        reviewStatusComplete: true,
        requiresMigration: false,
        requiresWebsiteRecovery: true,
        scopes: ["1"],
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.status).toBe("website_recovery_required");
    expect(json.requiresMigration).toBe(false);
    expect(json.requiresWebsiteRecovery).toBe(true);
    expect(json.websiteRecoveryChainIds).toContain(1);
  });

  test("migrate status fails cleanly when the CLI has no supported pools for a queried chain", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.listKnownPoolsFromRegistryMock.mockImplementationOnce(
      async () => [],
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNKNOWN_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No CLI-supported pools are configured",
    );
    expect(json.error.hint).toContain("Privacy Pools website");
    expect(exitCode).toBe(1);
  });

  test("migrate status surfaces retryable RPC errors when legacy initialization is partial", async () => {
    useIsolatedHome("mainnet");
    const { handleMigrateStatusCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.initializeWithEventsMock.mockImplementationOnce(
      async () => ({
        legacyAccount: { poolAccounts: new Map() },
        errors: [{ scope: 1n, reason: "rpc unavailable" }],
      }),
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleMigrateStatusCommand(
        {},
        fakeNestedCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.retryable).toBe(true);
    expect(json.error.message ?? json.errorMessage).toContain(
      "Failed to load legacy migration readiness",
    );
    expect(exitCode).toBe(3);
  });
}
