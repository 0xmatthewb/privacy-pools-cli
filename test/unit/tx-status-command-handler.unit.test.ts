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

const realSubmissions = captureModuleExports(
  await import("../../src/services/submissions.ts"),
);
const realTxStatusOutput = captureModuleExports(
  await import("../../src/output/tx-status.ts"),
);
const realErrors = captureModuleExports(await import("../../src/utils/errors.ts"));

const refreshSubmissionRecordMock = mock(async () => ({
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
}));
const updateSubmissionRecordMock = mock((_: string, patch: Record<string, unknown>) => patch);
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
      "../../src/services/submissions.ts",
      () => ({
        ...realSubmissions,
        refreshSubmissionRecord: refreshSubmissionRecordMock,
        updateSubmissionRecord: updateSubmissionRecordMock,
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
  refreshSubmissionRecordMock.mockClear();
  updateSubmissionRecordMock.mockClear();
  renderTxStatusMock.mockClear();
  printErrorMock.mockClear();
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  restoreModuleImplementations([
    ["../../src/services/submissions.ts", realSubmissions],
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
});
