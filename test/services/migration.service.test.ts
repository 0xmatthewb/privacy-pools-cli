import { afterEach, describe, expect, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { buildMigrationChainReadinessFromLegacyAccount } from "../../src/services/migration.ts";

const ORIGINAL_FETCH = global.fetch;

function makeLegacyAccount(
  poolAccounts: Array<{
    label: bigint;
    value: bigint;
    isMigrated?: boolean;
    ragequit?: boolean;
  }>,
) {
  return new AccountService({} as any, {
    account: {
      masterKeys: [1n, 2n],
      poolAccounts: new Map([
        [
          1n,
          poolAccounts.map((entry) => ({
            label: entry.label,
            deposit: {
              hash: entry.label + 100n,
              value: entry.value,
              label: entry.label,
              nullifier: entry.label + 200n,
              secret: entry.label + 300n,
              blockNumber: 1n,
              txHash: "0x" + "11".repeat(32),
            },
            children: [],
            isMigrated: entry.isMigrated ?? false,
            ragequit: entry.ragequit
              ? {
                  label: entry.label,
                  value: entry.value,
                  transactionHash: "0x" + "22".repeat(32),
                  blockNumber: 2n,
                  timestamp: 3n,
                }
              : undefined,
          })),
        ],
      ]),
      creationTimestamp: 0n,
      lastUpdateTimestamp: 0n,
    } as any,
  });
}

describe("migration service", () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  test("builds migration readiness with migrated, remaining, and declined legacy commitments", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify([
          { label: "11", reviewStatus: "approved" },
          { label: "22", reviewStatus: "approved" },
          { label: "33", reviewStatus: "declined" },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof global.fetch;

    const readiness = await buildMigrationChainReadinessFromLegacyAccount(
      makeLegacyAccount([
        { label: 11n, value: 1n },
        { label: 22n, value: 1n, isMigrated: true },
        { label: 33n, value: 1n },
      ]),
      11155111,
    );

    expect(readiness.status).toBe("partially_migrated");
    expect(readiness.reviewStatusComplete).toBe(true);
    expect(readiness.candidateLegacyCommitments).toBe(3);
    expect(readiness.expectedLegacyCommitments).toBe(2);
    expect(readiness.migratedCommitments).toBe(1);
    expect(readiness.legacySpendableCommitments).toBe(1);
    expect(readiness.declinedLegacyCommitments).toBe(1);
    expect(readiness.requiresMigration).toBe(true);
    expect(readiness.requiresWebsiteRecovery).toBe(true);
  });

  test("surfaces declined-only legacy accounts as website recovery", async () => {
    global.fetch = (async () =>
      new Response(
        JSON.stringify([
          { label: "11", reviewStatus: "declined" },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      )) as typeof global.fetch;

    const readiness = await buildMigrationChainReadinessFromLegacyAccount(
      makeLegacyAccount([{ label: 11n, value: 1n }]),
      11155111,
    );

    expect(readiness.status).toBe("website_recovery_required");
    expect(readiness.reviewStatusComplete).toBe(true);
    expect(readiness.candidateLegacyCommitments).toBe(1);
    expect(readiness.expectedLegacyCommitments).toBe(0);
    expect(readiness.declinedLegacyCommitments).toBe(1);
    expect(readiness.requiresMigration).toBe(false);
    expect(readiness.requiresWebsiteRecovery).toBe(true);
  });
});
