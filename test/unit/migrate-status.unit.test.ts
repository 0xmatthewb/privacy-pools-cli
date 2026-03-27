import { describe, expect, test } from "bun:test";
import {
  migrateCommandTestInternals,
  summarizeMigrationStatusState,
  type MigrationStatusSummaryState,
} from "../../src/commands/migrate.ts";

function summarize(
  overrides: Array<{
    chainId: number;
    expectedLegacyCommitments: number;
    status: "no_legacy" | "migration_required" | "partially_migrated" | "fully_migrated" | "website_recovery_required" | "review_incomplete";
    requiresMigration: boolean;
    requiresWebsiteRecovery: boolean;
    reviewStatusComplete: boolean;
  }>,
  additionalUnresolvedChainIds: number[] = [],
): MigrationStatusSummaryState {
  return summarizeMigrationStatusState(
    overrides.map((entry) => ({
      chain: `chain-${entry.chainId}`,
      chainId: entry.chainId,
      status: entry.status,
      candidateLegacyCommitments: entry.expectedLegacyCommitments,
      expectedLegacyCommitments: entry.expectedLegacyCommitments,
      migratedCommitments: entry.status === "fully_migrated" ? entry.expectedLegacyCommitments : 0,
      legacyMasterSeedNullifiedCount: 0,
      hasPostMigrationCommitments: entry.status === "fully_migrated",
      isMigrated: entry.status === "fully_migrated",
      legacySpendableCommitments: entry.requiresMigration ? entry.expectedLegacyCommitments : 0,
      upgradedSpendableCommitments: entry.status === "fully_migrated" ? entry.expectedLegacyCommitments : 0,
      declinedLegacyCommitments: entry.requiresWebsiteRecovery ? entry.expectedLegacyCommitments : 0,
      reviewStatusComplete: entry.reviewStatusComplete,
      requiresMigration: entry.requiresMigration,
      requiresWebsiteRecovery: entry.requiresWebsiteRecovery,
      scopes: [],
    })),
    additionalUnresolvedChainIds,
  );
}

describe("summarizeMigrationStatusState", () => {
  test("treats fully migrated legacy chains as fully migrated without requiring migration", () => {
    const result = summarize([
      {
        chainId: 1,
        expectedLegacyCommitments: 2,
        status: "fully_migrated",
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        reviewStatusComplete: true,
      },
    ]);

    expect(result.requiredChainIds).toEqual([1]);
    expect(result.migratedChainIds).toEqual([1]);
    expect(result.missingChainIds).toEqual([]);
    expect(result.requiresMigration).toBe(false);
    expect(result.requiresWebsiteRecovery).toBe(false);
    expect(result.isFullyMigrated).toBe(true);
    expect(result.readinessResolved).toBe(true);
  });

  test("treats declined-only legacy chains as website recovery, not fully migrated", () => {
    const result = summarize([
      {
        chainId: 10,
        expectedLegacyCommitments: 0,
        status: "website_recovery_required",
        requiresMigration: false,
        requiresWebsiteRecovery: true,
        reviewStatusComplete: true,
      },
    ]);

    expect(result.requiredChainIds).toEqual([]);
    expect(result.websiteRecoveryChainIds).toEqual([10]);
    expect(result.requiresMigration).toBe(false);
    expect(result.requiresWebsiteRecovery).toBe(true);
    expect(result.isFullyMigrated).toBe(false);
    expect(result.readinessResolved).toBe(true);
  });

  test("tracks mixed migration and website recovery requirements separately", () => {
    const result = summarize([
      {
        chainId: 10,
        expectedLegacyCommitments: 2,
        status: "partially_migrated",
        requiresMigration: true,
        requiresWebsiteRecovery: true,
        reviewStatusComplete: true,
      },
    ]);

    expect(result.requiredChainIds).toEqual([10]);
    expect(result.missingChainIds).toEqual([10]);
    expect(result.websiteRecoveryChainIds).toEqual([10]);
    expect(result.requiresMigration).toBe(true);
    expect(result.requiresWebsiteRecovery).toBe(true);
    expect(result.isFullyMigrated).toBe(false);
  });

  test("treats no-legacy accounts as resolved and fully migrated", () => {
    const result = summarize([
      {
        chainId: 11155111,
        expectedLegacyCommitments: 0,
        status: "no_legacy",
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        reviewStatusComplete: true,
      },
    ]);

    expect(result.requiredChainIds).toEqual([]);
    expect(result.requiresMigration).toBe(false);
    expect(result.requiresWebsiteRecovery).toBe(false);
    expect(result.isFullyMigrated).toBe(true);
    expect(result.readinessResolved).toBe(true);
  });

  test("treats failed queried chains as unresolved even when loaded chains are clean", () => {
    const result = summarize(
      [
        {
          chainId: 1,
          expectedLegacyCommitments: 0,
          status: "no_legacy",
          requiresMigration: false,
          requiresWebsiteRecovery: false,
          reviewStatusComplete: true,
        },
      ],
      [42161],
    );

    expect(result.requiredChainIds).toEqual([]);
    expect(result.requiresMigration).toBe(false);
    expect(result.requiresWebsiteRecovery).toBe(false);
    expect(result.isFullyMigrated).toBe(false);
    expect(result.readinessResolved).toBe(false);
    expect(result.unresolvedChainIds).toEqual([42161]);
  });
});

describe("migrate command internal helpers", () => {
  test("format helpers keep the loading and warning copy stable", () => {
    expect(
      migrateCommandTestInternals.formatMigrationLoadingText(false),
    ).toBe("Checking legacy migration readiness across mainnet chains...");
    expect(
      migrateCommandTestInternals.formatMigrationLoadingText(true, 2, 3),
    ).toBe(
      "Checking legacy migration readiness across all chains... (2/3 complete)",
    );
    expect(
      migrateCommandTestInternals.createCoverageLimitationWarning("mainnet"),
    ).toEqual(
      expect.objectContaining({
        chain: "mainnet",
        category: "COVERAGE",
      }),
    );
    expect(
      migrateCommandTestInternals.formatIncompleteMigrationReviewWarning(
        "optimism",
      ),
    ).toContain("optimism");
  });

  test("summary helpers keep top-level migration readiness deterministic", () => {
    expect(
      migrateCommandTestInternals.normalizeTopLevelMigrationStatus(
        [
          {
            chain: "mainnet",
            chainId: 1,
            status: "fully_migrated",
            candidateLegacyCommitments: 1,
            expectedLegacyCommitments: 1,
            migratedCommitments: 1,
            legacyMasterSeedNullifiedCount: 1,
            hasPostMigrationCommitments: true,
            isMigrated: true,
            legacySpendableCommitments: 0,
            upgradedSpendableCommitments: 1,
            declinedLegacyCommitments: 0,
            reviewStatusComplete: true,
            requiresMigration: false,
            requiresWebsiteRecovery: false,
            scopes: [],
          },
        ],
        [10],
      ),
    ).toBe("review_incomplete");

    expect(
      migrateCommandTestInternals.normalizeTopLevelMigrationStatus([
        {
          chain: "optimism",
          chainId: 10,
          status: "website_recovery_required",
          candidateLegacyCommitments: 0,
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
          scopes: [],
        },
      ]),
    ).toBe("website_recovery_required");

    expect(
      migrateCommandTestInternals.summarizeInitErrors([
        { scope: 1n, reason: "one" },
        { scope: 2n, reason: "two" },
        { scope: 3n, reason: "three" },
        { scope: 4n, reason: "four" },
      ]),
    ).toBe("scope 1: one; scope 2: two; scope 3: three");
    expect(
      migrateCommandTestInternals.dedupeSortedChainIds([10, 1, 10, 42161]),
    ).toEqual([1, 10, 42161]);
  });
});
