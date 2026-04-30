import {
  afterEach,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import type { Command } from "commander";
import { CLIError } from "../../src/utils/errors.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "./output.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "./module-mocks.ts";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import {
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
} from "./unsigned-assertions.ts";
import { createTestWorld, type TestWorld } from "./test-world.ts";
import { restoreTestTty, setTestTty } from "./tty.ts";

const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realContracts = captureModuleExports(
  await import("../../src/services/contracts.ts"),
);
const realInquirerPrompts = captureModuleExports(
  await import("@inquirer/prompts"),
);
const realPoolAccounts = captureModuleExports(
  await import("../../src/utils/pool-accounts.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realAsp = captureModuleExports(await import("../../src/services/asp.ts"));
const realMigration = captureModuleExports(
  await import("../../src/services/migration.ts"),
);
const realProofs = captureModuleExports(
  await import("../../src/services/proofs.ts"),
);
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realPreflight = captureModuleExports(
  await import("../../src/utils/preflight.ts"),
);
const realLock = captureModuleExports(await import("../../src/utils/lock.ts"));
const realCriticalSection = captureModuleExports(
  await import("../../src/utils/critical-section.ts"),
);
const realUnsigned = captureModuleExports(
  await import("../../src/utils/unsigned.ts"),
);
const realPreviewRuntime = captureModuleExports(
  await import("../../src/preview/runtime.ts"),
);
const realPromptCancellation = captureModuleExports(
  await import("../../src/utils/prompt-cancellation.ts"),
);
const realSetupRecovery = captureModuleExports(
  await import("../../src/utils/setup-recovery.ts"),
);
const ORIGINAL_INIT_WITH_EVENTS = AccountService.initializeWithEvents;

const RAGEQUIT_HANDLER_MODULE_RESTORES = [
  ["@inquirer/prompts", realInquirerPrompts],
  ["../../src/services/account.ts", realAccount],
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/asp.ts", realAsp],
  ["../../src/services/migration.ts", realMigration],
  ["../../src/services/proofs.ts", realProofs],
  ["../../src/services/contracts.ts", realContracts],
  ["../../src/utils/pool-accounts.ts", realPoolAccounts],
  ["../../src/utils/preflight.ts", realPreflight],
  ["../../src/utils/lock.ts", realLock],
  ["../../src/utils/critical-section.ts", realCriticalSection],
  ["../../src/utils/unsigned.ts", realUnsigned],
  ["../../src/preview/runtime.ts", realPreviewRuntime],
  ["../../src/utils/prompt-cancellation.ts", realPromptCancellation],
  ["../../src/utils/setup-recovery.ts", realSetupRecovery],
] as const;

const ETH_POOL = {
  symbol: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  scope: 1n,
  decimals: 18,
  deploymentBlock: 1n,
};

const APPROVED_POOL_ACCOUNT = {
  paNumber: 1,
  paId: "PA-1",
  status: "approved",
  aspStatus: "approved",
  commitment: {
    hash: 501n,
    label: 601n,
    value: 1000000000000000000n,
    nullifier: 701n,
    secret: 801n,
    blockNumber: 123n,
    txHash: "0x" + "aa".repeat(32),
  },
  label: 601n,
  value: 1000000000000000000n,
  blockNumber: 123n,
  txHash: "0x" + "aa".repeat(32),
};

const initializeAccountServiceMock = mock(async () => ({
  account: { poolAccounts: new Map() },
  getSpendableCommitments: () =>
    new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
  addRagequitToAccount: mock(() => undefined),
}));
const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
const withSuppressedSdkStdoutSyncMock = mock(<T>(fn: () => T): T => fn());
const getDataServiceMock = mock(async () => ({}));
const getPublicClientMock = mock(() => ({
  readContract: async () => "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
  waitForTransactionReceipt: async () => ({
    status: "success",
    blockNumber: 987n,
  }),
}));
const resolvePoolMock = mock(async () => ETH_POOL);
const listPoolsMock = mock(async () => [ETH_POOL]);
const proveCommitmentMock = mock(async () => ({
  proof: {
    pi_a: ["0", "0", "1"],
    pi_b: [
      ["0", "0"],
      ["0", "0"],
      ["1", "0"],
    ],
    pi_c: ["0", "0", "1"],
  },
  publicSignals: [1n, 2n, 3n, 4n],
}));
const ragequitMock = mock(async () => ({
  hash: "0x" + "12".repeat(32),
}));
const buildRagequitPoolAccountRefsMock = mock(() => [APPROVED_POOL_ACCOUNT]);
const buildAllPoolAccountRefsMock = mock(() => [APPROVED_POOL_ACCOUNT]);
const buildPoolAccountRefsMock = mock(() => [APPROVED_POOL_ACCOUNT]);
const collectActiveLabelsMock = mock(() => ["601"]);
const describeUnavailablePoolAccountMock = mock(() => null);
const getUnknownPoolAccountErrorMock = mock(() => ({
  message: "Unknown Pool Account.",
  hint: "Choose a valid Pool Account.",
}));
const parsePoolAccountSelectorMock = mock((raw: string) => {
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : null;
});
const poolAccountIdMock = mock((paNumber: number) => `PA-${paNumber}`);
const checkHasGasMock = mock(async () => undefined);
const acquireProcessLockMock = mock(() => () => undefined);
const guardCriticalSectionMock = mock(() => undefined);
const releaseCriticalSectionMock = mock(() => undefined);
const toRagequitSolidityProofMock = mock(() => ({
  pA: [0n, 0n],
  pB: [
    [0n, 0n],
    [0n, 0n],
  ],
  pC: [0n, 0n],
  pubSignals: [0n, 0n, 0n, 0n],
}));
const printRawTransactionsMock = mock(() => undefined);
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () => "RAGEQUIT");
const selectPromptMock = mock(async () => 1);
const collectLegacyMigrationCandidatesMock = mock(() => []);
const loadDeclinedLegacyLabelsMock = mock(async () => new Set<string>());
const loadAspDepositReviewStateMock = mock(async () => ({
  approvedLabels: new Set<string>(["601"]),
  rawReviewStatuses: new Map<string, string>([["601", "approved"]]),
  reviewStatuses: new Map<string, string>([["601", "approved"]]),
  hasIncompleteReviewData: false,
}));
const maybeRenderPreviewScenarioMock = mock(async () => false);
const maybeRenderPreviewProgressStepMock = mock(async () => false);
const isPromptCancellationErrorMock = mock(
  realPromptCancellation.isPromptCancellationError,
);
const maybeRecoverMissingWalletSetupMock = mock(async () => false);

let handleRagequitCommand: typeof import("../../src/commands/ragequit.ts").handleRagequitCommand;
let world: TestWorld;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function useIsolatedHome(options: {
  defaultChain?: string;
  withSigner?: boolean;
} = {}): string {
  return world.seedConfigHome({
    defaultChain: options.defaultChain ?? "mainnet",
    withSigner: options.withSigner ?? false,
  });
}

async function loadRagequitCommandHandler(): Promise<void> {
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    select: selectPromptMock,
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountService: initializeAccountServiceMock,
    saveAccount: saveAccountMock,
    saveSyncMeta: saveSyncMetaMock,
    withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getDataService: getDataServiceMock,
    getPublicClient: getPublicClientMock,
  }));
  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    resolvePool: resolvePoolMock,
    listPools: listPoolsMock,
  }));
  mock.module("../../src/services/asp.ts", () => ({
    formatIncompleteAspReviewDataMessage: () =>
      `Review data unavailable. Complete PoA at ${POA_PORTAL_URL}.`,
    loadAspDepositReviewState: loadAspDepositReviewStateMock,
    normalizeDepositReviewStatuses: (statuses: ReadonlyMap<string, string>) =>
      statuses,
  }));
  mock.module("../../src/services/migration.ts", () => ({
    ...realMigration,
    collectLegacyMigrationCandidates: collectLegacyMigrationCandidatesMock,
    loadDeclinedLegacyLabels: loadDeclinedLegacyLabelsMock,
  }));
  mock.module("../../src/services/proofs.ts", () => ({
    ...realProofs,
    proveCommitment: proveCommitmentMock,
  }));
  mock.module("../../src/services/contracts.ts", () => ({
    ...realContracts,
    ragequit: ragequitMock,
  }));
  mock.module("../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
    buildRagequitPoolAccountRefs: buildRagequitPoolAccountRefsMock,
    buildAllPoolAccountRefs: buildAllPoolAccountRefsMock,
    buildPoolAccountRefs: buildPoolAccountRefsMock,
    collectActiveLabels: collectActiveLabelsMock,
    describeUnavailablePoolAccount: describeUnavailablePoolAccountMock,
    getUnknownPoolAccountError: getUnknownPoolAccountErrorMock,
    parsePoolAccountSelector: parsePoolAccountSelectorMock,
    poolAccountId: poolAccountIdMock,
  }));
  mock.module("../../src/utils/preflight.ts", () => ({
    checkHasGas: checkHasGasMock,
  }));
  mock.module("../../src/utils/lock.ts", () => ({
    acquireProcessLock: acquireProcessLockMock,
  }));
  mock.module("../../src/utils/critical-section.ts", () => ({
    guardCriticalSection: guardCriticalSectionMock,
    releaseCriticalSection: releaseCriticalSectionMock,
  }));
  mock.module("../../src/utils/unsigned.ts", () => ({
    printRawTransactions: printRawTransactionsMock,
    toRagequitSolidityProof: toRagequitSolidityProofMock,
  }));
  mock.module("../../src/preview/runtime.ts", () => ({
    ...realPreviewRuntime,
    maybeRenderPreviewScenario: maybeRenderPreviewScenarioMock,
    maybeRenderPreviewProgressStep: maybeRenderPreviewProgressStepMock,
  }));
  mock.module("../../src/utils/prompt-cancellation.ts", () => ({
    ...realPromptCancellation,
    isPromptCancellationError: isPromptCancellationErrorMock,
  }));
  mock.module("../../src/utils/setup-recovery.ts", () => ({
    ...realSetupRecovery,
    maybeRecoverMissingWalletSetup: maybeRecoverMissingWalletSetupMock,
  }));

  if (handleRagequitCommand) {
    return;
  }

  ({ handleRagequitCommand } = await import(
    "../../src/commands/ragequit.ts"
  ));
}

export function registerRagequitCommandHandlerHarness(): void {
  afterEach(() => {
    restoreTestTty();
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    restoreModuleImplementations(RAGEQUIT_HANDLER_MODULE_RESTORES);
  });

  beforeEach(() => {
    setTestTty();
    world = createTestWorld({ prefix: "pp-ragequit-handler-" });
    mock.restore();
    AccountService.initializeWithEvents = ORIGINAL_INIT_WITH_EVENTS;
    initializeAccountServiceMock.mockClear();
    getDataServiceMock.mockClear();
    getPublicClientMock.mockClear();
    resolvePoolMock.mockClear();
    listPoolsMock.mockClear();
    saveAccountMock.mockClear();
    saveSyncMetaMock.mockClear();
    proveCommitmentMock.mockClear();
    ragequitMock.mockClear();
    collectActiveLabelsMock.mockClear();
    checkHasGasMock.mockClear();
    acquireProcessLockMock.mockClear();
    guardCriticalSectionMock.mockClear();
    releaseCriticalSectionMock.mockClear();
    toRagequitSolidityProofMock.mockClear();
    printRawTransactionsMock.mockClear();
    confirmPromptMock.mockClear();
    inputPromptMock.mockClear();
    selectPromptMock.mockClear();
    buildRagequitPoolAccountRefsMock.mockClear();
    buildAllPoolAccountRefsMock.mockClear();
    buildPoolAccountRefsMock.mockClear();
    collectLegacyMigrationCandidatesMock.mockClear();
    loadDeclinedLegacyLabelsMock.mockClear();
    loadAspDepositReviewStateMock.mockClear();
    describeUnavailablePoolAccountMock.mockClear();
    getUnknownPoolAccountErrorMock.mockClear();
    parsePoolAccountSelectorMock.mockClear();
    maybeRenderPreviewScenarioMock.mockClear();
    maybeRenderPreviewProgressStepMock.mockClear();
    isPromptCancellationErrorMock.mockClear();
    maybeRecoverMissingWalletSetupMock.mockClear();
    confirmPromptMock.mockImplementation(async () => true);
    inputPromptMock.mockImplementation(async () => "RAGEQUIT");
    selectPromptMock.mockImplementation(async () => 1);
    buildRagequitPoolAccountRefsMock.mockImplementation(() => [APPROVED_POOL_ACCOUNT]);
    saveAccountMock.mockImplementation(() => undefined);
    saveSyncMetaMock.mockImplementation(() => undefined);
    getDataServiceMock.mockImplementation(async () => ({}));
    proveCommitmentMock.mockImplementation(async () => ({
      proof: {
        pi_a: ["0", "0", "1"],
        pi_b: [
          ["0", "0"],
          ["0", "0"],
          ["1", "0"],
        ],
        pi_c: ["0", "0", "1"],
      },
      publicSignals: [1n, 2n, 3n, 4n],
    }));
    ragequitMock.mockImplementation(async () => ({
      hash: "0x" + "12".repeat(32),
    }));
    collectActiveLabelsMock.mockImplementation(() => ["601"]);
    checkHasGasMock.mockImplementation(async () => undefined);
    acquireProcessLockMock.mockImplementation(() => () => undefined);
    guardCriticalSectionMock.mockImplementation(() => undefined);
    releaseCriticalSectionMock.mockImplementation(() => undefined);
    toRagequitSolidityProofMock.mockImplementation(() => ({
      pA: [0n, 0n],
      pB: [
        [0n, 0n],
        [0n, 0n],
      ],
      pC: [0n, 0n],
      pubSignals: [0n, 0n, 0n, 0n],
    }));
    initializeAccountServiceMock.mockImplementation(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
      addRagequitToAccount: mock(() => undefined),
    }));
    resolvePoolMock.mockImplementation(async () => ETH_POOL);
    listPoolsMock.mockImplementation(async () => [ETH_POOL]);
    buildRagequitPoolAccountRefsMock.mockImplementation(() => [APPROVED_POOL_ACCOUNT]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [APPROVED_POOL_ACCOUNT]);
    buildPoolAccountRefsMock.mockImplementation(() => [APPROVED_POOL_ACCOUNT]);
    collectLegacyMigrationCandidatesMock.mockImplementation(() => []);
    loadDeclinedLegacyLabelsMock.mockImplementation(async () => new Set<string>());
    loadAspDepositReviewStateMock.mockImplementation(async () => ({
      approvedLabels: new Set<string>(["601"]),
      rawReviewStatuses: new Map<string, string>([["601", "approved"]]),
      reviewStatuses: new Map<string, string>([["601", "approved"]]),
      hasIncompleteReviewData: false,
    }));
    maybeRenderPreviewScenarioMock.mockImplementation(async () => false);
    maybeRenderPreviewProgressStepMock.mockImplementation(async () => false);
    isPromptCancellationErrorMock.mockImplementation(
      realPromptCancellation.isPromptCancellationError,
    );
    maybeRecoverMissingWalletSetupMock.mockImplementation(async () => false);
    describeUnavailablePoolAccountMock.mockImplementation(() => null);
    getUnknownPoolAccountErrorMock.mockImplementation(() => ({
      message: "Unknown Pool Account.",
      hint: "Choose a valid Pool Account.",
    }));
    parsePoolAccountSelectorMock.mockImplementation((raw: string) => {
      const match = raw.match(/\d+/);
      return match ? Number(match[0]) : null;
    });
    getPublicClientMock.mockImplementation(() => ({
      readContract: async () => "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 987n,
      }),
    }));
  });

  afterEach(async () => {
    await world?.teardown();
  });

  beforeEach(async () => {
    await loadRagequitCommandHandler();
  });
}

export function registerRagequitEntrySubmitTests(): void {
  test("rejects the removed --asset alias before loading ragequit state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        undefined,
        {
          asset: "ETH",
          poolAccount: "PA-1",
          unsigned: true,
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "--asset has been replaced by a positional argument",
    );
    expect(exitCode).toBe(2);
    expect(resolvePoolMock).not.toHaveBeenCalled();
  });

  test("accepts the hidden legacy ragequit acknowledgement alias", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.poolAccountId).toBe("PA-1");
    expect(parsePoolAccountSelectorMock).toHaveBeenCalledWith("PA-1");
  });

  test("rejects malformed --pool-account selectors before loading account state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "banana",
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid --pool-account");
    expect(exitCode).toBe(2);
  });

  test("rejects unsupported unsigned formats before loading account state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: "raw",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      'Unsupported unsigned format: "raw".',
    );
    expect(exitCode).toBe(2);
    expect(resolvePoolMock).not.toHaveBeenCalled();
  });

  test("rejects no-wait preview conflicts before loading ragequit state", async () => {
    useIsolatedHome();

    const dryRunConflict = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          noWait: true,
          dryRun: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    expect(dryRunConflict.json.success).toBe(false);
    expect(dryRunConflict.json.errorCode).toBe("INPUT_FLAG_CONFLICT");
    expect(dryRunConflict.json.error.message ?? dryRunConflict.json.errorMessage).toContain(
      "--no-wait cannot be combined with --dry-run",
    );

    const unsignedConflict = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          noWait: true,
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );
    expect(unsignedConflict.json.success).toBe(false);
    expect(unsignedConflict.json.errorCode).toBe("INPUT_FLAG_CONFLICT");
    expect(unsignedConflict.json.error.message ?? unsignedConflict.json.errorMessage).toContain(
      "--no-wait cannot be combined with --unsigned",
    );
    expect(resolvePoolMock).not.toHaveBeenCalled();
    expect(proveCommitmentMock).not.toHaveBeenCalled();
    expect(ragequitMock).not.toHaveBeenCalled();
  });

  test("fails cleanly for humans when no pools are available to choose from", async () => {
    useIsolatedHome();
    listPoolsMock.mockImplementationOnce(async () => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(2);
    expect(stderr).toContain("No pools found on mainnet");
  });

  test("fails closed in machine mode when no asset is supplied", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        undefined,
        {
          poolAccount: "PA-1",
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MISSING_ASSET");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No asset specified",
    );
    expect(exitCode).toBe(2);
  });

  test("returns early when preview rendering takes over the ragequit entry scenario", async () => {
    useIsolatedHome();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(
      async (commandKey: string) => commandKey === "ragequit",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(resolvePoolMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over the load-account progress step", async () => {
    useIsolatedHome();
    maybeRenderPreviewProgressStepMock.mockImplementationOnce(
      async (commandKey: string) => commandKey === "ragequit.load-account",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over Pool Account selection", async () => {
    useIsolatedHome();
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string) => commandKey === "ragequit select",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over final confirmation", async () => {
    useIsolatedHome();
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (commandKey: string) => commandKey === "ragequit confirm",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over proof generation", async () => {
    useIsolatedHome();
    maybeRenderPreviewProgressStepMock.mockImplementation(
      async (commandKey: string) => commandKey === "ragequit.generate-proof",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over submission", async () => {
    useIsolatedHome();
    maybeRenderPreviewProgressStepMock.mockImplementation(
      async (commandKey: string) => commandKey === "ragequit.submit",
    );

    const { stdout, stderr } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("renders a JSON dry-run for a selected Pool Account", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          dryRun: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.dryRun).toBe(true);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.proofPublicSignals).toBe(4);
  });

  test("allows dry-run ragequit for declined legacy accounts when init reports website recovery", async () => {
    useIsolatedHome();

    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "website recovery required",
        "INPUT",
        "use website recovery",
        "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      );
    });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectLegacyMigrationCandidatesMock.mockImplementationOnce(() => [
      { scope: 1n, label: "601", isMigrated: false, remainingValue: 1n },
    ]);
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => new Set(["601"]));

    const legacyAccountService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map([
          [1n, [{
            label: APPROVED_POOL_ACCOUNT.label as any,
            deposit: APPROVED_POOL_ACCOUNT.commitment,
            children: [],
          }]],
        ]),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      legacyAccount: legacyAccountService,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          dryRun: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.amount).toBe("1000000000000000000");
  });

  test("allows dry-run ragequit for declined legacy accounts when init reports mixed migration requirements", async () => {
    useIsolatedHome();

    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "migration required",
        "INPUT",
        "review this account in the website first",
        "ACCOUNT_MIGRATION_REQUIRED",
      );
    });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectLegacyMigrationCandidatesMock.mockImplementationOnce(() => [
      { scope: 1n, label: "601", isMigrated: false, remainingValue: 1n },
      { scope: 1n, label: "777", isMigrated: false, remainingValue: 2n },
    ]);
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => new Set(["601"]));

    const legacyAccountService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map([
          [1n, [{
            label: APPROVED_POOL_ACCOUNT.label as any,
            deposit: APPROVED_POOL_ACCOUNT.commitment,
            children: [],
          }]],
        ]),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      legacyAccount: legacyAccountService,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          dryRun: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.amount).toBe("1000000000000000000");
  });

}

export function registerRagequitUnsignedTests(): void {
  test("builds an unsigned ragequit transaction in JSON mode", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("ragequit");
    expect(json.unsigned).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.poolAccountId).toBe("PA-1");
    expectUnsignedTransactions(json.transactions, [
      {
        chainId: 1,
        from: "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
        to: ETH_POOL.pool,
        value: "0",
        description: "Ragequit from Privacy Pool",
      },
    ]);
  });

  test("prints raw unsigned transactions when --unsigned tx is requested", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: "tx",
          confirmRagequit: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expectPrintedRawTransactions(printRawTransactionsMock, [
      {
        chainId: 1,
        to: ETH_POOL.pool,
        value: "0",
        description: "Ragequit from Privacy Pool",
      },
    ]);
  });

  test("prints a structured prompt-cancelled error in unsigned json mode", async () => {
    useIsolatedHome();
    const cancelled = new Error("cancelled");
    proveCommitmentMock.mockImplementationOnce(async () => {
      throw cancelled;
    });
    isPromptCancellationErrorMock.mockImplementationOnce(
      (error: unknown) => error === cancelled,
    );

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("PROMPT_CANCELLED");
    expect(stderr).toBe("");
  });

}

export function registerRagequitEntrySubmitCompletionTests(): void {
  test("submits a signed ragequit and persists the local account update", async () => {
    useIsolatedHome({ withSigner: true });
    const addRagequitToAccountMock = mock(() => undefined);
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
      addRagequitToAccount: addRagequitToAccountMock,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.txHash).toBe("0x" + "12".repeat(32));
    expect(addRagequitToAccountMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
  });

  test("signed legacy recovery ragequit skips persisting a partial local snapshot", async () => {
    useIsolatedHome({ withSigner: true });

    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "migration required",
        "INPUT",
        "review this account in the website first",
        "ACCOUNT_MIGRATION_REQUIRED",
      );
    });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectLegacyMigrationCandidatesMock.mockImplementationOnce(() => [
      { scope: 1n, label: "601", isMigrated: false, remainingValue: 1n },
      { scope: 1n, label: "777", isMigrated: false, remainingValue: 2n },
    ]);
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => new Set(["601"]));

    const legacyAccountService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map([
          [1n, [{
            label: APPROVED_POOL_ACCOUNT.label as any,
            deposit: APPROVED_POOL_ACCOUNT.commitment,
            children: [],
          }]],
        ]),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      legacyAccount: legacyAccountService,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(saveAccountMock).not.toHaveBeenCalled();
    expect(saveSyncMetaMock).not.toHaveBeenCalled();
  });

  test("returns submitted handles without waiting for ragequit confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
      waitForTransactionReceipt: async () => {
        throw new Error("waitForTransactionReceipt should not run in --no-wait mode");
      },
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
          noWait: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.status).toBe("submitted");
    expect(typeof json.submissionId).toBe("string");
    expect(json.txHash).toBe("0x" + "12".repeat(32));
    expect(saveAccountMock).not.toHaveBeenCalled();
    expect(saveSyncMetaMock).not.toHaveBeenCalled();
  });

  test("streams ragequit progress before the submitted no-wait envelope", async () => {
    useIsolatedHome({ withSigner: true });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
          noWait: true,
          streamJson: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.stage).filter(Boolean)).toEqual(
      expect.arrayContaining([
        "validating_input",
        "chain_resolved",
        "pool_resolved",
        "generating_proof",
        "submitting_transaction",
        "complete",
      ]),
    );
    expect(lines.at(-1)).toMatchObject({
      success: true,
      operation: "ragequit",
      status: "submitted",
      poolAccountId: "PA-1",
    });
    expect(stderr).toBe("");
  });

}

export function registerRagequitOwnershipTests(): void {
  test("fails closed when no Pool Accounts remain spendable in the selected pool", async () => {
    useIsolatedHome();
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () => new Map([[1n, []]]),
      addRagequitToAccount: mock(() => undefined),
    }));
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectActiveLabelsMock.mockImplementationOnce(() => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          dryRun: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain(
      "No available Pool Accounts found for ragequit",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects signers that are not the original depositor before submission", async () => {
    useIsolatedHome({ withSigner: true });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [APPROVED_POOL_ACCOUNT]);
    buildPoolAccountRefsMock.mockImplementationOnce(() => [APPROVED_POOL_ACCOUNT]);
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => "0x9999999999999999999999999999999999999999",
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 987n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "is not the original depositor",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when the original depositor cannot be verified for signed ragequit", async () => {
    useIsolatedHome({ withSigner: true });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [APPROVED_POOL_ACCOUNT]);
    buildPoolAccountRefsMock.mockImplementationOnce(() => [APPROVED_POOL_ACCOUNT]);
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => {
        throw new Error("rpc unavailable");
      },
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 987n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Unable to verify the original depositor for ragequit",
    );
    expect(exitCode).toBe(3);
  });

  test("fails closed when legacy fallback loading reports partial website-recovery errors", async () => {
    useIsolatedHome();
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "website recovery required",
        "INPUT",
        "Visit the website first.",
        "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      );
    });
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      legacyAccount: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      errors: [{ reason: "asp unavailable" }],
    })) as typeof AccountService.initializeWithEvents;

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Failed to load legacy website-recovery state",
    );
    expect(json.error.message ?? json.errorMessage).toContain("asp unavailable");
    expect(exitCode).toBe(3);
  });

  test("returns early when wallet setup recovery handles the original failure", async () => {
    useIsolatedHome();
    const missingSetupError = new Error("missing wallet setup");
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw missingSetupError;
    });
    maybeRecoverMissingWalletSetupMock.mockImplementationOnce(
      async (error: unknown) => error === missingSetupError,
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

}

export function registerRagequitHumanConfirmationTests(): void {
  test("shows legacy declined-account guidance before human public recovery review", async () => {
    useIsolatedHome({ withSigner: true });
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "website recovery required",
        "INPUT",
        "use website recovery",
        "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
      );
    });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectLegacyMigrationCandidatesMock.mockImplementationOnce(() => [
      { scope: 1n, label: "601", isMigrated: false, remainingValue: 1n },
    ]);
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => new Set(["601"]));

    const legacyAccountService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map([
          [1n, [{
            label: APPROVED_POOL_ACCOUNT.label as any,
            deposit: APPROVED_POOL_ACCOUNT.commitment,
            children: [],
          }]],
        ]),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      legacyAccount: legacyAccountService,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;
    inputPromptMock.mockImplementationOnce(async () => "");

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain(
      "Declined legacy Pool Accounts are available here for public ragequit recovery.",
    );
    expect(stderr).toContain("Ragequit cancelled.");
  });

  test("warns humans when a signed legacy recovery ragequit will refresh from chain events later", async () => {
    useIsolatedHome({ withSigner: true });
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "migration required",
        "INPUT",
        "review this account in the website first",
        "ACCOUNT_MIGRATION_REQUIRED",
      );
    });
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => []);
    buildPoolAccountRefsMock.mockImplementationOnce(() => []);
    collectLegacyMigrationCandidatesMock.mockImplementationOnce(() => [
      { scope: 1n, label: "601", isMigrated: false, remainingValue: 1n },
      { scope: 1n, label: "777", isMigrated: false, remainingValue: 2n },
    ]);
    loadDeclinedLegacyLabelsMock.mockImplementationOnce(async () => new Set(["601"]));

    const legacyAccountService = new AccountService({} as any, {
      account: {
        masterKeys: [1n, 2n],
        poolAccounts: new Map([
          [1n, [{
            label: APPROVED_POOL_ACCOUNT.label as any,
            deposit: APPROVED_POOL_ACCOUNT.commitment,
            children: [],
          }]],
        ]),
        creationTimestamp: 0n,
        lastUpdateTimestamp: 0n,
      } as any,
    });
    AccountService.initializeWithEvents = (async () => ({
      account: {
        account: { poolAccounts: new Map() },
        getSpendableCommitments: () => new Map(),
      },
      legacyAccount: legacyAccountService,
      errors: [],
    })) as typeof AccountService.initializeWithEvents;

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(saveAccountMock).not.toHaveBeenCalled();
    expect(saveSyncMetaMock).not.toHaveBeenCalled();
    expect(stderr).toContain("Legacy recovery state will refresh from chain events");
    expect(stderr).toContain("Ragequit confirmed");
  });

  test("treats prompt cancellations as clean human aborts", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => {
      const error = new Error("cancelled") as Error & { name: string };
      error.name = "AbortPromptError";
      throw error;
    });

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(0);
    expect(stderr).toContain("Operation cancelled.");
  });

  test("lets humans select a Pool Account and cancel before public recovery", async () => {
    useIsolatedHome({ withSigner: true });
    // PA selection prompt returns PA number, then approved-account advisory returns "ragequit"
    selectPromptMock.mockImplementationOnce(async () => 1);
    selectPromptMock.mockImplementationOnce(async () => "ragequit");
    inputPromptMock.mockImplementationOnce(async () => "");

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(selectPromptMock).toHaveBeenCalledTimes(2);
    expect(inputPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Ragequit review");
    expect(stderr).toContain("Ragequit returns the full Pool Account balance");
    expect(stderr).toContain("Ragequit cancelled.");
    expect(ragequitMock).not.toHaveBeenCalled();
  });

  test("shows declined-account human guidance before recovery", async () => {
    useIsolatedHome({ withSigner: true });
    const declinedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      status: "declined",
      aspStatus: "declined",
    };
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [declinedPoolAccount]);
    buildPoolAccountRefsMock.mockImplementationOnce(() => [declinedPoolAccount]);
    inputPromptMock.mockImplementationOnce(async () => "");

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("most common next action");
    expect(stderr).toContain("Ragequit cancelled.");
  });

  test("shows incomplete-review guidance for human ragequit selection", async () => {
    useIsolatedHome({ withSigner: true });
    loadAspDepositReviewStateMock.mockImplementationOnce(async () => ({
      approvedLabels: new Set<string>(),
      rawReviewStatuses: new Map<string, string>([["601", "approved"]]),
      reviewStatuses: new Map<string, string>([["601", "approved"]]),
      hasIncompleteReviewData: true,
    }));
    inputPromptMock.mockImplementationOnce(async () => "");

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Review data unavailable. Complete PoA");
    expect(stderr).toContain("Ragequit cancelled.");
  });

  test("requires explicit Pool Account selection in machine mode", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        { unsigned: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Must specify --pool-account",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects unsupported unsigned output formats before building proofs", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: "raw" as "raw",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      'Unsupported unsigned format: "raw"',
    );
    expect(exitCode).toBe(2);
  });

  test("requires an asset in machine mode when none is provided", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        undefined,
        { unsigned: true, poolAccount: "PA-1" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MISSING_ASSET");
    expect(json.error.message ?? json.errorMessage).toContain("No asset specified");
    expect(exitCode).toBe(2);
  });

  test("lets humans choose an asset interactively when none is provided", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementation(async () => [ETH_POOL]);
    selectPromptMock.mockImplementationOnce(async () => ETH_POOL.asset);
    selectPromptMock.mockImplementationOnce(async () => 1);
    // The approved-account advisory prompt (2D) adds a 3rd select call
    selectPromptMock.mockImplementationOnce(async () => "ragequit");

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(selectPromptMock).toHaveBeenCalledTimes(3);
    expect(ragequitMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Summary:");
    expect(stderr).toContain("Pool Account: PA-1");
  });

  test("lets humans switch approved Pool Accounts back to private withdrawal", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => 1);
    selectPromptMock.mockImplementationOnce(async () => "withdraw");

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain(
      "privacy-pools withdraw --pool-account PA-1 --to <recipient>",
    );
    expect(ragequitMock).not.toHaveBeenCalled();
  });

  test("shows an exact-case token hint when human ragequit confirmation does not match", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => 1);
    selectPromptMock.mockImplementationOnce(async () => "ragequit");
    inputPromptMock.mockImplementation(async () => "ragequit");

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Expected 'RAGEQUIT' (exact case).");
    expect(stderr).toContain("Ragequit cancelled.");
    expect(ragequitMock).not.toHaveBeenCalled();
  });

  test("requires explicit privacy-loss acknowledgement in machine mode", async () => {
    useIsolatedHome({ withSigner: true });
    const pendingPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 2,
      paId: "PA-2",
      status: "pending",
      aspStatus: "pending",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 502n,
        label: 602n,
        txHash: "0x" + "bb".repeat(32),
      },
      label: 602n,
      txHash: "0x" + "bb".repeat(32),
    };
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [pendingPoolAccount]);
    buildPoolAccountRefsMock.mockImplementationOnce(() => [pendingPoolAccount]);

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-2",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_RAGEQUIT_CONFIRMATION_REQUIRED");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Ragequit requires explicit privacy-loss acknowledgement in non-interactive mode.",
    );
    expect(json.error.hint).toContain("--confirm-ragequit");
    expect(exitCode).toBe(2);
    expect(ragequitMock).not.toHaveBeenCalled();
  });

  test("requires an interactive terminal for human ragequit confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    setTestTty({ stdin: false, stdout: false, stderr: false });
    const pendingPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 2,
      paId: "PA-2",
      status: "pending",
      aspStatus: "pending",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 502n,
        label: 602n,
        txHash: "0x" + "bb".repeat(32),
      },
      label: 602n,
      txHash: "0x" + "bb".repeat(32),
    };
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [pendingPoolAccount]);
    buildPoolAccountRefsMock.mockImplementationOnce(() => [pendingPoolAccount]);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-2",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Ragequit requires an interactive terminal.");
    expect(stderr).toContain("--confirm-ragequit or --agent");
    expect(exitCode).toBe(2);
    expect(ragequitMock).not.toHaveBeenCalled();
  });

  test("interactive asset selection re-resolves the chosen pool before ragequit execution", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementation(async () => [
      {
        ...ETH_POOL,
        pool: "0x9999999999999999999999999999999999999999",
      },
    ]);
    resolvePoolMock.mockImplementationOnce(async () => ETH_POOL);
    selectPromptMock.mockImplementationOnce(async () => ETH_POOL.asset);
    selectPromptMock.mockImplementationOnce(async () => 1);
    // The approved-account advisory prompt (2D)
    selectPromptMock.mockImplementationOnce(async () => "ragequit");

    await captureAsyncOutput(() =>
      handleRagequitCommand(
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(resolvePoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet", id: 1 }),
      ETH_POOL.asset,
      undefined,
    );
    expect(ragequitMock).toHaveBeenCalledTimes(1);
  });

  test("fails cleanly for humans when no pools are available to choose from", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementation(async () => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        undefined,
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("No pools found on mainnet");
    expect(ragequitMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("surfaces a targeted error when a requested Pool Account is unknown", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-9",
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Unknown Pool Account");
    expect(exitCode).toBe(2);
  });

  test("surfaces unavailable historical Pool Accounts through a targeted INPUT error", async () => {
    useIsolatedHome();
    buildPoolAccountRefsMock.mockImplementation(() => []);
    describeUnavailablePoolAccountMock.mockImplementation(() =>
      "PA-1 has already been exited.",
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "already been exited",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when waiting for ragequit confirmation times out", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementation(() => ({
      readContract: async () => "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
      waitForTransactionReceipt: async () => {
        throw new Error("timeout");
      },
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_NETWORK_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for ragequit confirmation",
    );
    expect(json.error.details.txHash).toBe(`0x${"12".repeat(32)}`);
    expect(exitCode).toBe(3);
  });

  test("fails closed when the ragequit transaction reverts onchain", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementation(() => ({
      readContract: async () => "0x19E7E376E7C213B7E7E7E46CC70A5DD086DAFF2A",
      waitForTransactionReceipt: async () => ({
        status: "reverted",
        blockNumber: 987n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("CONTRACT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Ragequit transaction reverted",
    );
    expect(exitCode).toBe(7);
  });

  test("continues when local ragequit event recording fails", async () => {
    useIsolatedHome({ withSigner: true });
    initializeAccountServiceMock.mockImplementation(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
      addRagequitToAccount: mock(() => {
        throw new Error("event write failed");
      }),
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        { poolAccount: "PA-1" },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Failed to record ragequit locally");
    expect(stderr).toContain("Summary:");
    expect(stderr).toContain("Pool Account: PA-1");
  });

  test("continues when saving local ragequit state fails after confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleRagequitCommand(
        "ETH",
        { poolAccount: "PA-1" },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("failed to save local state");
    expect(stderr).toContain("privacy-pools sync --chain mainnet");
    expect(stderr).toContain("Summary:");
    expect(stderr).toContain("Pool Account: PA-1");
  });

  test("fails closed when onchain depositor preverification is unavailable in human mode", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementation(() => ({
      readContract: async () => {
        throw new Error("rpc unavailable");
      },
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 987n,
      }),
    }));

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        { poolAccount: "PA-1" },
        fakeCommand({ chain: "mainnet", verbose: true }),
      ),
    );

    expect(stderr).toContain("Unable to verify the original depositor for ragequit");
    expect(stderr).toContain(
      "Ragequit transactions must be sent by the original deposit address",
    );
    expect(exitCode).toBe(3);
  });

  test("fails closed when unsigned ragequit cannot determine the original depositor", async () => {
    useIsolatedHome();
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => {
        throw new Error("rpc unavailable");
      },
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 987n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          unsigned: true,
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Unable to determine the original depositor for unsigned ragequit",
    );
    expect(exitCode).toBe(3);
  });

  test("updates ragequit status callbacks while simulating and broadcasting", async () => {
    useIsolatedHome({ withSigner: true });
    const statusEvents: string[] = [];
    ragequitMock.mockImplementationOnce(async (...args) => {
      const hooks = args[5] as
        | {
            onSimulating?: () => void;
            onBroadcasting?: () => void;
          }
        | undefined;
      hooks?.onSimulating?.();
      statusEvents.push("simulating");
      hooks?.onBroadcasting?.();
      statusEvents.push("broadcasting");
      return {
        hash: "0x" + "12".repeat(32),
      };
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handleRagequitCommand(
        "ETH",
        {
          poolAccount: "PA-1",
          confirmRagequit: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(statusEvents).toEqual(["simulating", "broadcasting"]);
  });

}
