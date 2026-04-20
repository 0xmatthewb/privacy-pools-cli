import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import { CLIError } from "../../src/utils/errors.ts";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realPersistWithReconciliation = captureModuleExports(
  await import("../../src/services/persist-with-reconciliation.ts"),
);
const realPools = captureModuleExports(await import("../../src/services/pools.ts"));
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realSubmissions = captureModuleExports(
  await import("../../src/services/submissions.ts"),
);
const realWallet = captureModuleExports(
  await import("../../src/services/wallet.ts"),
);
const realWorkflow = captureModuleExports(
  await import("../../src/services/workflow.ts"),
);
const realPoolAccounts = captureModuleExports(
  await import("../../src/utils/pool-accounts.ts"),
);
const realTxStatusOutput = captureModuleExports(
  await import("../../src/output/tx-status.ts"),
);
const realErrors = captureModuleExports(await import("../../src/utils/errors.ts"));

const LOCAL_STATE_RECONCILIATION_WARNING_CODE =
  "LOCAL_STATE_RECONCILIATION_REQUIRED";
const DEFAULT_MNEMONIC =
  "test test test test test test test test test test test junk";
const DEFAULT_POOL = {
  pool: "0x" + "11".repeat(20),
  scope: 99n,
  deploymentBlock: 123n,
};
const DEFAULT_ACCOUNT_SERVICE = {
  account: { id: "account-1" },
  getSpendableCommitments: () =>
    new Map([[DEFAULT_POOL.scope, [{ commitment: "c1" }]]]),
};

let currentRecord = {
  schemaVersion: "1" as const,
  submissionId: "sub-123",
  createdAt: "2026-04-18T12:00:00.000Z",
  updatedAt: "2026-04-18T12:00:00.000Z",
  operation: "deposit" as const,
  sourceCommand: "deposit",
  chain: "mainnet",
  asset: "ETH",
  workflowId: "wf-123",
  poolAccountId: null,
  poolAccountNumber: null,
  recipient: null,
  broadcastMode: null,
  broadcastSourceOperation: null,
  status: "submitted" as const,
  reconciliationRequired: false,
  localStateSynced: false,
  warningCode: null,
  lastError: null,
  transactions: [
    {
      index: 0,
      description: "Deposit transaction",
      txHash: "0x" + "ab".repeat(32),
      explorerUrl: null,
      blockNumber: null,
      status: "submitted" as const,
    },
  ],
};

function makeRecord(
  overrides: Partial<typeof currentRecord> = {},
): typeof currentRecord {
  return {
    ...currentRecord,
    ...overrides,
    transactions:
      overrides.transactions?.map((transaction, index) => ({
        ...transaction,
        index,
      })) ?? currentRecord.transactions,
  };
}

const refreshSubmissionRecordMock = mock(async () => ({ ...currentRecord }));
const updateSubmissionRecordMock = mock(
  (_: string, patch: Record<string, unknown>) => {
    currentRecord = {
      ...currentRecord,
      ...patch,
      transactions: (patch.transactions as typeof currentRecord.transactions | undefined)
        ?? currentRecord.transactions,
    };
    return { ...currentRecord };
  },
);
const withSuppressedSdkStdoutSyncMock = mock((fn: () => unknown) => fn());
const initializeAccountServiceMock = mock(async () => DEFAULT_ACCOUNT_SERVICE);
const persistWithReconciliationMock = mock(async () => ({
  reconciliationRequired: false,
  localStateSynced: true,
  warningCode: null,
}));
const resolvePoolMock = mock(async () => DEFAULT_POOL);
const getDataServiceMock = mock(async () => ({ kind: "data-service" }));
const loadMnemonicMock = mock(() => DEFAULT_MNEMONIC);
const loadWorkflowSnapshotMock = mock(() => ({
  workflowId: "wf-123",
  workflowKind: "deposit_review",
  depositTxHash: null,
  depositBlockNumber: null,
  depositExplorerUrl: null,
}));
const clearLastErrorMock = mock((snapshot: Record<string, unknown>) => ({
  ...snapshot,
  lastError: null,
}));
const updateSnapshotMock = mock(
  (
    snapshot: Record<string, unknown>,
    patch: Record<string, unknown>,
  ) => ({ ...snapshot, ...patch }),
);
const saveWorkflowSnapshotIfChangedMock = mock(() => undefined);
const pickWorkflowPoolAccountMock = mock(() => ({
  poolAccountId: "PA-9",
  poolAccountNumber: 9,
}));
const alignSnapshotToPoolAccountMock = mock(
  (
    snapshot: Record<string, unknown>,
    chainId: number,
    poolAccount: Record<string, unknown>,
  ) => ({
    ...snapshot,
    chainId,
    poolAccountId: poolAccount.poolAccountId,
    poolAccountNumber: poolAccount.poolAccountNumber,
  }),
);
const buildAllPoolAccountRefsMock = mock(() => [
  {
    poolAccountId: "PA-9",
    poolAccountNumber: 9,
  },
]);
const renderTxStatusMock = mock(() => undefined);
const printErrorMock = mock(() => undefined);

let handleTxStatusCommand: typeof import("../../src/commands/tx-status.ts").handleTxStatusCommand;

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
  } as unknown as Command;
}

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: fakeRoot(globalOpts),
  } as unknown as Command;
}

beforeAll(async () => {
  installModuleMocks([
    [
      "../../src/services/account.ts",
      () => ({
        ...realAccount,
        initializeAccountService: initializeAccountServiceMock,
        withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
      }),
    ],
    [
      "../../src/services/persist-with-reconciliation.ts",
      () => ({
        ...realPersistWithReconciliation,
        persistWithReconciliation: persistWithReconciliationMock,
      }),
    ],
    [
      "../../src/services/pools.ts",
      () => ({
        ...realPools,
        resolvePool: resolvePoolMock,
      }),
    ],
    [
      "../../src/services/sdk.ts",
      () => ({
        ...realSdk,
        getDataService: getDataServiceMock,
      }),
    ],
    [
      "../../src/services/submissions.ts",
      () => ({
        ...realSubmissions,
        refreshSubmissionRecord: refreshSubmissionRecordMock,
        updateSubmissionRecord: updateSubmissionRecordMock,
      }),
    ],
    [
      "../../src/services/wallet.ts",
      () => ({
        ...realWallet,
        loadMnemonic: loadMnemonicMock,
      }),
    ],
    [
      "../../src/services/workflow.ts",
      () => ({
        ...realWorkflow,
        alignSnapshotToPoolAccount: alignSnapshotToPoolAccountMock,
        clearLastError: clearLastErrorMock,
        loadWorkflowSnapshot: loadWorkflowSnapshotMock,
        pickWorkflowPoolAccount: pickWorkflowPoolAccountMock,
        saveWorkflowSnapshotIfChanged: saveWorkflowSnapshotIfChangedMock,
        updateSnapshot: updateSnapshotMock,
      }),
    ],
    [
      "../../src/utils/pool-accounts.ts",
      () => ({
        ...realPoolAccounts,
        buildAllPoolAccountRefs: buildAllPoolAccountRefsMock,
      }),
    ],
    [
      "../../src/output/tx-status.ts",
      () => ({
        ...realTxStatusOutput,
        renderTxStatus: renderTxStatusMock,
      }),
    ],
    [
      "../../src/utils/errors.ts",
      () => ({
        ...realErrors,
        printError: printErrorMock,
      }),
    ],
  ]);

  ({ handleTxStatusCommand } = await import(
    "../../src/commands/tx-status.ts?tx-status-command-handler-tests"
  ));
});

beforeEach(() => {
  currentRecord = makeRecord({
    operation: "deposit",
    sourceCommand: "deposit",
    status: "submitted",
    localStateSynced: false,
    reconciliationRequired: false,
    warningCode: null,
    lastError: null,
    transactions: [
      {
        index: 0,
        description: "Deposit transaction",
        txHash: "0x" + "ab".repeat(32),
        explorerUrl: null,
        blockNumber: null,
        status: "submitted" as const,
      },
    ],
  });
  refreshSubmissionRecordMock.mockClear();
  updateSubmissionRecordMock.mockClear();
  withSuppressedSdkStdoutSyncMock.mockClear();
  initializeAccountServiceMock.mockClear();
  persistWithReconciliationMock.mockClear();
  resolvePoolMock.mockClear();
  getDataServiceMock.mockClear();
  loadMnemonicMock.mockClear();
  loadWorkflowSnapshotMock.mockClear();
  clearLastErrorMock.mockClear();
  updateSnapshotMock.mockClear();
  saveWorkflowSnapshotIfChangedMock.mockClear();
  pickWorkflowPoolAccountMock.mockClear();
  alignSnapshotToPoolAccountMock.mockClear();
  buildAllPoolAccountRefsMock.mockClear();
  renderTxStatusMock.mockClear();
  printErrorMock.mockClear();

  refreshSubmissionRecordMock.mockImplementation(async () => ({ ...currentRecord }));
  updateSubmissionRecordMock.mockImplementation(
    (_: string, patch: Record<string, unknown>) => {
      currentRecord = {
        ...currentRecord,
        ...patch,
        transactions:
          (patch.transactions as typeof currentRecord.transactions | undefined)
          ?? currentRecord.transactions,
      };
      return { ...currentRecord };
    },
  );
  initializeAccountServiceMock.mockImplementation(async () => DEFAULT_ACCOUNT_SERVICE);
  persistWithReconciliationMock.mockImplementation(async () => ({
    reconciliationRequired: false,
    localStateSynced: true,
    warningCode: null,
  }));
  resolvePoolMock.mockImplementation(async () => DEFAULT_POOL);
  getDataServiceMock.mockImplementation(async () => ({ kind: "data-service" }));
  loadMnemonicMock.mockImplementation(() => DEFAULT_MNEMONIC);
  loadWorkflowSnapshotMock.mockImplementation(() => ({
    workflowId: "wf-123",
    workflowKind: "deposit_review",
    depositTxHash: null,
    depositBlockNumber: null,
    depositExplorerUrl: null,
  }));
  clearLastErrorMock.mockImplementation((snapshot: Record<string, unknown>) => ({
    ...snapshot,
    lastError: null,
  }));
  updateSnapshotMock.mockImplementation(
    (
      snapshot: Record<string, unknown>,
      patch: Record<string, unknown>,
    ) => ({ ...snapshot, ...patch }),
  );
  pickWorkflowPoolAccountMock.mockImplementation(() => ({
    poolAccountId: "PA-9",
    poolAccountNumber: 9,
  }));
  alignSnapshotToPoolAccountMock.mockImplementation(
    (
      snapshot: Record<string, unknown>,
      chainId: number,
      poolAccount: Record<string, unknown>,
    ) => ({
      ...snapshot,
      chainId,
      poolAccountId: poolAccount.poolAccountId,
      poolAccountNumber: poolAccount.poolAccountNumber,
    }),
  );
  buildAllPoolAccountRefsMock.mockImplementation(() => [
    {
      poolAccountId: "PA-9",
      poolAccountNumber: 9,
    },
  ]);
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  restoreModuleImplementations([
    ["../../src/services/account.ts", realAccount],
    [
      "../../src/services/persist-with-reconciliation.ts",
      realPersistWithReconciliation,
    ],
    ["../../src/services/pools.ts", realPools],
    ["../../src/services/sdk.ts", realSdk],
    ["../../src/services/submissions.ts", realSubmissions],
    ["../../src/services/wallet.ts", realWallet],
    ["../../src/services/workflow.ts", realWorkflow],
    ["../../src/utils/pool-accounts.ts", realPoolAccounts],
    ["../../src/output/tx-status.ts", realTxStatusOutput],
    ["../../src/utils/errors.ts", realErrors],
  ]);
});

describe("tx-status command handler", () => {
  test("refreshes the submission record and renders tx-status output", async () => {
    await handleTxStatusCommand(
      "sub-123",
      {},
      fakeCommand({ json: true, rpcUrl: "https://rpc.example", verbose: true }),
    );

    expect(refreshSubmissionRecordMock).toHaveBeenCalledWith("sub-123", {
      rpcUrl: "https://rpc.example",
    });
    expect(renderTxStatusMock).toHaveBeenCalledTimes(1);
    const [ctx, record] = renderTxStatusMock.mock.calls[0]!;
    expect(ctx.mode.isJson).toBe(true);
    expect(ctx.isVerbose).toBe(true);
    expect(record.submissionId).toBe("sub-123");
    expect(record.status).toBe("submitted");
    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("routes refresh failures through printError using the active structured mode", async () => {
    const error = new CLIError(
      "Unknown submission: missing",
      "INPUT",
      "Run the original command with --no-wait first.",
      "INPUT_UNKNOWN_SUBMISSION",
    );
    refreshSubmissionRecordMock.mockImplementationOnce(async () => {
      throw error;
    });

    await handleTxStatusCommand("missing", {}, fakeCommand({ json: true }));

    expect(renderTxStatusMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(error, true);
  });

  test("reconciles confirmed withdrawals before rendering tx-status output", async () => {
    currentRecord = makeRecord({
      operation: "withdraw",
      sourceCommand: "withdraw",
      workflowId: null,
      status: "confirmed",
      transactions: [
        {
          index: 0,
          description: "Withdraw transaction",
          txHash: "0x" + "cd".repeat(32),
          explorerUrl: "https://etherscan.io/tx/withdraw",
          blockNumber: "123",
          status: "confirmed",
        },
      ],
    });

    await handleTxStatusCommand(
      "sub-123",
      {},
      fakeCommand({ json: true, rpcUrl: "https://rpc.example", verbose: true }),
    );

    expect(resolvePoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet" }),
      "ETH",
      "https://rpc.example",
    );
    expect(loadMnemonicMock).toHaveBeenCalledTimes(1);
    expect(getDataServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet" }),
      DEFAULT_POOL.pool,
      "https://rpc.example",
    );
    expect(initializeAccountServiceMock).toHaveBeenCalledTimes(1);
    expect(persistWithReconciliationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        errorLabel: "Withdrawal reconciliation",
        persistFailureMessage:
          "Withdrawal confirmed onchain but failed to save local state",
        allowLegacyRecoveryVisibility: false,
        warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
      }),
    );
    expect(renderTxStatusMock.mock.calls[0]?.[1]).toMatchObject({
      submissionId: "sub-123",
      localStateSynced: true,
      reconciliationRequired: false,
      lastError: null,
    });
  });

  test("marks confirmed ragequit submissions for reconciliation when persistence fails", async () => {
    currentRecord = makeRecord({
      operation: "ragequit",
      sourceCommand: "ragequit",
      workflowId: null,
      status: "confirmed",
      transactions: [
        {
          index: 0,
          description: "Ragequit transaction",
          txHash: "0x" + "ef".repeat(32),
          explorerUrl: "https://etherscan.io/tx/ragequit",
          blockNumber: "456",
          status: "confirmed",
        },
      ],
    });
    persistWithReconciliationMock.mockImplementationOnce(async () => {
      throw new Error("disk sync failed");
    });

    await handleTxStatusCommand(
      "sub-123",
      {},
      fakeCommand({ json: true, verbose: true }),
    );

    expect(persistWithReconciliationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        errorLabel: "Ragequit reconciliation",
        allowLegacyRecoveryVisibility: true,
      }),
    );
    expect(renderTxStatusMock.mock.calls[0]?.[1]).toMatchObject({
      reconciliationRequired: true,
      localStateSynced: false,
      warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
      lastError: {
        code: "SUBMISSION_RECONCILIATION_FAILED",
        message: "disk sync failed",
      },
    });
  });

  test("adds canonical reverted errors and syncs deposit-review workflows for reverted deposits", async () => {
    currentRecord = makeRecord({
      operation: "deposit",
      sourceCommand: "deposit",
      status: "reverted",
      workflowId: "wf-reverted",
      transactions: [
        {
          index: 0,
          description: "Deposit transaction",
          txHash: "0x" + "12".repeat(32),
          explorerUrl: "https://etherscan.io/tx/reverted",
          blockNumber: "999",
          status: "reverted",
        },
      ],
    });
    loadWorkflowSnapshotMock.mockImplementationOnce(() => ({
      workflowId: "wf-reverted",
      workflowKind: "deposit_review",
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
    }));

    await handleTxStatusCommand("sub-123", {}, fakeCommand({ json: true }));

    expect(updateSubmissionRecordMock).toHaveBeenCalledWith("sub-123", {
      lastError: {
        code: "SUBMISSION_REVERTED",
        message: "Deposit transaction reverted onchain.",
      },
    });
    expect(saveWorkflowSnapshotIfChangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-reverted",
        workflowKind: "deposit_review",
      }),
      expect.objectContaining({
        phase: "stopped_external",
        reconciliationRequired: false,
        localStateSynced: false,
        warningCode: null,
        lastError: expect.objectContaining({
          errorCode: "DEPOSIT_REVERTED",
          retryable: false,
        }),
      }),
    );
    expect(renderTxStatusMock.mock.calls[0]?.[1]).toMatchObject({
      status: "reverted",
      lastError: {
        code: "SUBMISSION_REVERTED",
        message: "Deposit transaction reverted onchain.",
      },
    });
  });

  test("syncs confirmed deposit-review workflows with preferred tx hashes and aligned pool accounts", async () => {
    currentRecord = makeRecord({
      operation: "deposit",
      sourceCommand: "deposit",
      status: "confirmed",
      workflowId: "wf-confirmed",
      transactions: [
        {
          index: 0,
          description: "Initial transaction",
          txHash: "0x" + "34".repeat(32),
          explorerUrl: "https://etherscan.io/tx/initial",
          blockNumber: "10",
          status: "confirmed",
        },
        {
          index: 1,
          description: "Deposit transaction",
          txHash: "0x" + "56".repeat(32),
          explorerUrl: "https://etherscan.io/tx/deposit",
          blockNumber: "11",
          status: "confirmed",
        },
      ],
    });
    loadWorkflowSnapshotMock.mockImplementationOnce(() => ({
      workflowId: "wf-confirmed",
      workflowKind: "deposit_review",
      depositTxHash: `0x${"56".repeat(32).toUpperCase()}`,
      depositBlockNumber: null,
      depositExplorerUrl: null,
    }));

    await handleTxStatusCommand(
      "sub-123",
      {},
      fakeCommand({ json: true, rpcUrl: "https://rpc.example" }),
    );

    expect(withSuppressedSdkStdoutSyncMock).toHaveBeenCalledTimes(1);
    expect(buildAllPoolAccountRefsMock).toHaveBeenCalledWith(
      DEFAULT_ACCOUNT_SERVICE.account,
      DEFAULT_POOL.scope,
      [{ commitment: "c1" }],
    );
    expect(alignSnapshotToPoolAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "awaiting_asp",
        aspStatus: "pending",
        depositBlockNumber: "11",
        depositExplorerUrl: "https://etherscan.io/tx/deposit",
      }),
      1,
      expect.objectContaining({
        poolAccountId: "PA-9",
        poolAccountNumber: 9,
      }),
    );
    expect(saveWorkflowSnapshotIfChangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-confirmed",
      }),
      expect.objectContaining({
        phase: "awaiting_asp",
        aspStatus: "pending",
        poolAccountId: "PA-9",
        poolAccountNumber: 9,
      }),
    );
    expect(renderTxStatusMock.mock.calls[0]?.[1]).toMatchObject({
      workflowId: "wf-confirmed",
      localStateSynced: true,
      reconciliationRequired: false,
    });
  });

  test("skips reconciliation when confirmed broadcast bundles do not map to a source operation", async () => {
    currentRecord = makeRecord({
      operation: "broadcast",
      sourceCommand: "broadcast",
      workflowId: null,
      status: "confirmed",
      broadcastSourceOperation: null,
      transactions: [
        {
          index: 0,
          description: "Broadcast transaction",
          txHash: "0x" + "78".repeat(32),
          explorerUrl: "https://etherscan.io/tx/broadcast",
          blockNumber: "12",
          status: "confirmed",
        },
      ],
    });

    await handleTxStatusCommand("sub-123", {}, fakeCommand({ json: true }));

    expect(resolvePoolMock).not.toHaveBeenCalled();
    expect(persistWithReconciliationMock).not.toHaveBeenCalled();
    expect(renderTxStatusMock.mock.calls[0]?.[1]).toMatchObject({
      operation: "broadcast",
      status: "confirmed",
    });
  });
});
