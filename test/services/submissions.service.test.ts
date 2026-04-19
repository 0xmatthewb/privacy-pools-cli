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
import { TransactionReceiptNotFoundError, type Hex } from "viem";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));

const getTransactionReceiptMock = mock(async () => ({
  blockNumber: 12345678n,
  status: "success" as const,
}));
const getPublicClientMock = mock(() => ({
  getTransactionReceipt: getTransactionReceiptMock,
}));

let createSubmissionRecord: typeof import("../../src/services/submissions.ts").createSubmissionRecord;
let loadSubmissionRecord: typeof import("../../src/services/submissions.ts").loadSubmissionRecord;
let refreshSubmissionRecord: typeof import("../../src/services/submissions.ts").refreshSubmissionRecord;
let listSubmissionIds: typeof import("../../src/services/submissions.ts").listSubmissionIds;
let saveSubmissionRecord: typeof import("../../src/services/submissions.ts").saveSubmissionRecord;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const TX_HASH = ("0x" + "ab".repeat(32)) as Hex;
const ALT_TX_HASH = ("0x" + "cd".repeat(32)) as Hex;

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-submissions-");
  process.env.PRIVACY_POOLS_HOME = home;
  return home;
}

beforeAll(async () => {
  installModuleMocks([
    [
      "../../src/services/sdk.ts",
      () => ({
        ...realSdk,
        getPublicClient: getPublicClientMock,
      }),
    ],
  ]);

  ({
    createSubmissionRecord,
    loadSubmissionRecord,
    refreshSubmissionRecord,
    listSubmissionIds,
    saveSubmissionRecord,
  } = await import("../../src/services/submissions.ts?submission-service-tests"));
});

beforeEach(() => {
  getPublicClientMock.mockClear();
  getTransactionReceiptMock.mockClear();
  getTransactionReceiptMock.mockImplementation(async () => ({
    blockNumber: 12345678n,
    status: "success" as const,
  }));
});

afterEach(() => {
  mock.restore();
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  cleanupTrackedTempDirs();
});

afterAll(() => {
  restoreModuleImplementations([
    ["../../src/services/sdk.ts", realSdk],
  ]);
});

describe("submission persistence + refresh", () => {
  test("createSubmissionRecord persists records and listSubmissionIds sorts by updatedAt", () => {
    useIsolatedHome();

    const first = createSubmissionRecord({
      submissionId: "sub-older",
      operation: "deposit",
      sourceCommand: "deposit",
      chain: "mainnet",
      asset: "ETH",
      workflowId: "wf-deposit-1",
      transactions: [{ description: "Deposit transaction", txHash: TX_HASH }],
    });
    const second = createSubmissionRecord({
      submissionId: "sub-newer",
      operation: "withdraw",
      sourceCommand: "withdraw",
      chain: "mainnet",
      asset: "ETH",
      recipient: "0x1111111111111111111111111111111111111111",
      transactions: [{ description: "Withdrawal transaction", txHash: ALT_TX_HASH }],
    });

    saveSubmissionRecord({
      ...first,
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    saveSubmissionRecord({
      ...second,
      updatedAt: "2025-01-01T00:00:00.000Z",
    });

    const loaded = loadSubmissionRecord("sub-older");
    expect(loaded.workflowId).toBe("wf-deposit-1");
    expect(loaded.status).toBe("submitted");
    expect(listSubmissionIds()).toEqual(["sub-newer", "sub-older"]);
  });

  test("refreshSubmissionRecord marks confirmed receipts and persists explorer metadata", async () => {
    useIsolatedHome();
    createSubmissionRecord({
      submissionId: "sub-confirmed",
      operation: "deposit",
      sourceCommand: "deposit",
      chain: "mainnet",
      asset: "ETH",
      workflowId: "wf-deposit-2",
      transactions: [{ description: "Deposit transaction", txHash: TX_HASH }],
    });

    const refreshed = await refreshSubmissionRecord("sub-confirmed");

    expect(getPublicClientMock).toHaveBeenCalledTimes(1);
    expect(getTransactionReceiptMock).toHaveBeenCalledWith({ hash: TX_HASH });
    expect(refreshed.status).toBe("confirmed");
    expect(refreshed.transactions[0]?.status).toBe("confirmed");
    expect(refreshed.transactions[0]?.blockNumber).toBe("12345678");
    expect(refreshed.transactions[0]?.explorerUrl).toContain(TX_HASH);

    const persisted = loadSubmissionRecord("sub-confirmed");
    expect(persisted.transactions[0]?.status).toBe("confirmed");
    expect(persisted.transactions[0]?.blockNumber).toBe("12345678");
  });

  test("refreshSubmissionRecord keeps submissions pending when the receipt is not found yet", async () => {
    useIsolatedHome();
    createSubmissionRecord({
      submissionId: "sub-pending",
      operation: "broadcast",
      sourceCommand: "broadcast",
      chain: "mainnet",
      transactions: [{ description: "Broadcast transaction", txHash: ALT_TX_HASH }],
    });
    getTransactionReceiptMock.mockImplementation(async ({ hash }: { hash: Hex }) => {
      throw new TransactionReceiptNotFoundError({ hash });
    });

    const refreshed = await refreshSubmissionRecord("sub-pending");

    expect(refreshed.status).toBe("submitted");
    expect(refreshed.transactions[0]?.status).toBe("submitted");
    expect(refreshed.transactions[0]?.blockNumber).toBeNull();
    expect(refreshed.transactions[0]?.explorerUrl).toContain(ALT_TX_HASH);
  });

  test("loadSubmissionRecord fails closed for unknown submission ids", () => {
    useIsolatedHome();

    expect(() => loadSubmissionRecord("missing-submission")).toThrow(
      "Unknown submission: missing-submission",
    );
  });
});
