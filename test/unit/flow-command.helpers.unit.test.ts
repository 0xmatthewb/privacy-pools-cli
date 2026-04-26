import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { AbortSignal } from "node:abort_controller";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realWorkflow = captureModuleExports(
  await import("../../src/services/workflow.ts"),
);
const realRecipientHistory = captureModuleExports(
  await import("../../src/services/recipient-history.ts"),
);
const realWallet = captureModuleExports(
  await import("../../src/services/wallet.ts"),
);
const realPrompts = captureModuleExports(
  await import("../../src/utils/prompts.ts"),
);
const realPromptCancellation = captureModuleExports(
  await import("../../src/utils/prompt-cancellation.ts"),
);
const realRecipientSafety = captureModuleExports(
  await import("../../src/utils/recipient-safety.ts"),
);

const FLOW_HELPER_MODULE_RESTORES = [
  ["../../src/services/workflow.ts", realWorkflow],
  ["../../src/services/recipient-history.ts", realRecipientHistory],
  ["../../src/services/wallet.ts", realWallet],
  ["../../src/utils/prompts.ts", realPrompts],
  ["../../src/utils/prompt-cancellation.ts", realPromptCancellation],
  ["../../src/utils/recipient-safety.ts", realRecipientSafety],
] as const;

const applyFlowPrivacyDelayPolicyMock = mock(
  (snapshot: Record<string, unknown>, profile: string) => ({
    ...snapshot,
    privacyDelayProfile: profile,
    privacyDelayConfigured: true,
  }),
);
const computeFlowWatchDelayMsMock = mock(() => 1);
const getWorkflowStatusMock = mock(({ workflowId }: { workflowId?: string }) => {
  if (workflowId === "wf-bad") {
    throw new Error("unreadable workflow");
  }
  return makeSnapshot("awaiting_approval", {
    workflowId: workflowId ?? "wf-1",
    recipient: "0x1111111111111111111111111111111111111111",
    walletAddress: "0x2222222222222222222222222222222222222222",
  });
});
const initialPollDelayMsMock = mock(() => 5);
const isTerminalFlowPhaseMock = mock((phase: string) =>
  phase === "completed" || phase === "ragequit_confirmed",
);
const listSavedWorkflowIdsMock = mock(() => ["wf-1", "wf-bad", "wf-2"]);
const nextPollDelayMsMock = mock(() => 7);
const resolveOptionalFlowPrivacyDelayProfileMock = mock((profile?: string) =>
  profile ?? null
);
const saveWorkflowSnapshotIfChangedWithLockMock = mock(
  async (_current: Record<string, unknown>, updated: Record<string, unknown>) => updated,
);
const stepWorkflowMock = mock(async () => makeSnapshot("completed"));
const loadKnownRecipientHistoryMock = mock(() => [
  "0x4444444444444444444444444444444444444444",
]);
const loadPrivateKeyMock = mock(
  () => "0x" + "11".repeat(32) as `0x${string}`,
);
const getSignerAddressMock = mock(
  () => "0x9999999999999999999999999999999999999999",
);
const confirmActionWithSeverityMock = mock(async () => true);
const ensurePromptInteractionAvailableMock = mock(() => undefined);
const resolveSafeRecipientAddressOrEnsMock = mock(async (value: string) => ({
  address: "0x5555555555555555555555555555555555555555",
  ...(value.endsWith(".eth") ? { ensName: value } : {}),
}));

let collectKnownFlowRecipients:
  typeof import("../../src/commands/flow.ts").collectKnownFlowRecipients;
let confirmRecipientIfNew:
  typeof import("../../src/commands/flow.ts").confirmRecipientIfNew;
let flowCancelledCliError:
  typeof import("../../src/commands/flow.ts").flowCancelledCliError;
let flowDetachedCliError:
  typeof import("../../src/commands/flow.ts").flowDetachedCliError;
let getFlowBrowserTarget:
  typeof import("../../src/commands/flow.ts").getFlowBrowserTarget;
let isPausedFlowPhase:
  typeof import("../../src/commands/flow.ts").isPausedFlowPhase;
let isWatchTerminalSnapshot:
  typeof import("../../src/commands/flow.ts").isWatchTerminalSnapshot;
let maybeApplyFlowWatchPrivacyDelayOverride:
  typeof import("../../src/commands/flow.ts").maybeApplyFlowWatchPrivacyDelayOverride;
let promptFlowRecipientAddressOrEns:
  typeof import("../../src/commands/flow.ts").promptFlowRecipientAddressOrEns;
let sleepWithAbort:
  typeof import("../../src/commands/flow.ts").sleepWithAbort;
let sleepWithPrivacyDelayCountdown:
  typeof import("../../src/commands/flow.ts").sleepWithPrivacyDelayCountdown;
let throwIfWatchAborted:
  typeof import("../../src/commands/flow.ts").throwIfWatchAborted;
let validateRecipientAddressOrEnsInput:
  typeof import("../../src/commands/flow.ts").validateRecipientAddressOrEnsInput;
let watchFlowWithStatusAndStep:
  typeof import("../../src/commands/flow.ts").watchFlowWithStatusAndStep;

function makeSnapshot(
  phase: string,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    workflowId: "wf-1",
    phase,
    chain: "sepolia",
    walletAddress: "0x2222222222222222222222222222222222222222",
    recipient: "0x3333333333333333333333333333333333333333",
    privacyDelayProfile: "balanced",
    privacyDelayConfigured: true,
    depositExplorerUrl: null,
    withdrawExplorerUrl: null,
    ragequitExplorerUrl: null,
    ...patch,
  };
}

async function loadFlowHelpers(): Promise<void> {
  installModuleMocks([
    ["../../src/services/workflow.ts", () => ({
      ...realWorkflow,
      applyFlowPrivacyDelayPolicy: applyFlowPrivacyDelayPolicyMock,
      computeFlowWatchDelayMs: computeFlowWatchDelayMsMock,
      getWorkflowStatus: getWorkflowStatusMock,
      initialPollDelayMs: initialPollDelayMsMock,
      isTerminalFlowPhase: isTerminalFlowPhaseMock,
      listSavedWorkflowIds: listSavedWorkflowIdsMock,
      nextPollDelayMs: nextPollDelayMsMock,
      resolveOptionalFlowPrivacyDelayProfile: resolveOptionalFlowPrivacyDelayProfileMock,
      saveWorkflowSnapshotIfChangedWithLock: saveWorkflowSnapshotIfChangedWithLockMock,
      stepWorkflow: stepWorkflowMock,
    })],
    ["../../src/services/recipient-history.ts", () => ({
      ...realRecipientHistory,
      loadKnownRecipientHistory: loadKnownRecipientHistoryMock,
    })],
    ["../../src/services/wallet.ts", () => ({
      ...realWallet,
      loadPrivateKey: loadPrivateKeyMock,
      getSignerAddress: getSignerAddressMock,
    })],
    ["../../src/utils/prompts.ts", () => ({
      ...realPrompts,
      confirmActionWithSeverity: confirmActionWithSeverityMock,
    })],
    ["../../src/utils/prompt-cancellation.ts", () => ({
      ...realPromptCancellation,
      ensurePromptInteractionAvailable: ensurePromptInteractionAvailableMock,
    })],
    ["../../src/utils/recipient-safety.ts", () => ({
      ...realRecipientSafety,
      resolveSafeRecipientAddressOrEns: resolveSafeRecipientAddressOrEnsMock,
    })],
  ]);

  ({
    collectKnownFlowRecipients,
    confirmRecipientIfNew,
    flowCancelledCliError,
    flowDetachedCliError,
    getFlowBrowserTarget,
    isPausedFlowPhase,
    isWatchTerminalSnapshot,
    maybeApplyFlowWatchPrivacyDelayOverride,
    promptFlowRecipientAddressOrEns,
    sleepWithAbort,
    sleepWithPrivacyDelayCountdown,
    throwIfWatchAborted,
    validateRecipientAddressOrEnsInput,
    watchFlowWithStatusAndStep,
  } = await import("../../src/commands/flow.ts"));
}

describe("flow command helpers", () => {
  beforeEach(async () => {
    mock.restore();
    applyFlowPrivacyDelayPolicyMock.mockClear();
    computeFlowWatchDelayMsMock.mockClear();
    getWorkflowStatusMock.mockClear();
    initialPollDelayMsMock.mockClear();
    isTerminalFlowPhaseMock.mockClear();
    listSavedWorkflowIdsMock.mockClear();
    nextPollDelayMsMock.mockClear();
    resolveOptionalFlowPrivacyDelayProfileMock.mockClear();
    saveWorkflowSnapshotIfChangedWithLockMock.mockClear();
    stepWorkflowMock.mockClear();
    loadKnownRecipientHistoryMock.mockClear();
    loadPrivateKeyMock.mockClear();
    getSignerAddressMock.mockClear();
    confirmActionWithSeverityMock.mockClear();
    ensurePromptInteractionAvailableMock.mockClear();
    resolveSafeRecipientAddressOrEnsMock.mockClear();
    confirmActionWithSeverityMock.mockImplementation(async () => true);
    stepWorkflowMock.mockImplementation(async () => makeSnapshot("completed"));
    resolveOptionalFlowPrivacyDelayProfileMock.mockImplementation((profile?: string) =>
      profile ?? null
    );
    await loadFlowHelpers();
  });

  afterEach(() => {
    restoreModuleImplementations(FLOW_HELPER_MODULE_RESTORES);
  });

  test("resolves flow browser targets and terminal/paused states", () => {
    expect(
      getFlowBrowserTarget(makeSnapshot("paused_poa_required") as any),
    ).toMatchObject({
      label: "PoA portal",
    });
    expect(
      getFlowBrowserTarget(makeSnapshot("paused_poa_required") as any)?.url,
    ).toContain("0xbow");
    expect(
      getFlowBrowserTarget(
        makeSnapshot("completed_public_recovery", {
          ragequitExplorerUrl: "https://explorer/ragequit",
        }) as any,
      ),
    ).toEqual({
      url: "https://explorer/ragequit",
      label: "flow ragequit transaction",
    });
    expect(
      getFlowBrowserTarget(
        makeSnapshot("completed", {
          withdrawExplorerUrl: "https://explorer/withdraw",
        }) as any,
      ),
    ).toEqual({
      url: "https://explorer/withdraw",
      label: "flow withdrawal transaction",
    });
    expect(
      getFlowBrowserTarget(
        makeSnapshot("depositing_publicly", {
          depositExplorerUrl: "https://explorer/deposit",
        }) as any,
      ),
    ).toEqual({
      url: "https://explorer/deposit",
      label: "flow deposit transaction",
    });
    expect(getFlowBrowserTarget(makeSnapshot("awaiting_approval") as any)).toBeNull();

    expect(isPausedFlowPhase(makeSnapshot("paused_declined") as any)).toBe(true);
    expect(isPausedFlowPhase(makeSnapshot("completed") as any)).toBe(false);
    expect(isWatchTerminalSnapshot(makeSnapshot("paused_poa_required") as any)).toBe(true);
    expect(isWatchTerminalSnapshot(makeSnapshot("completed") as any)).toBe(true);
    expect(isWatchTerminalSnapshot(makeSnapshot("withdrawing") as any)).toBe(false);
  });

  test("builds cancel/detach errors and abort helpers", async () => {
    expect(flowCancelledCliError().message).toBe("Flow cancelled.");
    expect(flowDetachedCliError().message).toBe("Flow watch detached.");

    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfWatchAborted(controller.signal)).toThrow("detached");

    await expect(sleepWithAbort(0)).resolves.toBeUndefined();
    await expect(
      sleepWithAbort(1, controller.signal as AbortSignal),
    ).rejects.toThrow("detached");

    const deferredAbort = new AbortController();
    const deferredSleep = sleepWithAbort(25, deferredAbort.signal as AbortSignal);
    setTimeout(() => deferredAbort.abort(), 0);
    await expect(deferredSleep).rejects.toThrow("detached");
  });

  test("renders a live privacy-delay countdown when stderr is a tty", async () => {
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    const originalIsTTY = process.stderr.isTTY;
    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await sleepWithPrivacyDelayCountdown({
        sleepMs: 0,
        privacyDelayUntilMs: Date.now() + 65_000,
        silent: false,
      });

      const output = stderrChunks.join("");
      expect(output).toContain("\rPrivacy delay remaining:");
      expect(output).toContain("Next check in");
      expect(output).toContain("Ctrl-C to detach");
    } finally {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, "isTTY", {
        configurable: true,
        value: originalIsTTY,
      });
    }
  });

  test("applies saved privacy-delay overrides only when they change the workflow", async () => {
    const unchanged = await maybeApplyFlowWatchPrivacyDelayOverride({
      workflowId: "wf-1",
      privacyDelayProfile: "balanced",
      silent: true,
    });
    expect(unchanged).toMatchObject({
      workflowId: "wf-1",
      privacyDelayProfile: "balanced",
    });
    expect(saveWorkflowSnapshotIfChangedWithLockMock).not.toHaveBeenCalled();

    getWorkflowStatusMock.mockImplementationOnce(() =>
      makeSnapshot("awaiting_approval", {
        workflowId: "wf-2",
        privacyDelayProfile: "off",
        privacyDelayConfigured: false,
      })
    );
    saveWorkflowSnapshotIfChangedWithLockMock.mockImplementationOnce(
      async (_current, updated) => ({
        ...updated,
        workflowId: "wf-2",
      }),
    );

    const updated = await maybeApplyFlowWatchPrivacyDelayOverride({
      workflowId: "wf-2",
      privacyDelayProfile: "strict",
      silent: true,
    });
    expect(applyFlowPrivacyDelayPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-2" }),
      "strict",
      expect.objectContaining({
        configured: true,
        rescheduleApproved: true,
      }),
    );
    expect(saveWorkflowSnapshotIfChangedWithLockMock).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({
      workflowId: "wf-2",
      privacyDelayProfile: "strict",
    });
  });

  test("collects known flow recipients from signer history and saved workflows", () => {
    expect(collectKnownFlowRecipients()).toEqual([
      "0x4444444444444444444444444444444444444444",
      "0x9999999999999999999999999999999999999999",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);

    loadPrivateKeyMock.mockImplementationOnce(() => {
      throw new Error("no signer");
    });
    expect(collectKnownFlowRecipients()).not.toContain(
      "0x9999999999999999999999999999999999999999",
    );
  });

  test("validates and prompts for recipient addresses or ENS inputs", async () => {
    expect(
      validateRecipientAddressOrEnsInput(
        "0x5555555555555555555555555555555555555555",
      ),
    ).toBe(true);
    expect(validateRecipientAddressOrEnsInput("alice.eth")).toBe(true);
    expect(validateRecipientAddressOrEnsInput("not-an-address")).toEqual(
      expect.any(String),
    );

    const promptInput = mock(async () => "alice.eth");
    await expect(
      promptFlowRecipientAddressOrEns(promptInput, true),
    ).resolves.toBe("0x5555555555555555555555555555555555555555");

    const failingPrompt = mock(async () => "bad.eth");
    resolveSafeRecipientAddressOrEnsMock.mockImplementation(async () => {
      throw new Error("Invalid address or ENS name.");
    });
    await expect(
      promptFlowRecipientAddressOrEns(failingPrompt, true),
    ).rejects.toThrow("Invalid address or ENS name.");
    expect(failingPrompt).toHaveBeenCalledTimes(5);

    const stringFailingPrompt = mock(async () => "alice.eth");
    resolveSafeRecipientAddressOrEnsMock.mockImplementation(async () => {
      throw "bad";
    });
    await expect(
      promptFlowRecipientAddressOrEns(stringFailingPrompt, true),
    ).rejects.toMatchObject({
      code: "INPUT_FLOW_RECIPIENT_RETRY_LIMIT",
    });
  });

  test("confirms new recipients only when needed", async () => {
    await expect(
      confirmRecipientIfNew({
        address: "0x4444444444444444444444444444444444444444",
        knownRecipients: ["0x4444444444444444444444444444444444444444"],
        skipPrompts: false,
        silent: true,
      }),
    ).resolves.toEqual([]);

    const skippedWarnings = await confirmRecipientIfNew({
      address: "0x7777777777777777777777777777777777777777",
      knownRecipients: [],
      skipPrompts: true,
      silent: true,
    });
    expect(skippedWarnings).toHaveLength(1);

    confirmActionWithSeverityMock.mockImplementationOnce(async () => false);
    await expect(
      confirmRecipientIfNew({
        address: "0x8888888888888888888888888888888888888888",
        knownRecipients: [],
        skipPrompts: false,
        silent: true,
      }),
    ).rejects.toThrow();
    expect(ensurePromptInteractionAvailableMock).toHaveBeenCalled();
  });

  test("watches saved flows through phase changes until completion", async () => {
    const onPhaseChange = mock(() => undefined);
    let stepCall = 0;
    getWorkflowStatusMock.mockImplementationOnce(() =>
      makeSnapshot("depositing_publicly", { workflowId: "wf-watch" })
    );
    stepWorkflowMock.mockImplementation(async () => {
      stepCall += 1;
      if (stepCall === 1) {
        return makeSnapshot("withdrawing", { workflowId: "wf-watch" });
      }
      return makeSnapshot("completed", { workflowId: "wf-watch" });
    });

    const snapshot = await watchFlowWithStatusAndStep({
      workflowId: "wf-watch",
      globalOpts: { json: true } as Record<string, unknown>,
      mode: { isQuiet: true, isJson: true } as ReturnType<
        typeof import("../../src/utils/mode.ts").resolveGlobalMode
      >,
      isVerbose: false,
      onPhaseChange,
    });

    expect(snapshot).toMatchObject({
      workflowId: "wf-watch",
      phase: "completed",
    });
    expect(onPhaseChange).toHaveBeenCalledTimes(2);
    expect(stepWorkflowMock).toHaveBeenCalledTimes(2);
    expect(computeFlowWatchDelayMsMock).toHaveBeenCalled();
  });

  test("watches saved flows through each waiting narration branch before completion", async () => {
    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    getWorkflowStatusMock.mockImplementationOnce(() =>
      makeSnapshot("awaiting_funding", {
        workflowId: "wf-watch",
        walletAddress: "0x7777777777777777777777777777777777777777",
      })
    );
    stepWorkflowMock
      .mockImplementationOnce(async () =>
        makeSnapshot("awaiting_funding", {
          workflowId: "wf-watch",
          walletAddress: "0x7777777777777777777777777777777777777777",
        })
      )
      .mockImplementationOnce(async () =>
        makeSnapshot("depositing_publicly", { workflowId: "wf-watch" })
      )
      .mockImplementationOnce(async () =>
        makeSnapshot("approved_waiting_privacy_delay", { workflowId: "wf-watch" })
      )
      .mockImplementationOnce(async () =>
        makeSnapshot("withdrawing", { workflowId: "wf-watch" })
      )
      .mockImplementationOnce(async () =>
        makeSnapshot("awaiting_approval", { workflowId: "wf-watch", chain: "sepolia" })
      )
      .mockImplementationOnce(async () =>
        makeSnapshot("completed", { workflowId: "wf-watch" })
      );

    try {
      const snapshot = await watchFlowWithStatusAndStep({
        workflowId: "wf-watch",
        mode: { isQuiet: false, isJson: false } as ReturnType<
          typeof import("../../src/utils/mode.ts").resolveGlobalMode
        >,
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(computeFlowWatchDelayMsMock).toHaveBeenCalledTimes(5);
      const combinedOutput = stderrChunks.join("");
      expect(combinedOutput).toContain("Still waiting for funding");
      expect(combinedOutput).toContain("Still reconciling the public deposit step");
      expect(combinedOutput).toContain("Still waiting for the saved privacy delay");
      expect(combinedOutput).toContain("Still waiting for the private withdrawal to settle");
      expect(combinedOutput).toContain("Still waiting for saved workflow progress on sepolia");
    } finally {
      process.stderr.write = originalWrite;
    }
  });
});
