import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realErrors = captureModuleExports(
  await import("../../src/utils/errors.ts"),
);
const realMode = captureModuleExports(await import("../../src/utils/mode.ts"));
const realOutputCommon = captureModuleExports(
  await import("../../src/output/common.ts"),
);
const realFlowOutput = captureModuleExports(
  await import("../../src/output/flow.ts"),
);
const realWorkflow = captureModuleExports(
  await import("../../src/services/workflow.ts"),
);

const FLOW_MODULE_RESTORES = [
  ["../../src/output/common.ts", realOutputCommon],
  ["../../src/output/flow.ts", realFlowOutput],
  ["../../src/services/workflow.ts", realWorkflow],
  ["../../src/utils/mode.ts", realMode],
  ["../../src/utils/errors.ts", realErrors],
] as const;

const ctx = { mode: "test" };
const startSnapshot = { workflowId: "wf-start", phase: "awaiting_asp" };
const watchSnapshot = { workflowId: "wf-watch", phase: "completed" };
const statusSnapshot = { workflowId: "wf-status", phase: "paused_declined" };
const ragequitSnapshot = {
  workflowId: "wf-ragequit",
  phase: "completed_public_recovery",
};
class MockFlowCancelledError extends Error {}

const createOutputContextMock = mock(() => ctx);
const renderFlowResultMock = mock(() => undefined);
const startWorkflowMock = mock(async () => startSnapshot);
const watchWorkflowMock = mock(async () => watchSnapshot);
const getWorkflowStatusMock = mock(() => statusSnapshot);
const ragequitWorkflowMock = mock(async () => ragequitSnapshot);
const resolveGlobalModeMock = mock((globalOpts: Record<string, unknown> = {}) => ({
  isAgent: Boolean(globalOpts.agent),
  isJson: Boolean(globalOpts.json),
  isCsv: false,
  isQuiet: Boolean(globalOpts.quiet),
  format: "json",
  skipPrompts: true,
}));
const printErrorMock = mock(() => undefined);

let handleFlowStartCommand: typeof import("../../src/commands/flow.ts").handleFlowStartCommand;
let handleFlowWatchCommand: typeof import("../../src/commands/flow.ts").handleFlowWatchCommand;
let handleFlowStatusCommand: typeof import("../../src/commands/flow.ts").handleFlowStatusCommand;
let handleFlowRagequitCommand: typeof import("../../src/commands/flow.ts").handleFlowRagequitCommand;

async function loadFlowHandlers(): Promise<void> {
  installModuleMocks([
    ["../../src/output/common.ts", () => ({
      ...realOutputCommon,
      createOutputContext: createOutputContextMock,
    })],
    ["../../src/output/flow.ts", () => ({
      renderFlowResult: renderFlowResultMock,
    })],
    ["../../src/services/workflow.ts", () => ({
      FlowCancelledError: MockFlowCancelledError,
      getWorkflowStatus: getWorkflowStatusMock,
      ragequitWorkflow: ragequitWorkflowMock,
      startWorkflow: startWorkflowMock,
      watchWorkflow: watchWorkflowMock,
    })],
    ["../../src/utils/mode.ts", () => ({
      ...realMode,
      resolveGlobalMode: resolveGlobalModeMock,
    })],
    ["../../src/utils/errors.ts", () => ({
      ...realErrors,
      printError: printErrorMock,
    })],
  ]);

  const flowModule = await import("../../src/commands/flow.ts");
  ({
    handleFlowStartCommand,
    handleFlowWatchCommand,
    handleFlowStatusCommand,
    handleFlowRagequitCommand,
  } = flowModule);
}

function fakeCommand(globalOpts: Record<string, unknown>): Command {
  return {
    optsWithGlobals: () => globalOpts,
  } as unknown as Command;
}

function clearMockCalls(fn: {
  mock?: {
    calls?: unknown[];
    results?: unknown[];
    contexts?: unknown[];
    instances?: unknown[];
  };
}): void {
  fn.mock?.calls?.splice(0);
  fn.mock?.results?.splice(0);
  fn.mock?.contexts?.splice(0);
  fn.mock?.instances?.splice(0);
}

afterEach(() => {
  restoreModuleImplementations(FLOW_MODULE_RESTORES);
});

describe("flow command handlers", () => {
  beforeEach(async () => {
    mock.restore();
    clearMockCalls(createOutputContextMock);
    clearMockCalls(renderFlowResultMock);
    clearMockCalls(startWorkflowMock);
    clearMockCalls(watchWorkflowMock);
    clearMockCalls(getWorkflowStatusMock);
    clearMockCalls(ragequitWorkflowMock);
    clearMockCalls(resolveGlobalModeMock);
    clearMockCalls(printErrorMock);

    await loadFlowHandlers();
  });

  test("start forwards workflow options and renders the result", async () => {
    const cmd = fakeCommand({ chain: "sepolia", json: true, verbose: true });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        watch: true,
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
      },
      cmd,
    );

    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInput: "0.1",
        assetInput: "ETH",
        recipient: "0x4444444444444444444444444444444444444444",
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
        globalOpts: expect.objectContaining({ chain: "sepolia", json: true }),
        isVerbose: true,
        watch: true,
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "start",
      snapshot: startSnapshot,
    });
  });

  test("start reports a structured INPUT error when --to is missing", async () => {
    const cmd = fakeCommand({ json: true });

    await handleFlowStartCommand("0.1", "ETH", {}, cmd);

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Missing required --to <address>.",
    );
    expect(isJson).toBe(true);
  });

  test("start rejects --export-new-wallet without --new-wallet before calling the service", async () => {
    const cmd = fakeCommand({ json: true });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        exportNewWallet: "/tmp/flow-wallet.txt",
      },
      cmd,
    );

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "--export-new-wallet requires --new-wallet.",
    );
    expect(isJson).toBe(true);
  });

  test("JSON mode converts flow cancellation into a structured INPUT error", async () => {
    startWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });
    const cmd = fakeCommand({ json: true });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
      },
      cmd,
    );

    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Flow cancelled.",
    );
    expect((error as InstanceType<typeof realErrors.CLIError>).category).toBe(
      "INPUT",
    );
    expect(isJson).toBe(true);
  });

  test("human mode swallows flow cancellation without rendering or printing an error", async () => {
    startWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });
    const cmd = fakeCommand({});

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
      },
      cmd,
    );

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("watch delegates to the workflow service and renders the snapshot", async () => {
    const cmd = fakeCommand({ chain: "sepolia" });

    await handleFlowWatchCommand("wf-watch", undefined, cmd);

    expect(watchWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-watch",
        globalOpts: expect.objectContaining({ chain: "sepolia" }),
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "watch",
      snapshot: watchSnapshot,
    });
  });

  test("watch converts flow cancellation into a structured INPUT error in JSON mode", async () => {
    watchWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Flow cancelled.",
    );
    expect(isJson).toBe(true);
  });

  test("watch forwards non-cancellation failures to printError", async () => {
    const boom = new Error("watch exploded");
    watchWorkflowMock.mockImplementationOnce(async () => {
      throw boom;
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(boom, true);
  });

  test("status loads the snapshot and renders the status action", async () => {
    const cmd = fakeCommand({ quiet: true });

    await handleFlowStatusCommand("wf-status", undefined, cmd);

    expect(getWorkflowStatusMock).toHaveBeenCalledWith({ workflowId: "wf-status" });
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "status",
      snapshot: statusSnapshot,
    });
  });

  test("status forwards lookup failures through printError", async () => {
    const boom = new Error("status exploded");
    getWorkflowStatusMock.mockImplementationOnce(() => {
      throw boom;
    });

    await handleFlowStatusCommand("wf-status", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(boom, true);
  });

  test("ragequit delegates to the workflow service and renders recovery output", async () => {
    const cmd = fakeCommand({ chain: "sepolia" });

    await handleFlowRagequitCommand("wf-ragequit", undefined, cmd);

    expect(ragequitWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-ragequit",
        globalOpts: expect.objectContaining({ chain: "sepolia" }),
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "ragequit",
      snapshot: ragequitSnapshot,
    });
  });

  test("ragequit swallows flow cancellation in human mode", async () => {
    ragequitWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({}));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
  });
});
