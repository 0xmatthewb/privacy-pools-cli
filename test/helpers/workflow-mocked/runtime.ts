import { mock } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { TransactionReceiptNotFoundError, type Address, type Hex } from "viem";
import { encodeRelayerWithdrawalData } from "../relayer-withdrawal-data.ts";
import {
  buildMockAccountPoolAccounts,
  GLOBAL_SIGNER_ADDRESS,
  GLOBAL_SIGNER_PRIVATE_KEY,
  MISMATCH_SIGNER_ADDRESS,
  MISMATCH_SIGNER_PRIVATE_KEY,
  NEW_WALLET_ADDRESS,
  NEW_WALLET_PRIVATE_KEY,
  confirmPromptCalls,
  confirmPromptMock,
  depositReceipt,
  inputPromptMock,
  inputPromptCalls,
  isPoolAccountCurrentlyAvailable,
  nextAspStatus,
  nextBalance,
  proveCommitmentMock,
  proveWithdrawalMock,
  realAccount,
  realAsp,
  realChains,
  realConfig,
  realContracts,
  realErrors,
  realFormat,
  realInquirerPrompts,
  realPoolAccounts,
  realPools,
  realPreflight,
  realProofs,
  realRelayer,
  realSdk,
  realViemAccounts,
  realWallet,
  realWithdraw,
  realWritePrivateFileAtomic,
  resetState,
  selectPromptMock,
  selectedPoolAccount,
  selectedSpendableCommitments,
  setPromptResponses,
  state,
  useImmediateTimers,
  writePrivateFileAtomicMock,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
} from "./shared.ts";

const loadPrivateKeyMock = mock(() => {
  state.loadPrivateKeyCalls += 1;
  if (!state.currentSignerPrivateKey) {
    throw new Error("No signer key found.");
  }
  return state.currentSignerPrivateKey;
});

const loadMnemonicMock = mock(() => "test test test test test test test test test test test junk");

const approveErc20Mock = mock(async () => {
  state.approveErc20Calls += 1;
  return { hash: state.approvalTxHash };
});

export const depositEthMock = mock(async () => {
  state.depositEthCalls += 1;
  if (state.depositEthFailuresRemaining > 0) {
    state.depositEthFailuresRemaining -= 1;
    throw new Error("Simulated ETH deposit submission failure");
  }
  state.poolAccountAvailable = true;
  return { hash: state.depositTxHash };
});

const depositErc20Mock = mock(async () => {
  state.depositErc20Calls += 1;
  if (state.depositErc20FailuresRemaining > 0) {
    state.depositErc20FailuresRemaining -= 1;
    throw new Error("Simulated ERC20 deposit submission failure");
  }
  state.poolAccountAvailable = true;
  return { hash: state.depositTxHash };
});

const submitRagequitMock = mock(async (
  _chainConfig,
  _poolAddress,
  _proof,
  _rpcOverride,
  _privateKeyOverride,
  statusHooks?: {
    onSimulating?: () => Promise<void> | void;
    onBroadcasting?: () => Promise<void> | void;
  },
) => {
  state.submitRagequitCalls += 1;
  await statusHooks?.onSimulating?.();
  await statusHooks?.onBroadcasting?.();
  return { hash: state.ragequitTxHash };
});

export const getDataServiceMock = mock(async () => ({ service: "data" }));
export const initializeAccountServiceMock = mock(async () => accountService);
export const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
export const resolvePoolMock = mock(async () => state.pool);
const getRelayerDetailsMock = mock(async () => ({
  feeReceiverAddress: state.feeReceiverAddress,
  minWithdrawAmount: state.minWithdrawAmount.toString(),
  relayerUrl: state.relayerUrl,
}));

export function buildMockRelayerQuote(
  args: {
    amount: bigint;
    asset: Address;
    extraGas: boolean;
    recipient: Address;
    relayerUrl?: string;
  },
  overrides: {
    feeBPS?: string;
    expirationMs?: number;
    feeRecipient?: Address;
    signedRelayerCommitment?: Hex;
    relayerUrl?: string;
  } = {},
) {
  const feeBPS = overrides.feeBPS ?? "50";
  const expirationMs = overrides.expirationMs ?? Date.now() + 60_000;
  return {
    baseFeeBPS: feeBPS,
    gasPrice: "1",
    detail: {
      relayTxCost: {
        gas: "0",
        eth: "0",
      },
    },
    feeBPS,
    feeCommitment: {
      expiration: expirationMs,
      withdrawalData: encodeRelayerWithdrawalData({
        recipient: args.recipient,
        feeRecipient: overrides.feeRecipient ?? state.feeReceiverAddress,
        relayFeeBPS: BigInt(feeBPS),
      }),
      asset: args.asset,
      amount: args.amount.toString(),
      extraGas: args.extraGas,
      signedRelayerCommitment: overrides.signedRelayerCommitment ?? "0xfeed",
    },
    expiresAt: new Date(expirationMs).toISOString(),
    relayerUrl: overrides.relayerUrl ?? args.relayerUrl ?? state.relayerUrl,
  };
}

export const requestQuoteMock = mock(async (
  _chain: unknown,
  args: {
    amount: bigint;
    asset: Address;
    extraGas: boolean;
    recipient: Address;
    relayerUrl?: string;
  },
) => {
  state.requestQuoteCalls.push(args);
  return buildMockRelayerQuote(args, { relayerUrl: args.relayerUrl });
});
export const submitRelayRequestMock = mock(async () => ({
  txHash: state.relayTxHash,
}));
const getRelayedWithdrawalRemainderAdvisoryMock = mock(() => null);
export const refreshExpiredRelayerQuoteForWithdrawalMock = mock(async () => ({
  quote: buildMockRelayerQuote({
    amount: state.committedValue,
    asset: state.pool.asset,
    extraGas: state.pool.symbol !== "ETH",
    recipient: "0x7777777777777777777777777777777777777777",
  }),
  quoteFeeBPS: 50n,
  expirationMs: Date.now() + 60_000,
}));
export const validateRelayerQuoteForWithdrawalMock = mock((quote?: {
  feeCommitment?: { expiration?: number };
}) => ({
  quoteFeeBPS: 50n,
  expirationMs: quote?.feeCommitment?.expiration ?? Date.now() + 60_000,
}));

const fetchDepositReviewStatusesMock = mock(async () => {
  if (state.aspUnavailable) {
    throw new Error("ASP unavailable");
  }
  const aspStatus = nextAspStatus();
  return aspStatus === "approved"
    ? {}
    : { [state.label.toString()]: aspStatus };
});

const fetchMerkleLeavesMock = mock(async () => {
  if (state.aspUnavailable) {
    throw new Error("ASP unavailable");
  }
  return {
    aspLeaves: state.aspStatus === "approved" ? [state.label.toString()] : [],
    stateTreeLeaves: [state.commitmentHash.toString()],
  };
});

const fetchMerkleRootsMock = mock(async () => {
  if (state.aspUnavailable) {
    throw new Error("ASP unavailable");
  }
  return {
    mtRoot: state.aspMtRoot.toString(),
    onchainMtRoot: state.latestRoot.toString(),
  };
});

export const publicClient = {
  getGasPrice: mock(async () => {
    if (state.gasPriceError) {
      throw new Error("gas price unavailable");
    }
    return state.gasPrice;
  }),
  getBalance: mock(async () =>
    nextBalance(state.nativeBalanceSequence, state.nativeBalance),
  ),
  readContract: mock(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "balanceOf":
        return nextBalance(state.tokenBalanceSequence, state.tokenBalance);
      case "currentRoot":
        return state.currentRoot;
      case "ROOT_HISTORY_SIZE":
        return 1n;
      case "roots":
        return state.currentRoot;
      case "latestRoot":
        return nextBalance(state.latestRootSequence, state.latestRoot);
      case "depositors":
        return state.onchainDepositor;
      default:
        return 0n;
    }
  }),
  waitForTransactionReceipt: mock(async ({ hash }: { hash: Hex }) => {
    if (hash === state.depositTxHash) {
      if (state.depositConfirmationMode === "timeout") {
        throw new Error("deposit confirmation unavailable");
      }
      if (state.depositConfirmationMode === "reverted") {
        return {
          status: "reverted" as const,
          blockNumber: 101n,
          logs: [],
        };
      }
      const depositor =
        state.pool.asset.toLowerCase() === "0x0000000000000000000000000000000000000000"
          ? (state.currentSignerPrivateKey
              ? realViemAccounts.privateKeyToAccount(state.currentSignerPrivateKey).address
              : NEW_WALLET_ADDRESS)
          : NEW_WALLET_ADDRESS;
      if (state.depositConfirmationMode === "missing_metadata") {
        return {
          status: "success" as const,
          blockNumber: 101n,
          logs: [],
        };
      }
      return depositReceipt(depositor);
    }
    if (hash === state.relayTxHash) {
      if (state.relayReceiptMode === "timeout") {
        throw new Error("relay confirmation unavailable");
      }
      return {
        status:
          state.relayReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 202n,
        logs: [],
      };
    }
    if (hash === state.ragequitTxHash) {
      if (state.ragequitReceiptMode === "timeout") {
        throw new Error("ragequit confirmation unavailable");
      }
      return {
        status:
          state.ragequitReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 303n,
        logs: [],
      };
    }
    if (hash === state.approvalTxHash) {
      if (state.approvalReceiptMode === "timeout") {
        throw new Error("approval confirmation unavailable");
      }
      return {
        status:
          state.approvalReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 100n,
        logs: [],
      };
    }
    throw new Error(`Unexpected receipt lookup: ${hash}`);
  }),
  getTransactionReceipt: mock(async ({ hash }: { hash: Hex }) => {
    if (hash === state.relayTxHash) {
      if (state.relayReceiptMode === "timeout") {
        throw new TransactionReceiptNotFoundError({ hash });
      }
      return {
        status:
          state.relayReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 202n,
        logs: [],
      };
    }
    if (hash === state.ragequitTxHash) {
      state.getTransactionReceiptCalls += 1;
      if (state.ragequitPendingReceiptMode === "pending") {
        if (
          state.getTransactionReceiptCalls <=
          state.ragequitPendingReceiptAvailableAfter
        ) {
          throw new TransactionReceiptNotFoundError({ hash });
        }
        return null;
      }
      if (state.ragequitPendingReceiptMode === "reverted") {
        return {
          status: "reverted" as const,
          blockNumber: 303n,
          logs: [],
        };
      }
      return {
        status: "success" as const,
        blockNumber: 303n,
        logs: [],
      };
    }
    if (hash !== state.depositTxHash) {
      throw new Error(`Unknown tx: ${hash}`);
    }
    state.getTransactionReceiptCalls += 1;
    if (state.pendingReceiptMode === "reverted") {
      return {
        status: "reverted" as const,
        blockNumber: 101n,
        logs: [],
      };
    }
    if (state.getTransactionReceiptCalls <= state.pendingReceiptAvailableAfter) {
      throw new TransactionReceiptNotFoundError({ hash });
    }
    return depositReceipt(NEW_WALLET_ADDRESS);
  }),
};

const accountService = {
  get account() {
    return {
      poolAccounts: buildMockAccountPoolAccounts(),
    };
  },
  createDepositSecrets: mock(() => ({
    precommitment: state.precommitmentHash,
    nullifier: 111n,
    secret: 222n,
  })),
  addPoolAccount: mock(() => {
    state.addPoolAccountCalls += 1;
  }),
  getSpendableCommitments: mock(() =>
    new Map([[state.pool.scope, selectedSpendableCommitments()]]),
  ),
  createWithdrawalSecrets: mock(() => ({
    nullifier: 333n,
    secret: 444n,
  })),
  addWithdrawalCommitment: mock(() => {
    state.addWithdrawalCommitmentCalls += 1;
  }),
  addRagequitToAccount: mock(() => {
    state.addRagequitCalls += 1;
  }),
};

function buildMockPoolAccountRefClassification() {
  const allRefs = isPoolAccountCurrentlyAvailable() ? [selectedPoolAccount()] : [];
  const activeRefs = isPoolAccountCurrentlyAvailable() &&
      state.poolAccountStatus !== "spent" &&
      state.poolAccountStatus !== "exited"
    ? [selectedPoolAccount()]
    : [];

  return { allRefs, activeRefs };
}

type WorkflowModuleType = typeof import("../../../src/services/workflow.ts");
export let getWorkflowStatus: WorkflowModuleType["getWorkflowStatus"];
export let loadWorkflowSnapshot: WorkflowModuleType["loadWorkflowSnapshot"];
export let overrideWorkflowTimingForTests: WorkflowModuleType["overrideWorkflowTimingForTests"];
export let ragequitWorkflow: WorkflowModuleType["ragequitWorkflow"];
export let startWorkflow: WorkflowModuleType["startWorkflow"];
export let watchWorkflow: WorkflowModuleType["watchWorkflow"];

export function failWorkflowSnapshotWriteOnCall(
  workflowId: string | null,
  callNumber: number,
): void {
  let workflowWriteCalls = 0;
  const workflowsDir = realConfig.getWorkflowsDir();
  writePrivateFileAtomicMock.mockImplementation((filePath, content) => {
    const matchesWorkflowSnapshot = workflowId
      ? filePath === join(workflowsDir, `${workflowId}.json`)
      : filePath.startsWith(`${workflowsDir}/`) && filePath.endsWith(".json");
    if (matchesWorkflowSnapshot) {
      workflowWriteCalls += 1;
      if (workflowWriteCalls === callNumber) {
        throw new Error("disk full");
      }
    }
    return realWritePrivateFileAtomic(filePath, content);
  });
}

export async function installWorkflowMocks(): Promise<void> {
  mock.module("../../../src/services/config.ts", () => ({
    ...realConfig,
    loadConfig: () => ({
      defaultChain: "sepolia",
    }),
    writePrivateFileAtomic: writePrivateFileAtomicMock,
  }));

  mock.module("../../../src/services/wallet.ts", () => ({
    ...realWallet,
    loadMnemonic: loadMnemonicMock,
    loadPrivateKey: loadPrivateKeyMock,
  }));

  mock.module("../../../src/services/pools.ts", () => ({
    ...realPools,
    resolvePool: resolvePoolMock,
  }));

  mock.module("../../../src/services/sdk.ts", () => ({
    ...realSdk,
    getPublicClient: mock(() => publicClient),
    getDataService: getDataServiceMock,
  }));

  mock.module("../../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountService: initializeAccountServiceMock,
    saveAccount: saveAccountMock,
    saveSyncMeta: saveSyncMetaMock,
    withSuppressedSdkStdoutSync: <T>(fn: () => T) => fn(),
  }));

  mock.module("../../../src/services/asp.ts", () => ({
    ...realAsp,
    buildLoadedAspDepositReviewState: mock(() => ({
      approvedLabels:
        state.aspStatus === "approved" ? [state.label] : [],
      reviewStatuses:
        state.aspStatus === "approved"
          ? {}
          : { [state.label.toString()]: state.aspStatus },
    })),
    fetchDepositReviewStatuses: fetchDepositReviewStatusesMock,
    fetchMerkleLeaves: fetchMerkleLeavesMock,
    fetchMerkleRoots: fetchMerkleRootsMock,
  }));

  mock.module("../../../src/services/contracts.ts", () => ({
    ...realContracts,
    approveERC20: approveErc20Mock,
    depositERC20: depositErc20Mock,
    depositETH: depositEthMock,
    ragequit: submitRagequitMock,
  }));

  mock.module("../../../src/services/proofs.ts", () => ({
    ...realProofs,
    proveCommitment: proveCommitmentMock,
    proveWithdrawal: proveWithdrawalMock,
  }));

  mock.module("../../../src/services/relayer.ts", () => ({
    ...realRelayer,
    getRelayerDetails: getRelayerDetailsMock,
    requestQuote: requestQuoteMock,
    submitRelayRequest: submitRelayRequestMock,
  }));

  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    select: selectPromptMock,
  }));

  mock.module("../../../src/utils/preflight.ts", () => ({
    ...realPreflight,
    checkErc20Balance: mock(async () => undefined),
    checkHasGas: mock(async () => undefined),
    checkNativeBalance: mock(async () => undefined),
  }));

  mock.module("../../../src/utils/proof-progress.ts", () => ({
    withProofProgress: async (
      _spin: unknown,
      _label: string,
      fn: (_progress: unknown) => Promise<unknown>,
    ) => fn({}),
  }));

  mock.module("../../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
    classifyPoolAccountRefs: mock(() => buildMockPoolAccountRefClassification()),
    buildAllPoolAccountRefs: mock(() =>
      buildMockPoolAccountRefClassification().allRefs,
    ),
    buildPoolAccountRefs: mock(() =>
      buildMockPoolAccountRefClassification().activeRefs,
    ),
    collectActiveLabels: mock(() => [state.label]),
    getNextPoolAccountNumber: mock(() => 7),
    poolAccountId: (paNumber: number) => `PA-${paNumber}`,
  }));

  mock.module("../../../src/commands/withdraw.ts", () => ({
    ...realWithdraw,
    getRelayedWithdrawalRemainderAdvisory:
      getRelayedWithdrawalRemainderAdvisoryMock,
    refreshExpiredRelayerQuoteForWithdrawal:
      refreshExpiredRelayerQuoteForWithdrawalMock,
    validateRelayerQuoteForWithdrawal:
      validateRelayerQuoteForWithdrawalMock,
  }));

  mock.module("../../../src/utils/format.ts", () => ({
    ...realFormat,
    spinner: () => ({
      text: "",
      start() {},
      stop() {},
      succeed() {},
      fail() {},
    }),
    stageHeader: () => undefined,
    verbose: () => undefined,
  }));

  mock.module("viem/accounts", () => ({
    ...realViemAccounts,
    generatePrivateKey: () => NEW_WALLET_PRIVATE_KEY,
  }));

  try {
    const workflowModule = await import("../../../src/services/workflow.ts");
    ({
      getWorkflowStatus,
      loadWorkflowSnapshot,
      overrideWorkflowTimingForTests,
      ragequitWorkflow,
      startWorkflow,
      watchWorkflow,
    } = workflowModule);
  } finally {
    mock.module("../../../src/utils/format.ts", () => realFormat);
  }
}

export function resetWorkflowMockImplementations(): void {
  if (state.tempHome) {
    rmSync(state.tempHome, { recursive: true, force: true });
  }
  resetState();
  overrideWorkflowTimingForTests();
  process.env.PRIVACY_POOLS_HOME = state.tempHome;
  setPromptResponses();
  getDataServiceMock.mockClear();
  getDataServiceMock.mockImplementation(async () => ({ service: "data" }));
  initializeAccountServiceMock.mockClear();
  initializeAccountServiceMock.mockImplementation(async () => accountService);
  saveAccountMock.mockClear();
  saveAccountMock.mockImplementation(() => undefined);
  saveSyncMetaMock.mockClear();
  saveSyncMetaMock.mockImplementation(() => undefined);
  writePrivateFileAtomicMock.mockClear();
  writePrivateFileAtomicMock.mockImplementation((filePath, content) =>
    realWritePrivateFileAtomic(filePath, content),
  );
  resolvePoolMock.mockClear();
  resolvePoolMock.mockImplementation(async () => state.pool);
  getRelayerDetailsMock.mockClear();
  getRelayerDetailsMock.mockImplementation(async () => ({
    feeReceiverAddress: state.feeReceiverAddress,
    minWithdrawAmount: state.minWithdrawAmount.toString(),
    relayerUrl: state.relayerUrl,
  }));
  requestQuoteMock.mockClear();
  requestQuoteMock.mockImplementation(async (_chain, args) => {
    state.requestQuoteCalls.push(args);
    return buildMockRelayerQuote(args, { relayerUrl: args.relayerUrl });
  });
  submitRelayRequestMock.mockClear();
  submitRelayRequestMock.mockImplementation(async () => ({
    txHash: state.relayTxHash,
  }));
  getRelayedWithdrawalRemainderAdvisoryMock.mockClear();
  getRelayedWithdrawalRemainderAdvisoryMock.mockImplementation(() => null);
  refreshExpiredRelayerQuoteForWithdrawalMock.mockClear();
  refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementation(async () => ({
    quote: buildMockRelayerQuote({
      amount: state.committedValue,
      asset: state.pool.asset,
      extraGas: state.pool.symbol !== "ETH",
      recipient: "0x7777777777777777777777777777777777777777",
    }),
    quoteFeeBPS: 50n,
    expirationMs: Date.now() + 60_000,
  }));
  validateRelayerQuoteForWithdrawalMock.mockClear();
  validateRelayerQuoteForWithdrawalMock.mockImplementation(() => ({
    quoteFeeBPS: 50n,
    expirationMs: Date.now() + 60_000,
  }));
  proveCommitmentMock.mockClear();
  proveCommitmentMock.mockImplementation(async () => ({
    proof: {
      pi_a: [1n, 2n],
      pi_b: [
        [3n, 4n],
        [5n, 6n],
      ],
      pi_c: [7n, 8n],
    },
    publicSignals: [9n, 10n, 11n, 12n],
  }));
  proveWithdrawalMock.mockClear();
  proveWithdrawalMock.mockImplementation(async () => ({
    proof: {
      pi_a: [1n, 2n],
      pi_b: [
        [3n, 4n],
        [5n, 6n],
      ],
      pi_c: [7n, 8n],
    },
    publicSignals: [13n, 14n, 15n, 16n],
  }));
}

export function cleanupWorkflowMockEnvironment(): void {
  delete process.env.PRIVACY_POOLS_HOME;
  if (state.tempHome) {
    rmSync(state.tempHome, { recursive: true, force: true });
    state.tempHome = "";
  }
}

export {
  confirmPromptCalls,
  GLOBAL_SIGNER_ADDRESS,
  GLOBAL_SIGNER_PRIVATE_KEY,
  inputPromptCalls,
  MISMATCH_SIGNER_ADDRESS,
  MISMATCH_SIGNER_PRIVATE_KEY,
  NEW_WALLET_ADDRESS,
  NEW_WALLET_PRIVATE_KEY,
  proveWithdrawalMock,
  realConfig,
  realErrors,
  realWritePrivateFileAtomic,
  setPromptResponses,
  state,
  useImmediateTimers,
  writePrivateFileAtomicMock,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
};
