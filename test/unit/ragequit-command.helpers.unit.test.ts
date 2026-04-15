import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import { CLIError } from "../../src/utils/errors.ts";

const realAccountService = await import("../../src/services/account.ts");
const realMigrationService = await import("../../src/services/migration.ts");

const initializeAccountServiceMock = mock(async () => ({
  kind: "account-service",
}));
const withSuppressedSdkStdoutMock = mock(async <T>(fn: () => Promise<T>) => await fn());
const collectLegacyMigrationCandidatesMock = mock(() => [
  { kind: "legacy-candidate" },
]);
const loadDeclinedLegacyLabelsMock = mock(async () => new Set(["601"]));

const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;

let isLegacyRecoveryFallbackError: typeof import("../../src/commands/ragequit.ts").isLegacyRecoveryFallbackError;
let buildRagequitPoolAccountRefs: typeof import("../../src/commands/ragequit.ts").buildRagequitPoolAccountRefs;
let formatRagequitPoolAccountChoice: typeof import("../../src/commands/ragequit.ts").formatRagequitPoolAccountChoice;
let getRagequitAdvisory: typeof import("../../src/commands/ragequit.ts").getRagequitAdvisory;
let loadRagequitAccountServices: typeof import("../../src/commands/ragequit.ts").loadRagequitAccountServices;
let resolveRequestedRagequitPoolAccountOrThrow: typeof import("../../src/commands/ragequit.ts").resolveRequestedRagequitPoolAccountOrThrow;

const SAMPLE_POOL_INFO = {
  chainId: 1,
  address: "0x1111111111111111111111111111111111111111" as Address,
  scope: 1n as never,
  deploymentBlock: 1n,
};

async function loadRagequitHelpers(): Promise<void> {
  mock.module("../../src/services/account.ts", () => ({
    ...realAccountService,
    initializeAccountService: initializeAccountServiceMock,
    withSuppressedSdkStdout: withSuppressedSdkStdoutMock,
  }));
  mock.module("../../src/services/migration.ts", () => ({
    ...realMigrationService,
    collectLegacyMigrationCandidates: collectLegacyMigrationCandidatesMock,
    loadDeclinedLegacyLabels: loadDeclinedLegacyLabelsMock,
  }));

  ({
    buildRagequitPoolAccountRefs,
    formatRagequitPoolAccountChoice,
    getRagequitAdvisory,
    isLegacyRecoveryFallbackError,
    loadRagequitAccountServices,
    resolveRequestedRagequitPoolAccountOrThrow,
  } = await import(
    `../../src/commands/ragequit.ts?test=${Date.now()}-${Math.random()}`
  ));
}

describe("ragequit command helper coverage", () => {
  beforeEach(async () => {
    mock.restore();
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    initializeAccountServiceMock.mockReset();
    withSuppressedSdkStdoutMock.mockReset();
    collectLegacyMigrationCandidatesMock.mockReset();
    loadDeclinedLegacyLabelsMock.mockReset();

    initializeAccountServiceMock.mockImplementation(async () => ({
      kind: "account-service",
    }));
    withSuppressedSdkStdoutMock.mockImplementation(
      async <T>(fn: () => Promise<T>) => await fn(),
    );
    collectLegacyMigrationCandidatesMock.mockImplementation(() => [
      { kind: "legacy-candidate" },
    ]);
    loadDeclinedLegacyLabelsMock.mockImplementation(
      async () => new Set(["601"]),
    );

    await loadRagequitHelpers();
  });

  afterEach(() => {
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    mock.restore();
  });

  test("recognizes only migration and website-recovery fallback errors", () => {
    expect(
      isLegacyRecoveryFallbackError(
        new CLIError(
          "website recovery required",
          "INPUT",
          "visit website",
          "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
        ),
      ),
    ).toBe(true);
    expect(
      isLegacyRecoveryFallbackError(
        new CLIError(
          "migration required",
          "INPUT",
          "migrate first",
          "ACCOUNT_MIGRATION_REQUIRED",
        ),
      ),
    ).toBe(true);
    expect(
      isLegacyRecoveryFallbackError(
        new CLIError(
          "review incomplete",
          "INPUT",
          "wait",
          "ACCOUNT_MIGRATION_REVIEW_INCOMPLETE",
        ),
      ),
    ).toBe(false);
    expect(isLegacyRecoveryFallbackError(new Error("boom"))).toBe(false);
  });

  test("formats ragequit Pool Account choices and advisories by account status", () => {
    const poolAccount = {
      paNumber: 7,
      paId: "PA-7",
      status: "approved",
      aspStatus: "approved",
      commitment: {
        hash: 1n,
        label: 2n,
        value: 100000000000000000n,
        blockNumber: 3n,
        txHash: "0x" + "11".repeat(32),
      },
      label: 2n,
      value: 100000000000000000n,
      blockNumber: 3n,
      txHash: "0x" + "11".repeat(32),
    } as const;

    expect(formatRagequitPoolAccountChoice(poolAccount as never, 18, "ETH")).toContain(
      "PA-7",
    );
    expect(getRagequitAdvisory(poolAccount as never)).toEqual(
      expect.objectContaining({
        level: "warn",
      }),
    );
    expect(
      getRagequitAdvisory({
        ...poolAccount,
        status: "pending",
        aspStatus: "pending",
      } as never)?.message,
    ).toContain("pending ASP review");
    expect(
      getRagequitAdvisory({
        ...poolAccount,
        status: "poa_required",
        aspStatus: "poa_required",
      } as never)?.message,
    ).toContain("Proof of Association");
    expect(
      getRagequitAdvisory({
        ...poolAccount,
        status: "declined",
        aspStatus: "declined",
      } as never)?.message,
    ).toContain("most common next action");
    expect(
      getRagequitAdvisory({
        ...poolAccount,
        status: "unknown",
        aspStatus: "unknown",
      } as never),
    ).toBeNull();
  });

  test("buildRagequitPoolAccountRefs returns an empty list when no spendable commitments exist", () => {
    expect(
      buildRagequitPoolAccountRefs(
        null,
        1n,
        [],
        new Set(["91"]),
        new Map([["91", "approved"]]),
      ),
    ).toEqual([]);
  });

  test("resolveRequestedRagequitPoolAccountOrThrow returns requested accounts and fails closed for unavailable or unknown selections", () => {
    const requestedPoolAccount = {
      paNumber: 4,
      paId: "PA-4",
      status: "approved",
      aspStatus: "approved",
      commitment: {
        hash: 4n,
        label: 14n,
        value: 100n,
        blockNumber: 5n,
        txHash: "0x" + "44".repeat(32),
      },
      label: 14n,
      value: 100n,
      blockNumber: 5n,
      txHash: "0x" + "44".repeat(32),
    } as const;

    expect(
      resolveRequestedRagequitPoolAccountOrThrow({
        requestedPoolAccounts: [requestedPoolAccount],
        allKnownPoolAccounts: [requestedPoolAccount],
        fromPaNumber: 4,
        symbol: "ETH",
        chainName: "mainnet",
      }),
    ).toBe(requestedPoolAccount);

    expect(() =>
      resolveRequestedRagequitPoolAccountOrThrow({
        requestedPoolAccounts: [],
        allKnownPoolAccounts: [
          {
            ...requestedPoolAccount,
            paNumber: 7,
            paId: "PA-7",
            status: "exited",
          },
        ],
        fromPaNumber: 7,
        symbol: "ETH",
        chainName: "mainnet",
      }),
    ).toThrow("PA-7 was already recovered publicly with ragequit");

    try {
      resolveRequestedRagequitPoolAccountOrThrow({
        requestedPoolAccounts: [],
        allKnownPoolAccounts: [requestedPoolAccount],
        fromPaNumber: 9,
        symbol: "ETH",
        chainName: "mainnet",
      });
      expect.unreachable("expected helper to fail closed");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Unknown Pool Account PA-9 for ETH.",
        hint: expect.stringContaining("list available Pool Accounts"),
      });
    }
  });

  test("returns the primary account service when no legacy fallback is needed", async () => {
    const result = await loadRagequitAccountServices(
      { kind: "data-service" } as never,
      "test test test test test test test test test test test junk",
      SAMPLE_POOL_INFO,
      1,
      true,
    );

    expect(initializeAccountServiceMock).toHaveBeenCalledWith(
      { kind: "data-service" },
      expect.any(String),
      [SAMPLE_POOL_INFO],
      1,
      true,
      true,
      true,
    );
    expect(result).toEqual({
      accountService: { kind: "account-service" },
      legacyAccountService: null,
      legacyDeclinedLabels: null,
    });
  });

  test("rethrows non-fallback account loading failures", async () => {
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError("rpc unavailable", "RPC", "retry later");
    });

    await expect(
      loadRagequitAccountServices(
        { kind: "data-service" } as never,
        "test test test test test test test test test test test junk",
        SAMPLE_POOL_INFO,
        1,
        false,
      ),
    ).rejects.toThrow("rpc unavailable");
  });

  test("fails closed when legacy website-recovery rebuild reports partial errors", async () => {
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "website recovery required",
        "INPUT",
        "visit website",
        "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      );
    });
    AccountService.initializeWithEvents = (async () => ({
      account: { kind: "account-service" },
      legacyAccount: { kind: "legacy-account-service" },
      errors: [
        { reason: "asp unavailable" },
        { reason: "rpc timeout" },
      ],
    })) as typeof AccountService.initializeWithEvents;

    await expect(
      loadRagequitAccountServices(
        { kind: "data-service" } as never,
        "test test test test test test test test test test test junk",
        SAMPLE_POOL_INFO,
        1,
        true,
      ),
    ).rejects.toThrow("Failed to load legacy website-recovery state");
  });

  test("rethrows the original fallback error when declined legacy labels stay unavailable", async () => {
    const fallbackError = new CLIError(
      "migration required",
      "INPUT",
      "visit website",
      "ACCOUNT_MIGRATION_REQUIRED",
    );
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw fallbackError;
    });
    AccountService.initializeWithEvents = (async () => ({
      account: { kind: "account-service" },
      legacyAccount: { kind: "legacy-account-service" },
      errors: [],
    })) as typeof AccountService.initializeWithEvents;
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => null);

    await expect(
      loadRagequitAccountServices(
        { kind: "data-service" } as never,
        "test test test test test test test test test test test junk",
        SAMPLE_POOL_INFO,
        1,
        false,
      ),
    ).rejects.toBe(fallbackError);
  });

  test("rethrows the original fallback error when no usable declined legacy labels remain", async () => {
    const fallbackError = new CLIError(
      "website recovery required",
      "INPUT",
      "visit website",
      "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
    );
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw fallbackError;
    });
    AccountService.initializeWithEvents = (async () => ({
      account: { kind: "account-service" },
      legacyAccount: { kind: "legacy-account-service" },
      errors: [],
    })) as typeof AccountService.initializeWithEvents;
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => new Set());

    await expect(
      loadRagequitAccountServices(
        { kind: "data-service" } as never,
        "test test test test test test test test test test test junk",
        SAMPLE_POOL_INFO,
        1,
        false,
      ),
    ).rejects.toBe(fallbackError);
  });

  test("returns legacy account visibility when the fallback rebuild succeeds", async () => {
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "website recovery required",
        "INPUT",
        "visit website",
        "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      );
    });
    AccountService.initializeWithEvents = (async () => ({
      account: { kind: "account-service" },
      legacyAccount: { kind: "legacy-account-service" },
      errors: [],
    })) as typeof AccountService.initializeWithEvents;
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(
      async () => new Set(["601", "777"]),
    );

    const result = await loadRagequitAccountServices(
      { kind: "data-service" } as never,
      "test test test test test test test test test test test junk",
      SAMPLE_POOL_INFO,
      1,
      false,
    );

    expect(withSuppressedSdkStdoutMock).toHaveBeenCalledTimes(1);
    expect(collectLegacyMigrationCandidatesMock).toHaveBeenCalledWith({
      kind: "legacy-account-service",
    });
    expect(loadDeclinedLegacyLabelsMock).toHaveBeenCalledWith(1, [
      { kind: "legacy-candidate" },
    ]);
    expect(result).toEqual({
      accountService: { kind: "account-service" },
      legacyAccountService: { kind: "legacy-account-service" },
      legacyDeclinedLabels: new Set(["601", "777"]),
    });
  });
});
