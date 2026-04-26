import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Address } from "viem";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realAsp = captureModuleExports(await import("../../src/services/asp.ts"));
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realWorkflow = captureModuleExports(
  await import("../../src/services/workflow.ts"),
);
const realRecipientHistory = captureModuleExports(
  await import("../../src/services/recipient-history.ts"),
);
const realPrompts = captureModuleExports(
  await import("../../src/utils/prompts.ts"),
);
const realPromptCancellation = captureModuleExports(
  await import("../../src/utils/prompt-cancellation.ts"),
);

const WITHDRAW_MORE_HELPER_RESTORES = [
  ["../../src/services/asp.ts", realAsp],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/workflow.ts", realWorkflow],
  ["../../src/services/recipient-history.ts", realRecipientHistory],
  ["../../src/utils/prompts.ts", realPrompts],
  ["../../src/utils/prompt-cancellation.ts", realPromptCancellation],
] as const;

const fetchDepositsLargerThanMock = mock(async () => ({
  eligibleDeposits: 8,
  totalDeposits: 12,
  percentage: 66.66,
}));
const listPoolsMock = mock(async () => [
  {
    symbol: "ETH",
    asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 18,
    totalInPoolValue: 10_000000000000000000n,
    totalInPoolValueUsd: "25000",
  },
]);
const listSavedWorkflowIdsMock = mock(() => ["wf-1", "wf-bad", "wf-2"]);
const getWorkflowStatusMock = mock(({ workflowId }: { workflowId: string }) => {
  if (workflowId === "wf-bad") {
    throw new Error("unreadable workflow");
  }
  if (workflowId === "wf-1") {
    return {
      recipient: "0x1111111111111111111111111111111111111111",
      walletAddress: "0x2222222222222222222222222222222222222222",
    };
  }
  return {
    recipient: "0x3333333333333333333333333333333333333333",
    walletAddress: undefined,
  };
});
const loadKnownRecipientHistoryMock = mock(() => [
  "0x4444444444444444444444444444444444444444",
]);
const loadRecipientHistoryEntriesMock = mock(() => []);
const rememberKnownRecipientMock = mock(() => undefined);
const confirmActionWithSeverityMock = mock(async () => true);
const selectPromptMock = mock(async <Value,>() => "" as Value);
const ensurePromptInteractionAvailableMock = mock(() => undefined);

let buildDirectRecipientMismatchNextActions:
  typeof import("../../src/commands/withdraw.ts").buildDirectRecipientMismatchNextActions;
let buildRemainderBelowMinNextActions:
  typeof import("../../src/commands/withdraw.ts").buildRemainderBelowMinNextActions;
let buildWithdrawQuoteWarnings:
  typeof import("../../src/commands/withdraw.ts").buildWithdrawQuoteWarnings;
let collectKnownWithdrawalRecipients:
  typeof import("../../src/commands/withdraw.ts").collectKnownWithdrawalRecipients;
let collectKnownWorkflowRecipients:
  typeof import("../../src/commands/withdraw.ts").collectKnownWorkflowRecipients;
let confirmRecipientIfNew:
  typeof import("../../src/commands/withdraw.ts").confirmRecipientIfNew;
let deriveNativeGasTokenPrice:
  typeof import("../../src/commands/withdraw.ts").deriveNativeGasTokenPrice;
let fetchWithdrawalAnonymitySet:
  typeof import("../../src/commands/withdraw.ts").fetchWithdrawalAnonymitySet;
let formatRelayedWithdrawalRemainderHint:
  typeof import("../../src/commands/withdraw.ts").formatRelayedWithdrawalRemainderHint;
let getSuspiciousTestnetMinWithdrawFloor:
  typeof import("../../src/commands/withdraw.ts").getSuspiciousTestnetMinWithdrawFloor;
let relayerHostLabel:
  typeof import("../../src/commands/withdraw.ts").relayerHostLabel;
let rememberSuccessfulWithdrawalRecipient:
  typeof import("../../src/commands/withdraw.ts").rememberSuccessfulWithdrawalRecipient;
let promptRecentRecipientAddressOrEns:
  typeof import("../../src/commands/withdraw.ts").promptRecentRecipientAddressOrEns;
let validateRecipientAddressOrEnsInput:
  typeof import("../../src/commands/withdraw.ts").validateRecipientAddressOrEnsInput;
let withSuspendedSpinner:
  typeof import("../../src/commands/withdraw.ts").withSuspendedSpinner;
let writeWithdrawalAnonymitySetHint:
  typeof import("../../src/commands/withdraw.ts").writeWithdrawalAnonymitySetHint;

async function loadWithdrawHelpers(): Promise<void> {
  installModuleMocks([
    ["../../src/services/asp.ts", () => ({
      ...realAsp,
      fetchDepositsLargerThan: fetchDepositsLargerThanMock,
    })],
    ["../../src/services/pools.ts", () => ({
      ...realPools,
      listPools: listPoolsMock,
    })],
    ["../../src/services/workflow.ts", () => ({
      ...realWorkflow,
      listSavedWorkflowIds: listSavedWorkflowIdsMock,
      getWorkflowStatus: getWorkflowStatusMock,
    })],
    ["../../src/services/recipient-history.ts", () => ({
      ...realRecipientHistory,
      loadKnownRecipientHistory: loadKnownRecipientHistoryMock,
      loadRecipientHistoryEntries: loadRecipientHistoryEntriesMock,
      rememberKnownRecipient: rememberKnownRecipientMock,
    })],
    ["../../src/utils/prompts.ts", () => ({
      ...realPrompts,
      confirmActionWithSeverity: confirmActionWithSeverityMock,
      selectPrompt: selectPromptMock,
    })],
    ["../../src/utils/prompt-cancellation.ts", () => ({
      ...realPromptCancellation,
      ensurePromptInteractionAvailable: ensurePromptInteractionAvailableMock,
    })],
  ]);

  ({
    buildDirectRecipientMismatchNextActions,
    buildRemainderBelowMinNextActions,
    buildWithdrawQuoteWarnings,
    collectKnownWithdrawalRecipients,
    collectKnownWorkflowRecipients,
    confirmRecipientIfNew,
    deriveNativeGasTokenPrice,
    fetchWithdrawalAnonymitySet,
    formatRelayedWithdrawalRemainderHint,
    getSuspiciousTestnetMinWithdrawFloor,
    relayerHostLabel,
    rememberSuccessfulWithdrawalRecipient,
    promptRecentRecipientAddressOrEns,
    validateRecipientAddressOrEnsInput,
    withSuspendedSpinner,
    writeWithdrawalAnonymitySetHint,
  } = await import(`../../src/commands/withdraw.ts?more-helpers=${Date.now()}`));
}

describe("withdraw command helper coverage", () => {
  beforeEach(async () => {
    mock.restore();
    fetchDepositsLargerThanMock.mockClear();
    listPoolsMock.mockClear();
    listSavedWorkflowIdsMock.mockClear();
    getWorkflowStatusMock.mockClear();
    loadKnownRecipientHistoryMock.mockClear();
    loadRecipientHistoryEntriesMock.mockClear();
    rememberKnownRecipientMock.mockClear();
    confirmActionWithSeverityMock.mockClear();
    selectPromptMock.mockClear();
    ensurePromptInteractionAvailableMock.mockClear();
    loadRecipientHistoryEntriesMock.mockImplementation(() => []);
    confirmActionWithSeverityMock.mockImplementation(async () => true);
    selectPromptMock.mockImplementation(async <Value,>() => "" as Value);
    await loadWithdrawHelpers();
  });

  afterEach(() => {
    restoreModuleImplementations(WITHDRAW_MORE_HELPER_RESTORES);
  });

  test("normalizes relayer host labels and suspicious testnet floors", () => {
    expect(relayerHostLabel(undefined)).toBeNull();
    expect(relayerHostLabel("https://relay.example/path")).toBe("relay.example");
    expect(relayerHostLabel("not a url")).toBe("not a url");
    expect(getSuspiciousTestnetMinWithdrawFloor(18)).toBe(1_000_000_000_000n);
    expect(getSuspiciousTestnetMinWithdrawFloor(4)).toBe(1n);
  });

  test("builds withdraw quote warnings only for suspiciously low testnet minimums", () => {
    expect(
      buildWithdrawQuoteWarnings({
        chainIsTestnet: false,
        assetSymbol: "ETH",
        minWithdrawAmount: 1n,
        decimals: 18,
      }),
    ).toEqual([]);

    expect(
      buildWithdrawQuoteWarnings({
        chainIsTestnet: true,
        assetSymbol: "ETH",
        minWithdrawAmount: 1_000_000_000_000n,
        decimals: 18,
      }),
    ).toEqual([]);

    expect(
      buildWithdrawQuoteWarnings({
        chainIsTestnet: true,
        assetSymbol: "ETH",
        minWithdrawAmount: 1n,
        decimals: 18,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "TESTNET_MIN_WITHDRAW_AMOUNT_UNUSUALLY_LOW",
      }),
    ]);
  });

  test("builds direct-recipient mismatch next actions for explicit and templated assets", () => {
    expect(
      buildDirectRecipientMismatchNextActions({
        amountInput: "0.5",
        assetInput: "ETH",
        chainName: "sepolia",
        recipientAddress: "0x5555555555555555555555555555555555555555" as Address,
        signerAddress: "0x6666666666666666666666666666666666666666" as Address,
      }),
    ).toEqual([
      expect.objectContaining({
        command: "withdraw",
        when: "after_dry_run",
        cliCommand: expect.stringContaining("withdraw 0.5 ETH"),
      }),
      expect.objectContaining({
        command: "withdraw",
        when: "after_dry_run",
        cliCommand: expect.stringContaining("--direct"),
      }),
    ]);

    expect(
      buildDirectRecipientMismatchNextActions({
        amountInput: "0.5",
        assetInput: null,
        chainName: "sepolia",
        recipientAddress: "0x5555555555555555555555555555555555555555" as Address,
        signerAddress: "0x6666666666666666666666666666666666666666" as Address,
      }),
    ).toEqual([
      expect.objectContaining({
        command: "withdraw",
        runnable: false,
        parameters: [{ name: "asset", type: "asset", required: true }],
      }),
      expect.objectContaining({
        command: "withdraw",
        runnable: false,
        parameters: [{ name: "asset", type: "asset", required: true }],
      }),
    ]);
  });

  test("builds stranded-remainder next actions and renders the hint text", () => {
    const actions = buildRemainderBelowMinNextActions({
      chainName: "sepolia",
      asset: "ETH",
      decimals: 18,
      recipient: "0x5555555555555555555555555555555555555555" as Address,
      poolAccountId: "PA-7",
      poolAccountValue: 20n,
      minWithdrawAmount: 5n,
      signerAddress: "0x5555555555555555555555555555555555555555" as Address,
    });

    expect(actions).toHaveLength(4);
    expect(actions[0]).toMatchObject({
      command: "withdraw",
      reason: "Withdraw the full Pool Account balance so no stranded remainder is left behind.",
    });
    expect(actions[0]?.cliCommand).toContain("--all");
    expect(actions[1]).toMatchObject({
      command: "withdraw",
      reason: "Withdraw less so the remaining balance stays privately withdrawable.",
    });
    expect(actions[1]?.cliCommand).toContain("0.000000000000000015 ETH");
    expect(actions[2]).toMatchObject({
      command: "ragequit",
      reason: "Use the public recovery path instead of leaving a remainder below the relayer minimum.",
    });
    expect(actions[2]?.cliCommand).toContain("ragequit ETH");
    expect(actions[3]).toMatchObject({
      command: "withdraw",
      reason: "Direct mode is also valid here because the recipient already matches the signer address.",
    });
    expect(actions[3]?.cliCommand).toContain("--direct");

    expect(
      formatRelayedWithdrawalRemainderHint({
        summary: "PA-7 would keep too little.",
        choices: ["Withdraw less", "Use max"],
      }),
    ).toBe("PA-7 would keep too little.\n- Withdraw less\n- Use max");
  });

  test("validates recipient addresses and ENS inputs", () => {
    expect(
      validateRecipientAddressOrEnsInput(
        "0x5555555555555555555555555555555555555555",
      ),
    ).toBe(true);
    expect(validateRecipientAddressOrEnsInput("alice.eth")).toBe(true);
    expect(validateRecipientAddressOrEnsInput("not-an-address")).toEqual(
      expect.any(String),
    );
  });

  test("fetches anonymity-set metadata and degrades gracefully on failures", async () => {
    expect(
      await fetchWithdrawalAnonymitySet(
        { id: 1 } as { id: number } & Record<string, unknown>,
        { scope: 1n } as { scope: bigint } & Record<string, unknown>,
        10n,
      ),
    ).toEqual({
      eligible: 8,
      total: 12,
      percentage: 66.7,
    });

    fetchDepositsLargerThanMock.mockImplementationOnce(async () => {
      throw new Error("asp unavailable");
    });

    await expect(
      fetchWithdrawalAnonymitySet(
        { id: 1 } as { id: number } & Record<string, unknown>,
        { scope: 1n } as { scope: bigint } & Record<string, unknown>,
        10n,
      ),
    ).resolves.toBeUndefined();
  });

  test("writes anonymity-set hints only when a visible hint exists", () => {
    const writes: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      writeWithdrawalAnonymitySetHint(undefined, false);
      writeWithdrawalAnonymitySetHint(
        { eligible: 5, total: 10, percentage: 50 },
        true,
      );
      writeWithdrawalAnonymitySetHint(
        { eligible: 5, total: 10, percentage: 50 },
        false,
      );
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("Estimated anonymity set");
  });

  test("derives native gas token prices from the selected pool or the native fallback pool", async () => {
    expect(
      await deriveNativeGasTokenPrice(
        { id: 1 } as { id: number } & Record<string, unknown>,
        undefined,
        {
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          decimals: 18,
          totalInPoolValue: 10_000000000000000000n,
          totalInPoolValueUsd: "25000",
        } as Record<string, unknown>,
      ),
    ).toBe(2500);

    expect(
      await deriveNativeGasTokenPrice(
        { id: 1 } as { id: number } & Record<string, unknown>,
        "http://rpc.local",
        {
          asset: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          decimals: 6,
          totalInPoolValue: 1_000_000n,
          totalInPoolValueUsd: "1000000",
        } as Record<string, unknown>,
      ),
    ).toBe(2500);
    expect(listPoolsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      "http://rpc.local",
    );

    listPoolsMock.mockImplementationOnce(async () => {
      throw new Error("rpc unavailable");
    });
    await expect(
      deriveNativeGasTokenPrice(
        { id: 1 } as { id: number } & Record<string, unknown>,
        undefined,
        {
          asset: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          decimals: 6,
          totalInPoolValue: 1_000_000n,
          totalInPoolValueUsd: "1000000",
        } as Record<string, unknown>,
      ),
    ).resolves.toBeNull();
  });

  test("collects remembered and workflow recipients while tolerating unreadable workflow files", () => {
    expect(collectKnownWorkflowRecipients()).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ]);

    expect(
      collectKnownWithdrawalRecipients(
        "0x9999999999999999999999999999999999999999" as Address,
      ),
    ).toEqual([
      "0x9999999999999999999999999999999999999999",
      "0x4444444444444444444444444444444444444444",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
    ]);
  });

  test("remembers successful recipients as a best-effort cache", () => {
    rememberSuccessfulWithdrawalRecipient(
      "0x5555555555555555555555555555555555555555",
    );
    expect(rememberKnownRecipientMock).toHaveBeenCalledWith(
      "0x5555555555555555555555555555555555555555",
    );

    rememberKnownRecipientMock.mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });

    expect(() =>
      rememberSuccessfulWithdrawalRecipient(
        "0x6666666666666666666666666666666666666666",
      ),
    ).not.toThrow();
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
    expect(skippedWarnings[0]).toMatchObject({
      category: "recipient",
    });

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

  test("prompts with recent recipient choices and returns the selected entry", async () => {
    loadRecipientHistoryEntriesMock.mockImplementation(() => [
      {
        address: "0x5555555555555555555555555555555555555555",
        ensName: "alice.eth",
        label: "alice",
        source: "manual",
        useCount: 2,
        firstUsedAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    selectPromptMock.mockImplementationOnce(async () =>
      "0x5555555555555555555555555555555555555555"
    );

    await loadWithdrawHelpers();

    await expect(promptRecentRecipientAddressOrEns()).resolves.toEqual({
      address: "0x5555555555555555555555555555555555555555",
      ensName: "alice.eth",
    });
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    const promptArg = selectPromptMock.mock.calls[0]?.[0] as {
      choices?: Array<{ name: string; value: string; description?: string }>;
    };
    expect(promptArg.choices?.[0]).toMatchObject({
      name: expect.stringContaining("alice"),
      value: "0x5555555555555555555555555555555555555555",
      description: expect.stringContaining("alice.eth"),
    });
  });

  test("suspends and restores spinners around async tasks", async () => {
    const spin = {
      isSpinning: true,
      stop: mock(() => undefined),
      start: mock(() => undefined),
    };

    await expect(withSuspendedSpinner(spin, async () => "ok")).resolves.toBe("ok");
    expect(spin.stop).toHaveBeenCalledTimes(1);
    expect(spin.start).toHaveBeenCalledTimes(1);

    const idleSpin = {
      isSpinning: false,
      stop: mock(() => undefined),
      start: mock(() => undefined),
    };
    await expect(
      withSuspendedSpinner(idleSpin, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(idleSpin.stop).not.toHaveBeenCalled();
    expect(idleSpin.start).not.toHaveBeenCalled();
  });
});
