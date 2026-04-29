import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import { restoreTestTty, setTestTty } from "../helpers/tty.ts";

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
const realFormat = captureModuleExports(
  await import("../../src/utils/format.ts"),
);
const realValidation = captureModuleExports(
  await import("../../src/utils/validation.ts"),
);
const realWorkflow = captureModuleExports(
  await import("../../src/services/workflow.ts"),
);
const realConfigService = captureModuleExports(
  await import("../../src/services/config.ts"),
);
const realPoolsService = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realRecipientHistory = captureModuleExports(
  await import("../../src/services/recipient-history.ts"),
);
const realWalletService = captureModuleExports(
  await import("../../src/services/wallet.ts"),
);
const realPreviewRuntime = captureModuleExports(
  await import("../../src/preview/runtime.ts"),
);
const realWeb = captureModuleExports(await import("../../src/utils/web.ts"));
const realPromptCancellation = captureModuleExports(
  await import("../../src/utils/prompt-cancellation.ts"),
);
const realPromptUtils = captureModuleExports(
  await import("../../src/utils/prompts.ts"),
);
const realSetupRecovery = captureModuleExports(
  await import("../../src/utils/setup-recovery.ts"),
);
const realRecipientSafety = captureModuleExports(
  await import("../../src/utils/recipient-safety.ts"),
);

const FLOW_MODULE_RESTORES = [
  ["../../src/output/common.ts", realOutputCommon],
  ["../../src/output/flow.ts", realFlowOutput],
  ["../../src/utils/format.ts", realFormat],
  ["../../src/utils/validation.ts", realValidation],
  ["../../src/services/workflow.ts", realWorkflow],
  ["../../src/services/config.ts", realConfigService],
  ["../../src/services/pools.ts", realPoolsService],
  ["../../src/services/recipient-history.ts", realRecipientHistory],
  ["../../src/services/wallet.ts", realWalletService],
  ["../../src/utils/mode.ts", realMode],
  ["../../src/utils/errors.ts", realErrors],
  ["../../src/preview/runtime.ts", realPreviewRuntime],
  ["../../src/utils/web.ts", realWeb],
  ["../../src/utils/prompt-cancellation.ts", realPromptCancellation],
  ["../../src/utils/prompts.ts", realPromptUtils],
  ["../../src/utils/setup-recovery.ts", realSetupRecovery],
  ["../../src/utils/recipient-safety.ts", realRecipientSafety],
] as const;

const ctx = { mode: "test" };
const startSnapshot = {
  workflowId: "wf-start",
  phase: "awaiting_asp",
  chain: "sepolia",
  asset: "ETH",
};
const watchSnapshot = {
  workflowId: "wf-watch",
  phase: "completed",
  chain: "sepolia",
  asset: "ETH",
};
const statusSnapshot = {
  workflowId: "wf-status",
  phase: "paused_declined",
  chain: "sepolia",
  asset: "ETH",
};
const ragequitSnapshot = {
  workflowId: "wf-ragequit",
  phase: "completed_public_recovery",
  chain: "sepolia",
  asset: "ETH",
};
const watchLoopStartSnapshot = {
  workflowId: "wf-watch",
  phase: "awaiting_asp",
  chain: "sepolia",
  asset: "ETH",
};
class MockFlowCancelledError extends Error {
  reason: "cancelled" | "detached";

  constructor(
    message: string = "Flow cancelled.",
    reason: "cancelled" | "detached" = "cancelled",
  ) {
    super(message);
    this.reason = reason;
  }
}

const createOutputContextMock = mock(() => ctx);
const renderFlowResultMock = mock(() => undefined);
const renderFlowStartDryRunMock = mock(() => undefined);
const formatFlowRagequitReviewMock = mock(() => "review");
const renderFlowPhaseChangeEventMock = mock(
  (event: Parameters<typeof realFlowOutput.renderFlowPhaseChangeEvent>[0]) =>
    realFlowOutput.renderFlowPhaseChangeEvent(event),
);
const startWorkflowMock = mock(async () => startSnapshot);
const watchWorkflowMock = mock(async () => watchSnapshot);
const stepWorkflowMock = mock(async () => watchSnapshot);
const getWorkflowStatusMock = mock(() => statusSnapshot);
const ragequitWorkflowMock = mock(async () => ragequitSnapshot);
const listSavedWorkflowIdsMock = mock(() => ["wf-latest"]);
const saveWorkflowSnapshotIfChangedWithLockMock = mock(
  async (_current: unknown, next: unknown) => next,
);
const validateWorkflowWalletBackupPathMock = mock((filePath: string) => filePath);
const loadConfigMock = mock(() => ({ defaultChain: "sepolia", rpcOverrides: {} }));
const resolvePoolMock = mock(async () => ({
  symbol: "ETH",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  pool: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  decimals: 18,
  minimumDepositAmount: 100000000000000n,
  vettingFeeBPS: 50n,
  maxRelayFeeBPS: 100n,
}));
const loadKnownRecipientHistoryMock = mock((): string[] => []);
const loadRecipientHistoryEntriesMock = mock(() => []);
const loadPrivateKeyMock = mock(() => {
  throw new realErrors.CLIError("No signer key found.", "INPUT", "Set a signer key.");
});
const getSignerAddressMock = mock(() => "0x9999999999999999999999999999999999999999");
const infoMock = mock(() => undefined);
const inputPromptMock = mock(async () => "0x4444444444444444444444444444444444444444");
const selectPromptMock = mock(async () => "watch");
const resolveSafeRecipientAddressOrEnsMock = mock(
  realRecipientSafety.resolveSafeRecipientAddressOrEns,
);
const resolveGlobalModeMock = mock((globalOpts: Record<string, unknown> = {}) => ({
  isAgent: Boolean(globalOpts.agent),
  isJson: Boolean(globalOpts.json || globalOpts.agent),
  isCsv: false,
  isWide: false,
  isQuiet: Boolean(globalOpts.quiet || globalOpts.agent),
  format: globalOpts.json || globalOpts.agent ? "json" : "table",
  skipPrompts: Boolean(globalOpts.json || globalOpts.agent || globalOpts.yes),
}));
const printErrorMock = mock(() => undefined);
const maybeRenderPreviewScenarioMock = mock(async () => false);
const maybeRecoverMissingWalletSetupMock = mock(async () => false);
const confirmActionWithSeverityMock = mock(async () => true);
const ensurePromptInteractionAvailableMock = mock(() => undefined);
const maybeLaunchBrowserMock = mock(() => undefined);

let handleFlowRootCommand: typeof import("../../src/commands/flow.ts").handleFlowRootCommand;
let handleFlowStartCommand: typeof import("../../src/commands/flow.ts").handleFlowStartCommand;
let handleFlowWatchCommand: typeof import("../../src/commands/flow.ts").handleFlowWatchCommand;
let handleFlowStatusCommand: typeof import("../../src/commands/flow.ts").handleFlowStatusCommand;
let handleFlowStepCommand: typeof import("../../src/commands/flow.ts").handleFlowStepCommand;
let handleFlowRagequitCommand: typeof import("../../src/commands/flow.ts").handleFlowRagequitCommand;

async function loadFlowHandlers(): Promise<void> {
  installModuleMocks([
    ["../../src/output/common.ts", () => ({
      ...realOutputCommon,
      createOutputContext: createOutputContextMock,
    })],
    ["../../src/output/flow.ts", () => ({
      formatFlowRagequitReview: formatFlowRagequitReviewMock,
      renderFlowPhaseChangeEvent: renderFlowPhaseChangeEventMock,
      renderFlowResult: renderFlowResultMock,
      renderFlowStartDryRun: renderFlowStartDryRunMock,
    })],
    ["../../src/utils/format.ts", () => ({
      ...realFormat,
      info: infoMock,
    })],
    ["../../src/utils/validation.ts", () => realValidation],
    ["../../src/services/workflow.ts", () => ({
      ...realWorkflow,
      FlowCancelledError: MockFlowCancelledError,
      getWorkflowStatus: getWorkflowStatusMock,
      listSavedWorkflowIds: listSavedWorkflowIdsMock,
      ragequitWorkflow: ragequitWorkflowMock,
      saveWorkflowSnapshotIfChangedWithLock: saveWorkflowSnapshotIfChangedWithLockMock,
      stepWorkflow: stepWorkflowMock,
      startWorkflow: startWorkflowMock,
      validateWorkflowWalletBackupPath: validateWorkflowWalletBackupPathMock,
      watchWorkflow: watchWorkflowMock,
    })],
    ["../../src/services/config.ts", () => ({
      ...realConfigService,
      loadConfig: loadConfigMock,
    })],
    ["../../src/services/pools.ts", () => ({
      ...realPoolsService,
      resolvePool: resolvePoolMock,
    })],
    ["../../src/services/recipient-history.ts", () => ({
      ...realRecipientHistory,
      loadKnownRecipientHistory: loadKnownRecipientHistoryMock,
      loadRecipientHistoryEntries: loadRecipientHistoryEntriesMock,
    })],
    ["../../src/services/wallet.ts", () => ({
      ...realWalletService,
      getSignerAddress: getSignerAddressMock,
      loadPrivateKey: loadPrivateKeyMock,
    })],
    ["../../src/utils/mode.ts", () => ({
      ...realMode,
      resolveGlobalMode: resolveGlobalModeMock,
    })],
    ["../../src/utils/errors.ts", () => ({
      ...realErrors,
      printError: printErrorMock,
    })],
    ["../../src/preview/runtime.ts", () => ({
      ...realPreviewRuntime,
      maybeRenderPreviewScenario: maybeRenderPreviewScenarioMock,
    })],
    ["../../src/utils/web.ts", () => ({
      ...realWeb,
      maybeLaunchBrowser: maybeLaunchBrowserMock,
    })],
    ["../../src/utils/prompt-cancellation.ts", () => ({
      ...realPromptCancellation,
      ensurePromptInteractionAvailable: ensurePromptInteractionAvailableMock,
    })],
    ["../../src/utils/prompts.ts", () => ({
      ...realPromptUtils,
      confirmActionWithSeverity: confirmActionWithSeverityMock,
      inputPrompt: inputPromptMock,
      selectPrompt: selectPromptMock,
    })],
    ["../../src/utils/setup-recovery.ts", () => ({
      ...realSetupRecovery,
      maybeRecoverMissingWalletSetup: maybeRecoverMissingWalletSetupMock,
    })],
    ["../../src/utils/recipient-safety.ts", () => ({
      ...realRecipientSafety,
      resolveSafeRecipientAddressOrEns: resolveSafeRecipientAddressOrEnsMock,
    })],
  ]);

  if (
    handleFlowRootCommand &&
    handleFlowStartCommand &&
    handleFlowWatchCommand &&
    handleFlowStatusCommand &&
    handleFlowStepCommand &&
    handleFlowRagequitCommand
  ) {
    return;
  }

  const flowModule = await import("../../src/commands/flow.ts");
  ({
    handleFlowRootCommand,
    handleFlowStartCommand,
    handleFlowWatchCommand,
    handleFlowStatusCommand,
    handleFlowStepCommand,
    handleFlowRagequitCommand,
  } = flowModule);
}

function fakeCommand(
  globalOpts: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): Command {
  return {
    optsWithGlobals: () => globalOpts,
    ...extras,
  } as unknown as Command;
}

async function captureStdoutAsync(run: () => Promise<void>): Promise<string> {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

function clearMockCalls(fn: {
  mockReset?: () => unknown;
  mock?: {
    calls?: unknown[];
    results?: unknown[];
    contexts?: unknown[];
    instances?: unknown[];
  };
}): void {
  if (typeof fn.mockReset === "function") {
    fn.mockReset();
    return;
  }
  fn.mock?.calls?.splice(0);
  fn.mock?.results?.splice(0);
  fn.mock?.contexts?.splice(0);
  fn.mock?.instances?.splice(0);
}

function expectPrintedRecoveryCliCommand(expected: string): void {
  expect(printErrorMock).toHaveBeenCalledTimes(1);
  const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
  expect(error).toBeInstanceOf(realErrors.CLIError);
  expect(
    (error as InstanceType<typeof realErrors.CLIError>).extra?.nextActions?.[0]
      ?.cliCommand,
  ).toBe(expected);
  expect(isJson).toBe(true);
}

afterEach(() => {
  restoreTestTty();
  restoreModuleImplementations(FLOW_MODULE_RESTORES);
});

describe("flow command handlers", () => {
  beforeEach(async () => {
    setTestTty();
    mock.restore();
    clearMockCalls(createOutputContextMock);
    clearMockCalls(renderFlowResultMock);
    clearMockCalls(renderFlowStartDryRunMock);
    clearMockCalls(formatFlowRagequitReviewMock);
    clearMockCalls(renderFlowPhaseChangeEventMock);
    clearMockCalls(startWorkflowMock);
    clearMockCalls(watchWorkflowMock);
    clearMockCalls(stepWorkflowMock);
    clearMockCalls(getWorkflowStatusMock);
    clearMockCalls(ragequitWorkflowMock);
    clearMockCalls(listSavedWorkflowIdsMock);
    clearMockCalls(saveWorkflowSnapshotIfChangedWithLockMock);
    clearMockCalls(validateWorkflowWalletBackupPathMock);
    clearMockCalls(loadConfigMock);
    clearMockCalls(resolvePoolMock);
    clearMockCalls(loadKnownRecipientHistoryMock);
    clearMockCalls(loadRecipientHistoryEntriesMock);
    clearMockCalls(loadPrivateKeyMock);
    clearMockCalls(getSignerAddressMock);
    clearMockCalls(infoMock);
    clearMockCalls(inputPromptMock);
    clearMockCalls(selectPromptMock);
    clearMockCalls(resolveSafeRecipientAddressOrEnsMock);
    clearMockCalls(resolveGlobalModeMock);
    clearMockCalls(printErrorMock);
    clearMockCalls(maybeRenderPreviewScenarioMock);
    clearMockCalls(maybeRecoverMissingWalletSetupMock);
    clearMockCalls(confirmActionWithSeverityMock);
    clearMockCalls(ensurePromptInteractionAvailableMock);
    clearMockCalls(maybeLaunchBrowserMock);

    formatFlowRagequitReviewMock.mockImplementation(() => "review");
    createOutputContextMock.mockImplementation(() => ctx);
    renderFlowStartDryRunMock.mockImplementation(() => undefined);
    renderFlowResultMock.mockImplementation(() => undefined);
    renderFlowPhaseChangeEventMock.mockImplementation(
      (event: Parameters<typeof realFlowOutput.renderFlowPhaseChangeEvent>[0]) =>
        realFlowOutput.renderFlowPhaseChangeEvent(event),
    );
    startWorkflowMock.mockImplementation(async () => startSnapshot);
    watchWorkflowMock.mockImplementation(async () => watchSnapshot);
    stepWorkflowMock.mockImplementation(async () => watchSnapshot);
    getWorkflowStatusMock.mockImplementation(() => statusSnapshot);
    ragequitWorkflowMock.mockImplementation(async () => ragequitSnapshot);
    listSavedWorkflowIdsMock.mockImplementation(() => ["wf-latest"]);
    saveWorkflowSnapshotIfChangedWithLockMock.mockImplementation(async (_current, next) => next);
    validateWorkflowWalletBackupPathMock.mockImplementation((filePath: string) => filePath);
    loadConfigMock.mockImplementation(() => ({ defaultChain: "sepolia", rpcOverrides: {} }));
    resolvePoolMock.mockImplementation(async () => ({
      symbol: "ETH",
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      pool: "0x1111111111111111111111111111111111111111",
      scope: 42n,
      decimals: 18,
      minimumDepositAmount: 100000000000000n,
      vettingFeeBPS: 50n,
      maxRelayFeeBPS: 100n,
    }));
    loadKnownRecipientHistoryMock.mockImplementation(() => []);
    loadRecipientHistoryEntriesMock.mockImplementation(() => []);
    loadPrivateKeyMock.mockImplementation(() => {
      throw new realErrors.CLIError("No signer key found.", "INPUT", "Set a signer key.");
    });
    getSignerAddressMock.mockImplementation(() => "0x9999999999999999999999999999999999999999");
    inputPromptMock.mockImplementation(async () => "0x4444444444444444444444444444444444444444");
    selectPromptMock.mockImplementation(async () => "watch");
    resolveSafeRecipientAddressOrEnsMock.mockImplementation(
      realRecipientSafety.resolveSafeRecipientAddressOrEns,
    );
    resolveGlobalModeMock.mockImplementation((globalOpts: Record<string, unknown> = {}) => ({
      isAgent: Boolean(globalOpts.agent),
      isJson: Boolean(globalOpts.json || globalOpts.agent),
      isCsv: false,
      isWide: false,
      isQuiet: Boolean(globalOpts.quiet || globalOpts.agent),
      format: globalOpts.json || globalOpts.agent ? "json" : "table",
      skipPrompts: Boolean(globalOpts.json || globalOpts.agent || globalOpts.yes),
    }));
    printErrorMock.mockImplementation(() => undefined);
    infoMock.mockImplementation(() => undefined);
    maybeRenderPreviewScenarioMock.mockImplementation(async () => false);
    maybeRecoverMissingWalletSetupMock.mockImplementation(async () => false);
    confirmActionWithSeverityMock.mockImplementation(async () => true);
    ensurePromptInteractionAvailableMock.mockImplementation(() => undefined);
    maybeLaunchBrowserMock.mockImplementation(() => undefined);

    await loadFlowHandlers();
  });

  test("root command emits a structured input error in structured mode", async () => {
    const outputHelpMock = mock(() => undefined);

    await handleFlowRootCommand(
      {},
      fakeCommand({ json: true }, { outputHelp: outputHelpMock }),
    );

    expect(outputHelpMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "INPUT_MISSING_FLOW_SUBCOMMAND",
    );
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Use a flow subcommand: start, watch, status, step, or ragequit.",
    );
    expect(isJson).toBe(true);
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(listSavedWorkflowIdsMock).not.toHaveBeenCalled();
  });

  test("root command can start a new flow interactively", async () => {
    selectPromptMock.mockImplementationOnce(async () => "start");
    inputPromptMock
      .mockImplementationOnce(async () => "0.5")
      .mockImplementationOnce(async () => "usdc")
      .mockImplementationOnce(async () => "0x5555555555555555555555555555555555555555");

    await handleFlowRootCommand({}, fakeCommand({}));

    expect(listSavedWorkflowIdsMock).toHaveBeenCalledTimes(2);
    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInput: "0.5",
        assetInput: "USDC",
        recipient: "0x5555555555555555555555555555555555555555",
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "start",
      snapshot: startSnapshot,
      extraWarnings: [],
    });
  });

  test("root command can route to watch, status, and ragequit for the latest workflow", async () => {
    selectPromptMock
      .mockImplementationOnce(async () => "watch")
      .mockImplementationOnce(async () => "status")
      .mockImplementationOnce(async () => "ragequit");
    getWorkflowStatusMock
      .mockImplementationOnce(() => ({
        ...watchLoopStartSnapshot,
        workflowId: "wf-latest",
      }))
      .mockImplementationOnce(() => statusSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => ({
      ...watchSnapshot,
      workflowId: "wf-latest",
    }));

    await handleFlowRootCommand({}, fakeCommand({}));
    await handleFlowRootCommand({}, fakeCommand({}));
    await handleFlowRootCommand({}, fakeCommand({}));

    expect(getWorkflowStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "latest" }),
    );
    expect(stepWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-latest" }),
    );
    expect(ragequitWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "latest" }),
    );
  });

  test("root command can choose another saved workflow and route the selected action", async () => {
    listSavedWorkflowIdsMock.mockImplementationOnce(() => ["wf-latest", "wf-2"]);
    selectPromptMock
      .mockImplementationOnce(async () => "choose_saved")
      .mockImplementationOnce(async () => "wf-2")
      .mockImplementationOnce(async () => "status");
    getWorkflowStatusMock.mockImplementationOnce(() => ({
      ...statusSnapshot,
      workflowId: "wf-2",
    }));

    await handleFlowRootCommand({}, fakeCommand({}));

    expect(getWorkflowStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-2" }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "status",
      snapshot: expect.objectContaining({ workflowId: "wf-2" }),
    });
  });

  test("root command treats prompt cancellation as a clean human stop", async () => {
    selectPromptMock.mockImplementationOnce(async () => {
      const error = new Error("prompt aborted") as Error & { name: string };
      error.name = "ExitPromptError";
      throw error;
    });

    await handleFlowRootCommand({}, fakeCommand({}));

    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith(
      realPromptCancellation.PROMPT_CANCELLATION_MESSAGE,
      false,
    );
  });

  test("start forwards workflow options and renders the result", async () => {
    const cmd = fakeCommand({ chain: "sepolia", json: true, verbose: true });
    const watchedSnapshot = { workflowId: "wf-start", phase: "completed" };
    getWorkflowStatusMock
      .mockImplementationOnce(() => statusSnapshot)
      .mockImplementationOnce(() => ({
        ...watchLoopStartSnapshot,
        workflowId: "wf-start",
        privacyDelayProfile: "strict",
        privacyDelayConfigured: true,
      }));
    stepWorkflowMock.mockImplementationOnce(async () => watchedSnapshot);

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        watch: true,
        privacyDelay: "strict",
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
        privacyDelayProfile: "strict",
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
        globalOpts: expect.objectContaining({ chain: "sepolia", json: true }),
        isVerbose: true,
        watch: false,
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "watch",
      snapshot: watchedSnapshot,
      extraWarnings: [
        expect.objectContaining({
          code: "RECIPIENT_NEW_TO_PROFILE",
          category: "recipient",
        }),
      ],
    });
  });

  test("start treats prior withdrawal recipients as known", async () => {
    const recipient = "0x4444444444444444444444444444444444444444";
    loadKnownRecipientHistoryMock.mockImplementationOnce(() => [recipient]);

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: recipient },
      fakeCommand({ json: true }),
    );

    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "start",
      snapshot: startSnapshot,
      extraWarnings: [],
    });
    expect(confirmActionWithSeverityMock).not.toHaveBeenCalled();
  });

  test("start treats the current signer address as known when available", async () => {
    const recipient = "0x4444444444444444444444444444444444444444";
    loadPrivateKeyMock.mockImplementationOnce(
      () => "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    getSignerAddressMock.mockImplementationOnce(() => recipient);

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: recipient },
      fakeCommand({ json: true }),
    );

    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "start",
      snapshot: startSnapshot,
      extraWarnings: [],
    });
    expect(confirmActionWithSeverityMock).not.toHaveBeenCalled();
  });

  test("start treats saved workflow recipients as known", async () => {
    const recipient = "0x4444444444444444444444444444444444444444";
    getWorkflowStatusMock.mockImplementationOnce(() => ({
      ...statusSnapshot,
      recipient,
    }));

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: recipient },
      fakeCommand({ json: true }),
    );

    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "start",
      snapshot: startSnapshot,
      extraWarnings: [],
    });
    expect(confirmActionWithSeverityMock).not.toHaveBeenCalled();
  });

  test("start asks for a second confirmation for unseen interactive recipients", async () => {
    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: "0x4444444444444444444444444444444444444444" },
      fakeCommand({}),
    );

    expect(confirmActionWithSeverityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "standard",
        standardMessage: "Use this new recipient?",
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "start",
      snapshot: startSnapshot,
      extraWarnings: [],
    });
  });

  test("start returns early when preview output is rendered before prompts", async () => {
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);

    await handleFlowStartCommand("0.1", "ETH", {}, fakeCommand({}));

    expect(inputPromptMock).not.toHaveBeenCalled();
    expect(startWorkflowMock).not.toHaveBeenCalled();
  });

  test("start reports a structured INPUT error when --to is missing", async () => {
    const cmd = fakeCommand({ json: true });

    await handleFlowStartCommand("0.1", "ETH", {}, cmd);

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Missing required --to <address> in non-interactive mode.",
    );
    expect(isJson).toBe(true);
  });

  test("start rejects obvious burn recipients before creating a workflow", async () => {
    const cmd = fakeCommand({ json: true });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: "0x000000000000000000000000000000000000dEaD" },
      cmd,
    );

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Recipient appears to be a burn address.",
    );
    expect(isJson).toBe(true);
  });

  test("start prompts for the recipient in interactive mode when --to is missing", async () => {
    const cmd = fakeCommand({});

    await handleFlowStartCommand("0.1", "ETH", {}, cmd);

    expect(inputPromptMock).toHaveBeenCalledTimes(1);
    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "0x4444444444444444444444444444444444444444",
      }),
    );
    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("start resolves ENS recipients entered interactively", async () => {
    const resolvedRecipient = "0x5555555555555555555555555555555555555555";
    inputPromptMock.mockImplementationOnce(
      async (options?: { validate?: (value: string) => true | string }) => {
        expect(options?.validate?.("alice.eth")).toBe(true);
        return "alice.eth";
      },
    );
    resolveSafeRecipientAddressOrEnsMock.mockImplementationOnce(async () => ({
      address: resolvedRecipient,
      ensName: "alice.eth",
    }));

    await handleFlowStartCommand("0.1", "ETH", {}, fakeCommand({}));

    expect(infoMock).toHaveBeenCalledWith(
      `Resolved alice.eth -> ${resolvedRecipient}`,
      false,
    );
    expect(startWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: resolvedRecipient,
      }),
    );
  });

  test("start fails closed after repeated interactive recipient validation errors", async () => {
    const cmd = fakeCommand({});
    inputPromptMock.mockImplementation(
      async (options?: { validate?: (value: string) => true | string }) => {
        expect(options?.validate?.("alice.eth")).toBe(true);
        return "alice.eth";
      },
    );
    resolveSafeRecipientAddressOrEnsMock.mockImplementation(async () => {
      throw new realErrors.CLIError(
        "Recipient appears to be a burn address.",
        "INPUT",
        "Use a different recipient.",
      );
    });

    await handleFlowStartCommand("0.1", "ETH", {}, cmd);

    expect(inputPromptMock).toHaveBeenCalledTimes(5);
    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Recipient appears to be a burn address.",
    );
    expect(isJson).toBe(false);
  });

  test("start can return after prompting when preview output is rendered post-prompts", async () => {
    maybeRenderPreviewScenarioMock.mockImplementation(async (_commandKey, options) =>
      options?.timing === "after-prompts",
    );

    await handleFlowStartCommand("0.1", "ETH", {}, fakeCommand({}));

    expect(inputPromptMock).toHaveBeenCalledTimes(1);
    expect(startWorkflowMock).not.toHaveBeenCalled();
  });

  test("start treats abrupt prompt closure as a clean human cancellation", async () => {
    const cmd = fakeCommand({});
    inputPromptMock.mockImplementationOnce(async () => {
      const error = new Error("prompt aborted") as Error & { name: string };
      error.name = "ExitPromptError";
      throw error;
    });

    await handleFlowStartCommand("0.1", "ETH", {}, cmd);

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Operation cancelled.", false);
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

  test("start dry-run requires exported workflow wallet backup in agent mode", async () => {
    const cmd = fakeCommand({ agent: true });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        newWallet: true,
        dryRun: true,
      },
      cmd,
    );

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(renderFlowStartDryRunMock).not.toHaveBeenCalled();
    expect(validateWorkflowWalletBackupPathMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Non-interactive workflow wallets require --export-new-wallet <path>.",
    );
    expect(isJson).toBe(true);
  });

  test("start dry-run validates inputs without creating a workflow or wallet backup", async () => {
    const cmd = fakeCommand({ agent: true, chain: "sepolia" });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
        dryRun: true,
      },
      cmd,
    );

    expect(validateWorkflowWalletBackupPathMock).toHaveBeenCalledWith(
      "/tmp/flow-wallet.txt",
    );
    expect(loadConfigMock).toHaveBeenCalledTimes(1);
    expect(resolvePoolMock).toHaveBeenCalledTimes(1);
    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(renderFlowStartDryRunMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        chain: "sepolia",
        asset: "ETH",
        recipient: "0x4444444444444444444444444444444444444444",
        walletMode: "new_wallet",
        privacyDelayProfile: "balanced",
      }),
    );
  });

  test("start dry-run fails closed when the amount is below the pool minimum", async () => {
    const cmd = fakeCommand({ agent: true, chain: "sepolia" });

    await handleFlowStartCommand(
      "0.00001",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
        dryRun: true,
      },
      cmd,
    );

    expect(renderFlowStartDryRunMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error] = printErrorMock.mock.calls[0] ?? [];
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toContain(
      "below the minimum",
    );
  });

  test("start dry-run warns on non-round amounts and warns humans when privacy delay is off", async () => {
    const agentCmd = fakeCommand({ agent: true, chain: "sepolia" });

    await handleFlowStartCommand(
      "0.123456789123456789",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
        dryRun: true,
      },
      agentCmd,
    );

    expect(printErrorMock).not.toHaveBeenCalled();
    expect(renderFlowStartDryRunMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        warnings: expect.arrayContaining([
          expect.objectContaining({
            code: "PRIVACY_NONROUND_AMOUNT",
            suggestedRoundAmount: "0.12",
            escape: "--allow-non-round-amounts",
          }),
        ]),
      }),
    );

    clearMockCalls(printErrorMock);
    clearMockCalls(renderFlowStartDryRunMock);
    await handleFlowStartCommand(
      "0.123456789123456789",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        newWallet: true,
        exportNewWallet: "/tmp/flow-wallet.txt",
        dryRun: true,
        privacyDelay: "off",
      },
      fakeCommand({ chain: "sepolia" }),
    );

    expect(renderFlowStartDryRunMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: "PRIVACY_NONROUND_AMOUNT" }),
          expect.objectContaining({ code: "timing_delay_disabled" }),
        ]),
      }),
    );
  });

  test("start rejects --watch in agent mode with structured nextActions", async () => {
    const cmd = fakeCommand({ agent: true });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      {
        to: "0x4444444444444444444444444444444444444444",
        watch: true,
      },
      cmd,
    );

    expect(startWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "INPUT_AGENT_FLOW_WATCH_UNSUPPORTED",
    );
    expect(
      (error as InstanceType<typeof realErrors.CLIError>).extra?.nextActions,
    ).toHaveLength(2);
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

  test("human mode reports flow cancellation without printing an error", async () => {
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
    expect(infoMock).toHaveBeenCalledWith("Flow cancelled.", false);
  });

  test("start suppresses errors after wallet setup recovery succeeds", async () => {
    const boom = new Error("missing wallet");
    startWorkflowMock.mockImplementationOnce(async () => {
      throw boom;
    });
    maybeRecoverMissingWalletSetupMock.mockImplementationOnce(async () => true);

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: "0x4444444444444444444444444444444444444444" },
      fakeCommand({}),
    );

    expect(maybeRecoverMissingWalletSetupMock).toHaveBeenCalledWith(
      boom,
      expect.anything(),
    );
    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("start opens the browser when the resulting snapshot exposes an explorer target", async () => {
    startWorkflowMock.mockImplementationOnce(async () => ({
      ...startSnapshot,
      depositExplorerUrl: "https://explorer/deposit",
    }));

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: "0x4444444444444444444444444444444444444444" },
      fakeCommand({ json: true }),
    );
    expect(maybeLaunchBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://explorer/deposit",
        label: "flow deposit transaction",
      }),
    );
  });

  test("start swallows preview-rendered errors without printing failures", async () => {
    startWorkflowMock.mockImplementationOnce(async () => {
      throw new realPreviewRuntime.PreviewScenarioRenderedError();
    });

    await handleFlowStartCommand(
      "0.1",
      "ETH",
      { to: "0x4444444444444444444444444444444444444444" },
      fakeCommand({}),
    );

    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("watch delegates to the workflow service and renders the snapshot", async () => {
    const cmd = fakeCommand({ chain: "sepolia" });
    const initialSnapshot = {
      ...watchLoopStartSnapshot,
      privacyDelayProfile: "off",
      privacyDelayConfigured: true,
    };
    const finalSnapshot = { ...watchSnapshot, chain: "sepolia", asset: "ETH" };
    getWorkflowStatusMock.mockImplementationOnce(() => initialSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => finalSnapshot);

    await handleFlowWatchCommand("wf-watch", { privacyDelay: "off" }, cmd);

    expect(getWorkflowStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-watch",
      }),
    );
    expect(stepWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-watch",
        globalOpts: expect.objectContaining({ chain: "sepolia" }),
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "watch",
      snapshot: finalSnapshot,
    });
  });

  test("watch returns early when preview output is rendered before any work begins", async () => {
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);

    await handleFlowWatchCommand("wf-watch", {}, fakeCommand({}));

    expect(getWorkflowStatusMock).not.toHaveBeenCalled();
    expect(stepWorkflowMock).not.toHaveBeenCalled();
  });

  test("watch rejects agent mode with status and step guidance", async () => {
    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ agent: true }));

    expect(getWorkflowStatusMock).not.toHaveBeenCalled();
    expect(stepWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "INPUT_AGENT_FLOW_WATCH_UNSUPPORTED",
    );
    expect(
      (error as InstanceType<typeof realErrors.CLIError>).extra?.nextActions,
    ).toHaveLength(2);
    expect(isJson).toBe(true);
  });

  test("watch emits JSONL phase events before the final success envelope in JSON mode", async () => {
    const jsonWatchSnapshot = {
      schemaVersion: "1.0.0",
      workflowId: "wf-watch",
      createdAt: "2026-04-15T11:00:00.000Z",
      updatedAt: "2026-04-15T12:00:00.000Z",
      phase: "completed",
      chain: "sepolia",
      asset: "ETH",
      depositAmount: "100000000000000000",
      recipient: "0x4444444444444444444444444444444444444444",
      privacyDelayConfigured: false,
      poolAccountId: "PA-1",
      poolAccountNumber: 1,
      committedValue: "99500000000000000",
      withdrawTxHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      withdrawBlockNumber: "12345",
      withdrawExplorerUrl: "https://example.test/withdraw",
    } as const;
    getWorkflowStatusMock.mockImplementationOnce(() => ({
      ...jsonWatchSnapshot,
      phase: "awaiting_asp",
      updatedAt: "2026-04-15T11:30:00.000Z",
      withdrawTxHash: undefined,
      withdrawBlockNumber: undefined,
      withdrawExplorerUrl: undefined,
    }));
    stepWorkflowMock.mockImplementationOnce(async () => jsonWatchSnapshot);
    renderFlowResultMock.mockImplementationOnce((_ctx, data) =>
      realFlowOutput.renderFlowResult(
        {
          mode: {
            isAgent: false,
            isJson: true,
            isCsv: false,
            isWide: false,
            isQuiet: true,
            format: "json",
            skipPrompts: true,
            verboseLevel: 0,
            jsonFields: null,
            jqExpression: null,
          },
          isVerbose: false,
          verboseLevel: 0,
        },
        data,
      )
    );

    const stdout = await captureStdoutAsync(() =>
      handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true })),
    );

    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      schemaVersion: JSON_SCHEMA_VERSION,
      success: true,
      mode: "flow",
      action: "watch",
      event: "phase_change",
      workflowId: "wf-watch",
      previousPhase: "awaiting_asp",
      phase: "completed",
    });
    expect(typeof JSON.parse(lines[0]!).ts).toBe("string");
    expect(JSON.parse(lines[1]!)).toMatchObject({
      success: true,
      mode: "flow",
      action: "watch",
      workflowId: "wf-watch",
      phase: "completed",
    });
    expect(JSON.parse(lines[1]!).event).toBeUndefined();
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "watch",
      snapshot: jsonWatchSnapshot,
    });
  });

  test("watch suppresses errors after wallet setup recovery succeeds", async () => {
    const boom = new Error("missing wallet");
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw boom;
    });
    maybeRecoverMissingWalletSetupMock.mockImplementationOnce(async () => true);

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({}));

    expect(maybeRecoverMissingWalletSetupMock).toHaveBeenCalledWith(
      boom,
      expect.anything(),
    );
    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("watch converts flow cancellation into a structured INPUT error in JSON mode", async () => {
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
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

  test("watch reports flow cancellation without printing an error in human mode", async () => {
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({}));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Flow cancelled.", false);
  });

  test("watch reports detach without printing an error in human mode", async () => {
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow watch detached.", "detached");
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({}));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith(
      "Detached from flow watch. The saved workflow is unchanged. Re-run 'privacy-pools flow watch' to resume.",
      false,
    );
  });

  test("watch forwards non-cancellation failures to printError", async () => {
    const boom = new Error("watch exploded");
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw boom;
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNKNOWN_ERROR",
        message: "watch exploded",
      }),
      true,
    );
  });

  test("watch adds saved workflow chain context to raw recovery errors", async () => {
    getWorkflowStatusMock
      .mockImplementationOnce(() => watchLoopStartSnapshot)
      .mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("execution reverted: UnknownStateRoot");
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent --chain sepolia");
  });

  test("watch rebuilds classified recovery actions with saved workflow chain context", async () => {
    getWorkflowStatusMock
      .mockImplementationOnce(() => watchLoopStartSnapshot)
      .mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new realErrors.CLIError(
        "State root is no longer available.",
        "CONTRACT",
        "Sync and retry.",
        "CONTRACT_UNKNOWN_STATE_ROOT",
      );
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent --chain sepolia");
  });

  test("watch surfaces proof verification failures without trying to reload the workflow", async () => {
    const proofError = new realErrors.CLIError(
      "Generated withdrawal proof failed local verification.",
      "PROOF",
      "Re-run 'privacy-pools flow watch' to generate a fresh proof.",
      "PROOF_VERIFICATION_FAILED",
    );
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw proofError;
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(getWorkflowStatusMock).toHaveBeenCalledTimes(1);
    expect(printErrorMock).toHaveBeenCalledWith(proofError, true);
  });

  test("watch re-renders the saved snapshot when the relayer minimum blocks the private path", async () => {
    getWorkflowStatusMock
      .mockImplementationOnce(() => watchLoopStartSnapshot)
      .mockImplementationOnce(() => statusSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new realErrors.CLIError(
        "Workflow amount is below the relayer minimum of 0.01 ETH.",
        "RELAYER",
        "Use flow ragequit.",
        "FLOW_RELAYER_MINIMUM_BLOCKED",
      );
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expect(getWorkflowStatusMock).toHaveBeenCalledTimes(2);
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "watch",
      snapshot: statusSnapshot,
    });
    expect(printErrorMock).not.toHaveBeenCalled();
  });

  test("watch falls back to the original error when the saved workflow cannot be reloaded", async () => {
    const blocked = new realErrors.CLIError(
      "Workflow amount is below the relayer minimum of 0.01 ETH.",
      "RELAYER",
      "Use flow ragequit.",
      "FLOW_RELAYER_MINIMUM_BLOCKED",
    );
    getWorkflowStatusMock.mockImplementationOnce(() => watchLoopStartSnapshot);
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw blocked;
    });
    getWorkflowStatusMock.mockImplementationOnce(() => {
      throw new Error("reload failed");
    });

    await handleFlowWatchCommand("wf-watch", undefined, fakeCommand({ json: true }));

    expect(printErrorMock).toHaveBeenCalledWith(blocked, true);
  });

  test("watch opens the browser when the final snapshot exposes an explorer url", async () => {
    getWorkflowStatusMock.mockImplementationOnce(() => ({
      ...watchLoopStartSnapshot,
      workflowId: "wf-watch",
    }));
    stepWorkflowMock.mockImplementationOnce(async () => ({
      ...watchSnapshot,
      withdrawExplorerUrl: "https://explorer/withdraw",
    }));

    await handleFlowWatchCommand("wf-watch", {}, fakeCommand({}));

    expect(maybeLaunchBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://explorer/withdraw",
        label: "flow withdrawal transaction",
      }),
    );
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

  test("status opens the browser when the snapshot carries an explorer target", async () => {
    getWorkflowStatusMock.mockImplementationOnce(() => ({
      ...statusSnapshot,
      depositExplorerUrl: "https://explorer/deposit",
    }));

    await handleFlowStatusCommand("wf-status", undefined, fakeCommand({}));

    expect(maybeLaunchBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://explorer/deposit",
        label: "flow deposit transaction",
      }),
    );
  });

  test("status forwards lookup failures through printError", async () => {
    const boom = new Error("status exploded");
    getWorkflowStatusMock.mockImplementationOnce(() => {
      throw boom;
    });

    await handleFlowStatusCommand("wf-status", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNKNOWN_ERROR",
        message: "status exploded",
      }),
      true,
    );
    expect(maybeRecoverMissingWalletSetupMock).not.toHaveBeenCalled();
  });

  test("status adds saved workflow chain context when rendering fails", async () => {
    getWorkflowStatusMock
      .mockImplementationOnce(() => statusSnapshot)
      .mockImplementationOnce(() => statusSnapshot);
    renderFlowResultMock.mockImplementationOnce(() => {
      throw new Error("execution reverted: IncorrectASPRoot");
    });

    await handleFlowStatusCommand("wf-status", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent --chain sepolia");
  });

  test("status rebuilds classified recovery actions with saved workflow chain context", async () => {
    getWorkflowStatusMock
      .mockImplementationOnce(() => statusSnapshot)
      .mockImplementationOnce(() => statusSnapshot);
    renderFlowResultMock.mockImplementationOnce(() => {
      throw new realErrors.CLIError(
        "ASP root changed since proof generation.",
        "CONTRACT",
        "Sync and retry.",
        "CONTRACT_INCORRECT_ASP_ROOT",
      );
    });

    await handleFlowStatusCommand("wf-status", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent --chain sepolia");
  });

  test("step delegates to the workflow service and renders the step action", async () => {
    const cmd = fakeCommand({ chain: "sepolia", json: true });
    const steppedSnapshot = { workflowId: "wf-step", phase: "awaiting_asp" };
    stepWorkflowMock.mockImplementationOnce(async () => steppedSnapshot);

    await handleFlowStepCommand("wf-step", undefined, cmd);

    expect(stepWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "wf-step",
        globalOpts: expect.objectContaining({ chain: "sepolia", json: true }),
      }),
    );
    expect(renderFlowResultMock).toHaveBeenCalledWith(ctx, {
      action: "step",
      snapshot: steppedSnapshot,
    });
  });

  test("step opens the browser when the stepped snapshot carries an explorer target", async () => {
    stepWorkflowMock.mockImplementationOnce(async () => ({
      ...watchSnapshot,
      withdrawExplorerUrl: "https://explorer/withdraw",
    }));

    await handleFlowStepCommand("wf-step", undefined, fakeCommand({}));

    expect(maybeLaunchBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://explorer/withdraw",
        label: "flow withdrawal transaction",
      }),
    );
  });

  test("step forwards failures through printError", async () => {
    const boom = new Error("step exploded");
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw boom;
    });

    await handleFlowStepCommand("wf-step", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNKNOWN_ERROR",
        message: "step exploded",
      }),
      true,
    );
    expect(maybeRecoverMissingWalletSetupMock).not.toHaveBeenCalled();
  });

  test("step adds saved workflow chain context to raw recovery errors", async () => {
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("execution reverted: IncorrectASPRoot");
    });

    await handleFlowStepCommand("wf-step", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent --chain sepolia");
  });

  test("step rebuilds classified recovery actions with saved workflow chain context", async () => {
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new realErrors.CLIError(
        "State root is no longer available.",
        "CONTRACT",
        "Sync and retry.",
        "CONTRACT_UNKNOWN_STATE_ROOT",
      );
    });

    await handleFlowStepCommand("wf-step", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent --chain sepolia");
  });

  test("step keeps recovery errors printable when saved workflow reload fails", async () => {
    stepWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("execution reverted: IncorrectASPRoot");
    });
    getWorkflowStatusMock.mockImplementationOnce(() => {
      throw new Error("saved workflow unavailable");
    });

    await handleFlowStepCommand("wf-step", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand("privacy-pools sync --agent");
  });

  test("ragequit delegates to the workflow service and renders recovery output", async () => {
    const cmd = fakeCommand({ chain: "sepolia" });
    inputPromptMock.mockImplementationOnce(async () => "RAGEQUIT");

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

  test("ragequit requires an explicit override once a workflow is approved and offers private-path nextActions", async () => {
    getWorkflowStatusMock.mockImplementationOnce(() => ({
      ...statusSnapshot,
      workflowId: "wf-approved",
      aspStatus: "approved",
      poolAccountId: "PA-7",
    }));

    await handleFlowRagequitCommand("wf-approved", undefined, fakeCommand({ json: true }));

    expect(ragequitWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error] = printErrorMock.mock.calls[0] ?? [];
    expect((error as InstanceType<typeof realErrors.CLIError>).code).toBe(
      "INPUT_APPROVED_WORKFLOW_RAGEQUIT_REQUIRES_OVERRIDE",
    );
    expect(
      (error as InstanceType<typeof realErrors.CLIError>).extra?.nextActions,
    ).toHaveLength(3);
  });

  test("ragequit returns early when preview output is rendered before review", async () => {
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({}));

    expect(getWorkflowStatusMock).not.toHaveBeenCalled();
    expect(ragequitWorkflowMock).not.toHaveBeenCalled();
  });

  test("ragequit can return after showing the review when preview output is rendered post-prompts", async () => {
    maybeRenderPreviewScenarioMock.mockImplementation(async (_commandKey, options) =>
      options?.timing === "after-prompts",
    );

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({}));

    expect(getWorkflowStatusMock).toHaveBeenCalledWith({ workflowId: "wf-ragequit" });
    expect(formatFlowRagequitReviewMock).toHaveBeenCalledTimes(1);
    expect(confirmActionWithSeverityMock).not.toHaveBeenCalled();
    expect(ragequitWorkflowMock).not.toHaveBeenCalled();
  });

  test("ragequit converts flow cancellation into a structured INPUT error in JSON mode", async () => {
    ragequitWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledTimes(1);
    const [error, isJson] = printErrorMock.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(realErrors.CLIError);
    expect((error as InstanceType<typeof realErrors.CLIError>).message).toBe(
      "Flow cancelled.",
    );
    expect(isJson).toBe(true);
  });

  test("ragequit reports flow cancellation without printing an error in human mode", async () => {
    inputPromptMock.mockImplementationOnce(async () => "RAGEQUIT");
    ragequitWorkflowMock.mockImplementationOnce(async () => {
      throw new MockFlowCancelledError("Flow cancelled.");
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({}));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Flow cancelled.", false);
  });

  test("ragequit surfaces proof verification failures without rendering success output", async () => {
    inputPromptMock.mockImplementationOnce(async () => "RAGEQUIT");
    const proofError = new realErrors.CLIError(
      "Generated commitment proof failed local verification.",
      "PROOF",
      "Re-run 'privacy-pools flow ragequit' to generate a fresh proof.",
      "PROOF_VERIFICATION_FAILED",
    );
    ragequitWorkflowMock.mockImplementationOnce(async () => {
      throw proofError;
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({ json: true }));

    expect(renderFlowResultMock).not.toHaveBeenCalled();
    expect(printErrorMock).toHaveBeenCalledWith(proofError, true);
  });

  test("ragequit adds saved workflow chain context to raw recovery errors", async () => {
    ragequitWorkflowMock.mockImplementationOnce(async () => {
      throw new Error("execution reverted: NullifierAlreadySpent");
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand(
      "privacy-pools accounts --agent --chain sepolia",
    );
  });

  test("ragequit rebuilds classified recovery actions with saved workflow chain context", async () => {
    ragequitWorkflowMock.mockImplementationOnce(async () => {
      throw new realErrors.CLIError(
        "Selected Pool Account was already spent.",
        "CONTRACT",
        "Refresh accounts and retry.",
        "CONTRACT_NULLIFIER_ALREADY_SPENT",
      );
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({ json: true }));

    expectPrintedRecoveryCliCommand(
      "privacy-pools accounts --agent --chain sepolia",
    );
  });

  test("ragequit cancels cleanly when the confirmation is declined", async () => {
    confirmActionWithSeverityMock.mockImplementationOnce(async () => false);

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({}));

    expect(ragequitWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith("Flow cancelled.", false);
  });

  test("ragequit treats prompt cancellation during confirmation as a clean stop", async () => {
    confirmActionWithSeverityMock.mockImplementationOnce(async () => {
      const error = new Error("prompt aborted") as Error & { name: string };
      error.name = "ExitPromptError";
      throw error;
    });

    await handleFlowRagequitCommand("wf-ragequit", undefined, fakeCommand({}));

    expect(ragequitWorkflowMock).not.toHaveBeenCalled();
    expect(printErrorMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith(
      realPromptCancellation.PROMPT_CANCELLATION_MESSAGE,
      false,
    );
  });

  test("ragequit opens the browser when the recovery result exposes an explorer url", async () => {
    ragequitWorkflowMock.mockImplementationOnce(async () => ({
      ...ragequitSnapshot,
      ragequitExplorerUrl: "https://explorer/ragequit",
    }));

    await handleFlowRagequitCommand(
      "wf-ragequit",
      { confirmRagequit: true },
      fakeCommand({}),
    );

    expect(maybeLaunchBrowserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://explorer/ragequit",
        label: "flow ragequit transaction",
      }),
    );
  });
});
