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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { CHAINS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import { CLIError } from "../../src/utils/errors.ts";
import type { FlowSnapshot } from "../../src/services/workflow.ts";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import { captureAsyncOutput } from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const realFormat = await import("../../src/utils/format.ts");
const realInquirerPrompts = await import("@inquirer/prompts");
const realSdk = await import("../../src/services/sdk.ts");
const realAccount = await import("../../src/services/account.ts");
const realWallet = await import("../../src/services/wallet.ts");
const realPools = await import("../../src/services/pools.ts");
const realSdkPackage = await import("@0xbow/privacy-pools-core-sdk");
const realAsp = await import("../../src/services/asp.ts");
const realPoolAccounts = await import("../../src/utils/pool-accounts.ts");
const realRelayer = await import("../../src/services/relayer.ts");
const realProofs = await import("../../src/services/proofs.ts");

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

const ETH_POOL = {
  asset: NATIVE_ASSET_ADDRESS,
  pool: "0x1111111111111111111111111111111111111111" as Address,
  symbol: "ETH",
  decimals: 18,
  scope: 1n,
  deploymentBlock: 1n,
  minimumDepositAmount: 1n,
  vettingFeeBPS: 50n,
  maxRelayFeeBPS: 300n,
};

const USDC_POOL = {
  ...ETH_POOL,
  asset: "0x2222222222222222222222222222222222222222" as Address,
  symbol: "USDC",
  decimals: 6,
};

type MockPoolAccount = {
  paNumber: number;
  paId: string;
  status:
    | "approved"
    | "pending"
    | "declined"
    | "poi_required"
    | "unknown"
    | "spent"
    | "exited";
  aspStatus:
    | "approved"
    | "pending"
    | "declined"
    | "poi_required"
    | "unknown";
  label: bigint;
  value: bigint;
  blockNumber?: bigint;
  txHash?: Hex;
  commitment: {
    hash: bigint;
    label: bigint;
    value: bigint;
    nullifier: bigint;
    secret: bigint;
    blockNumber: bigint;
    txHash: Hex;
  };
};

interface MockState {
  gasPrice: bigint;
  gasPriceError: boolean;
  nativeBalance: bigint;
  tokenBalance: bigint;
  depositReceiptMode: "success" | "missing" | "reverted" | "missing_metadata";
  withdrawReceiptMode: "success" | "missing" | "reverted";
  ragequitReceiptMode: "success" | "missing" | "reverted";
  relayReceiptMode: "success" | "timeout" | "reverted";
  refreshInitError: boolean;
  warnings: string[];
  resolvedPool: typeof ETH_POOL;
  latestRoot: bigint;
  poolCurrentRoot: bigint;
  accountServiceResult: {
    account: { poolAccounts: Map<unknown, unknown> };
    getSpendableCommitments: () => Map<bigint, MockPoolAccount["commitment"][]>;
    createWithdrawalSecrets: () => { nullifier: bigint; secret: bigint };
    addWithdrawalCommitment: (...args: unknown[]) => void;
  };
  allPoolAccounts: MockPoolAccount[];
  activePoolAccounts: MockPoolAccount[];
  aspRoots: { mtRoot: string; onchainMtRoot: string };
  aspLeaves: { aspLeaves: string[]; stateTreeLeaves: string[] };
  reviewStatuses: Map<string, MockPoolAccount["aspStatus"]>;
  relayerDetails: {
    minWithdrawAmount: string;
    feeReceiverAddress: Address;
  };
  relayerQuote: {
    feeBPS: string;
    feeCommitment: {
      expiration: number;
      asset: Address;
      amount: string;
      extraGas: boolean;
      signedRelayerCommitment: Hex;
      withdrawalData: Hex;
    };
  };
  remainderAdvisory: string | null;
  relayTxHash: Hex;
}

const state: MockState = {} as MockState;
const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

const getDataServiceMock = mock(async () => ({ service: "data" }));
const initializeAccountServiceMock = mock(async () => state.accountServiceResult);
const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
const acquireProcessLockMock = mock(() => () => undefined);
const guardCriticalSectionMock = mock(() => undefined);
const releaseCriticalSectionMock = mock(() => undefined);
const getPublicClientMock = mock(() => ({
  getGasPrice: async () => state.gasPrice,
  getBalance: async () => state.nativeBalance,
  readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === "balanceOf") return state.tokenBalance;
    if (functionName === "currentRoot") return state.poolCurrentRoot;
    if (functionName === "latestRoot") return state.latestRoot;
    return 0n;
  },
  waitForTransactionReceipt: async () => {
    if (state.relayReceiptMode === "timeout") {
      throw new Error("timed out");
    }
    return {
      status:
        state.relayReceiptMode === "reverted"
          ? ("reverted" as const)
          : ("success" as const),
      blockNumber: 999n,
    };
  },
  getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
    if (hash === ("0x" + "aa".repeat(32)) as Hex) {
      if (state.depositReceiptMode === "missing") {
        throw new Error("pending");
      }
      if (state.depositReceiptMode === "reverted") {
        return {
          status: "reverted" as const,
          blockNumber: 123n,
          logs: [],
        };
      }
      if (state.depositReceiptMode === "missing_metadata") {
        return {
          status: "success" as const,
          blockNumber: 123n,
          logs: [],
        };
      }

      return {
        status: "success" as const,
        blockNumber: 123n,
        logs: [
          {
            address: state.resolvedPool.pool,
            topics: encodeEventTopics({
              abi: depositedEventAbi,
              eventName: "Deposited",
              args: {
                _depositor:
                  "0x3333333333333333333333333333333333333333" as Address,
              },
            }),
            data: encodeAbiParameters(
              [
                { name: "_commitment", type: "uint256" },
                { name: "_label", type: "uint256" },
                { name: "_value", type: "uint256" },
                { name: "_precommitmentHash", type: "uint256" },
              ],
              [88n, 99n, 777n, 44n],
            ),
          },
        ],
      };
    }

    if (hash === ("0x" + "bb".repeat(32)) as Hex) {
      if (state.withdrawReceiptMode === "missing") {
        throw new Error("pending");
      }
      return {
        status:
          state.withdrawReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 456n,
        logs: [],
      };
    }

    if (hash === ("0x" + "cc".repeat(32)) as Hex) {
      if (state.ragequitReceiptMode === "missing") {
        throw new Error("pending");
      }
      return {
        status:
          state.ragequitReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 789n,
        logs: [],
      };
    }

    throw new Error(`Unexpected tx lookup: ${hash}`);
  },
}));
const loadMnemonicMock = mock(
  () => "test test test test test test test test test test test junk",
);
const resolvePoolMock = mock(async () => state.resolvedPool);
const fetchMerkleRootsMock = mock(async () => state.aspRoots);
const fetchMerkleLeavesMock = mock(async () => state.aspLeaves);
const fetchDepositReviewStatusesMock = mock(async () => state.reviewStatuses);
const buildLoadedAspDepositReviewStateMock = mock(
  (
    _activeLabels: string[],
    approvedLabels: Set<string>,
    rawReviewStatuses: ReadonlyMap<string, MockPoolAccount["aspStatus"]>,
  ) => ({
    approvedLabels,
    reviewStatuses: rawReviewStatuses,
  }),
);
const buildAllPoolAccountRefsMock = mock(() => state.allPoolAccounts);
const buildPoolAccountRefsMock = mock(() => state.activePoolAccounts);
const collectActiveLabelsMock = mock(() =>
  state.activePoolAccounts.map((poolAccount) => poolAccount.label.toString()),
);
const getNextPoolAccountNumberMock = mock(() => 8);
const poolAccountIdMock = mock((poolAccountNumber: number) => `PA-${poolAccountNumber}`);
const getRelayerDetailsMock = mock(async () => state.relayerDetails);
const requestQuoteMock = mock(async () => ({
  baseFeeBPS: "200",
  gasPrice: "1",
  detail: { relayTxCost: { gas: "0", eth: "0" } },
  ...state.relayerQuote,
}));
const submitRelayRequestMock = mock(async () => ({
  txHash: state.relayTxHash,
}));
const proveWithdrawalMock = mock(async () => ({
  proof: {
    pi_a: ["0", "0", "1"],
    pi_b: [
      ["0", "0"],
      ["0", "0"],
      ["1", "0"],
    ],
    pi_c: ["0", "0", "1"],
  },
  publicSignals: [1n, 2n, 3n],
}));
const withProofProgressMock = mock(
  async <T>(_spin: unknown, _label: string, build: () => Promise<T>) =>
    await build(),
);
const generateMerkleProofMock = mock(() => ({
  root: state.poolCurrentRoot,
  siblings: [],
  pathIndices: [],
}));
const calculateContextMock = mock(() => 777n);
const getRelayedWithdrawalRemainderAdvisoryMock = mock(
  () => state.remainderAdvisory,
);
const validateRelayerQuoteForWithdrawalMock = mock(
  (quote: typeof state.relayerQuote) => ({
    quoteFeeBPS: BigInt(quote.feeBPS),
    expirationMs: quote.feeCommitment.expiration,
  }),
);
const refreshExpiredRelayerQuoteForWithdrawalMock = mock(
  async ({
    fetchQuote,
  }: {
    fetchQuote: () => Promise<typeof state.relayerQuote>;
  }) => {
    const refreshed = await fetchQuote();
    return {
      quote: refreshed,
      quoteFeeBPS: BigInt(refreshed.feeBPS),
      expirationMs: refreshed.feeCommitment.expiration,
    };
  },
);
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () => "");
const selectPromptMock = mock(async () => "copied");

let getFlowFundingRequirements: typeof import("../../src/services/workflow.ts").getFlowFundingRequirements;
let readFlowFundingState: typeof import("../../src/services/workflow.ts").readFlowFundingState;
let getNextFlowPoolAccountRef: typeof import("../../src/services/workflow.ts").getNextFlowPoolAccountRef;
let inspectFundingAndDeposit: typeof import("../../src/services/workflow.ts").inspectFundingAndDeposit;
let setupNewWalletWorkflow: typeof import("../../src/services/workflow.ts").setupNewWalletWorkflow;
let reconcilePendingDepositReceipt: typeof import("../../src/services/workflow.ts").reconcilePendingDepositReceipt;
let reconcilePendingWithdrawalReceipt: typeof import("../../src/services/workflow.ts").reconcilePendingWithdrawalReceipt;
let reconcilePendingRagequitReceipt: typeof import("../../src/services/workflow.ts").reconcilePendingRagequitReceipt;
let loadWorkflowPoolAccountContext: typeof import("../../src/services/workflow.ts").loadWorkflowPoolAccountContext;
let executeRelayedWithdrawalForFlow: typeof import("../../src/services/workflow.ts").executeRelayedWithdrawalForFlow;
let continueApprovedWorkflowWithdrawal: typeof import("../../src/services/workflow.ts").continueApprovedWorkflowWithdrawal;

function sampleSnapshot(
  patch: Partial<FlowSnapshot> = {},
): FlowSnapshot {
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId: "wf-internal",
    createdAt: "2026-03-24T12:00:00.000Z",
    updatedAt: "2026-03-24T12:00:00.000Z",
    phase: "depositing_publicly",
    walletMode: "new_wallet",
    walletAddress: "0x4444444444444444444444444444444444444444",
    assetDecimals: 18,
    requiredNativeFunding: "1000",
    requiredTokenFunding: null,
    backupConfirmed: true,
    chain: "sepolia",
    asset: "ETH",
    depositAmount: "500",
    recipient: "0x5555555555555555555555555555555555555555",
    poolAccountId: "PA-7",
    poolAccountNumber: 7,
    depositTxHash: "0x" + "aa".repeat(32),
    depositBlockNumber: null,
    depositExplorerUrl: "https://example.invalid/deposit",
    depositLabel: "91",
    committedValue: "995",
    aspStatus: "pending",
    ...patch,
  };
}

const JSON_MODE = {
  isAgent: true,
  isJson: true,
  isCsv: false,
  isQuiet: true,
  format: "json" as const,
  skipPrompts: true,
};

beforeAll(async () => {
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getDataService: getDataServiceMock,
    getPublicClient: () => {
      if (state.gasPriceError) {
        return {
          ...getPublicClientMock(),
          getGasPrice: async () => {
            throw new Error("gas unavailable");
          },
        };
      }
      return getPublicClientMock();
    },
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountService: async () => {
      if (state.refreshInitError) {
        throw new Error("refresh failed");
      }
      return initializeAccountServiceMock();
    },
    saveAccount: saveAccountMock,
    saveSyncMeta: saveSyncMetaMock,
    withSuppressedSdkStdoutSync: <T>(fn: () => T): T => fn(),
  }));
  mock.module("../../src/services/wallet.ts", () => ({
    ...realWallet,
    loadMnemonic: loadMnemonicMock,
    loadPrivateKey: () =>
      "0x1111111111111111111111111111111111111111111111111111111111111111",
  }));
  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    resolvePool: resolvePoolMock,
  }));
  mock.module("../../src/services/asp.ts", () => ({
    ...realAsp,
    buildLoadedAspDepositReviewState: buildLoadedAspDepositReviewStateMock,
    fetchDepositReviewStatuses: fetchDepositReviewStatusesMock,
    fetchMerkleLeaves: fetchMerkleLeavesMock,
    fetchMerkleRoots: fetchMerkleRootsMock,
  }));
  mock.module("../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
    buildAllPoolAccountRefs: buildAllPoolAccountRefsMock,
    buildPoolAccountRefs: buildPoolAccountRefsMock,
    collectActiveLabels: collectActiveLabelsMock,
    getNextPoolAccountNumber: getNextPoolAccountNumberMock,
    poolAccountId: poolAccountIdMock,
  }));
  mock.module("../../src/services/relayer.ts", () => ({
    ...realRelayer,
    getRelayerDetails: getRelayerDetailsMock,
    requestQuote: requestQuoteMock,
    submitRelayRequest: submitRelayRequestMock,
  }));
  mock.module("../../src/services/proofs.ts", () => ({
    ...realProofs,
    proveWithdrawal: proveWithdrawalMock,
  }));
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    select: selectPromptMock,
  }));
  mock.module("../../src/utils/proof-progress.ts", () => ({
    withProofProgress: withProofProgressMock,
  }));
  mock.module("@0xbow/privacy-pools-core-sdk", () => ({
    ...realSdkPackage,
    calculateContext: calculateContextMock,
    generateMerkleProof: generateMerkleProofMock,
  }));
  mock.module("../../src/commands/withdraw.ts", () => ({
    getRelayedWithdrawalRemainderAdvisory:
      getRelayedWithdrawalRemainderAdvisoryMock,
    refreshExpiredRelayerQuoteForWithdrawal:
      refreshExpiredRelayerQuoteForWithdrawalMock,
    validateRelayerQuoteForWithdrawal:
      validateRelayerQuoteForWithdrawalMock,
  }));
  mock.module("../../src/utils/format.ts", () => ({
    ...realFormat,
    info: () => undefined,
    stageHeader: () => undefined,
    spinner: () => ({
      text: "",
      start() {},
      stop() {},
      succeed() {},
    }),
    warn: (message: string) => {
      state.warnings.push(message);
    },
    verbose: () => undefined,
  }));
  mock.module("../../src/utils/lock.ts", () => ({
    acquireProcessLock: acquireProcessLockMock,
  }));
  mock.module("../../src/utils/critical-section.ts", () => ({
    guardCriticalSection: guardCriticalSectionMock,
    releaseCriticalSection: releaseCriticalSectionMock,
  }));

  ({
    getFlowFundingRequirements,
    readFlowFundingState,
    getNextFlowPoolAccountRef,
    inspectFundingAndDeposit,
    setupNewWalletWorkflow,
    loadWorkflowPoolAccountContext,
    executeRelayedWithdrawalForFlow,
    continueApprovedWorkflowWithdrawal,
    reconcilePendingDepositReceipt,
    reconcilePendingWithdrawalReceipt,
    reconcilePendingRagequitReceipt,
  } = await import("../../src/services/workflow.ts?workflow-internal-tests"));

  // Restore real formatting for later imports in this Bun process.
  mock.module("../../src/utils/format.ts", () => realFormat);
});

afterAll(() => {
  mock.restore();
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
});

afterEach(() => {
  cleanupTrackedTempDirs();
});

beforeEach(() => {
  process.env.PRIVACY_POOLS_HOME = createTrackedTempDir(
    "pp-workflow-internal-",
  );
  const activePoolAccount: MockPoolAccount = {
    paNumber: 7,
    paId: "PA-7",
    status: "approved",
    aspStatus: "approved",
    label: 91n,
    value: 500n,
    blockNumber: 123n,
    txHash: ("0x" + "aa".repeat(32)) as Hex,
    commitment: {
      hash: 88n,
      label: 91n,
      value: 500n,
      nullifier: 92n,
      secret: 93n,
      blockNumber: 123n,
      txHash: ("0x" + "aa".repeat(32)) as Hex,
    },
  };
  state.gasPrice = 10n;
  state.gasPriceError = false;
  state.nativeBalance = 2_000n;
  state.tokenBalance = 3_000n;
  state.depositReceiptMode = "success";
  state.withdrawReceiptMode = "success";
  state.ragequitReceiptMode = "success";
  state.relayReceiptMode = "success";
  state.refreshInitError = false;
  state.warnings = [];
  state.resolvedPool = ETH_POOL;
  state.latestRoot = 1n;
  state.poolCurrentRoot = 1n;
  state.accountServiceResult = {
    account: { poolAccounts: new Map() },
    getSpendableCommitments: () => new Map([[1n, [activePoolAccount.commitment]]]),
    createWithdrawalSecrets: () => ({ nullifier: 901n, secret: 902n }),
    addWithdrawalCommitment: () => undefined,
  };
  state.allPoolAccounts = [activePoolAccount];
  state.activePoolAccounts = [activePoolAccount];
  state.aspRoots = { mtRoot: "1", onchainMtRoot: "1" };
  state.aspLeaves = { aspLeaves: ["91"], stateTreeLeaves: ["88"] };
  state.reviewStatuses = new Map([["91", "approved"]]);
  state.relayerDetails = {
    minWithdrawAmount: "100",
    feeReceiverAddress:
      "0x6666666666666666666666666666666666666666" as Address,
  };
  state.relayerQuote = {
    feeBPS: "250",
    feeCommitment: {
      expiration: 4_102_444_800_000,
      asset: ETH_POOL.asset,
      amount: "500",
      extraGas: false,
      signedRelayerCommitment: "0x1234",
      withdrawalData: "0x5678",
    },
  };
  state.remainderAdvisory = null;
  state.relayTxHash = ("0x" + "dd".repeat(32)) as Hex;
  getDataServiceMock.mockClear();
  initializeAccountServiceMock.mockClear();
  saveAccountMock.mockClear();
  saveSyncMetaMock.mockClear();
  acquireProcessLockMock.mockClear();
  guardCriticalSectionMock.mockClear();
  releaseCriticalSectionMock.mockClear();
  getPublicClientMock.mockClear();
  resolvePoolMock.mockClear();
  fetchMerkleRootsMock.mockClear();
  fetchMerkleLeavesMock.mockClear();
  fetchDepositReviewStatusesMock.mockClear();
  buildLoadedAspDepositReviewStateMock.mockClear();
  buildAllPoolAccountRefsMock.mockClear();
  buildPoolAccountRefsMock.mockClear();
  collectActiveLabelsMock.mockClear();
  getNextPoolAccountNumberMock.mockClear();
  poolAccountIdMock.mockClear();
  getRelayerDetailsMock.mockClear();
  requestQuoteMock.mockClear();
  submitRelayRequestMock.mockClear();
  proveWithdrawalMock.mockClear();
  withProofProgressMock.mockClear();
  generateMerkleProofMock.mockClear();
  calculateContextMock.mockClear();
  getRelayedWithdrawalRemainderAdvisoryMock.mockClear();
  validateRelayerQuoteForWithdrawalMock.mockClear();
  refreshExpiredRelayerQuoteForWithdrawalMock.mockClear();
  confirmPromptMock.mockClear();
  inputPromptMock.mockClear();
  selectPromptMock.mockClear();
  confirmPromptMock.mockImplementation(async () => true);
  inputPromptMock.mockImplementation(async () => "");
  selectPromptMock.mockImplementation(async () => "copied");
});

describe("workflow internal helpers", () => {
  test("getFlowFundingRequirements includes the deposit amount for native assets", async () => {
    const result = await getFlowFundingRequirements({
      chainConfig: CHAINS.sepolia,
      pool: ETH_POOL,
      amount: 500n,
    });

    expect(result.requiredNativeFunding).toBeGreaterThan(500n);
    expect(result.requiredTokenFunding).toBeNull();
  });

  test("getFlowFundingRequirements separates token and gas funding for ERC20 assets", async () => {
    state.resolvedPool = USDC_POOL;

    const result = await getFlowFundingRequirements({
      chainConfig: CHAINS.sepolia,
      pool: USDC_POOL,
      amount: 5_000_000n,
    });

    expect(result.requiredNativeFunding).toBeGreaterThan(0n);
    expect(result.requiredTokenFunding).toBe(5_000_000n);
  });

  test("getFlowFundingRequirements wraps gas price failures as retryable setup errors", async () => {
    state.gasPriceError = true;

    await expect(
      getFlowFundingRequirements({
        chainConfig: CHAINS.sepolia,
        pool: ETH_POOL,
        amount: 500n,
      }),
    ).rejects.toMatchObject({
      category: "RPC",
      message: "Could not estimate the workflow wallet gas reserve.",
    } satisfies Partial<CLIError>);
  });

  test("readFlowFundingState rejects snapshots without a workflow wallet address", async () => {
    await expect(
      readFlowFundingState({
        snapshot: sampleSnapshot({ walletAddress: null }),
        pool: ETH_POOL,
      }),
    ).rejects.toThrow("Workflow wallet address is missing.");
  });

  test("readFlowFundingState reports native and token funding satisfaction", async () => {
    state.resolvedPool = USDC_POOL;
    state.nativeBalance = 2_000n;
    state.tokenBalance = 4_000n;

    const funded = await readFlowFundingState({
      snapshot: sampleSnapshot({
        asset: "USDC",
        assetDecimals: 6,
        requiredNativeFunding: "1500",
        requiredTokenFunding: "3000",
      }),
      pool: USDC_POOL,
    });

    expect(funded.nativeBalance).toBe(2_000n);
    expect(funded.tokenBalance).toBe(4_000n);
    expect(funded.nativeSatisfied).toBe(true);
    expect(funded.tokenSatisfied).toBe(true);

    state.tokenBalance = 2_500n;
    const underfunded = await readFlowFundingState({
      snapshot: sampleSnapshot({
        asset: "USDC",
        assetDecimals: 6,
        requiredNativeFunding: "1500",
        requiredTokenFunding: "3000",
      }),
      pool: USDC_POOL,
    });

    expect(underfunded.tokenSatisfied).toBe(false);
  });

  test("getNextFlowPoolAccountRef derives the next local Pool Account id", async () => {
    const result = await getNextFlowPoolAccountRef({
      chainConfig: CHAINS.sepolia,
      pool: ETH_POOL,
      silent: true,
    });

    expect(result).toEqual({
      poolAccountNumber: 8,
      poolAccountId: "PA-8",
    });
    expect(loadMnemonicMock).toHaveBeenCalled();
    expect(getDataServiceMock).toHaveBeenCalledWith(
      CHAINS.sepolia,
      ETH_POOL.pool,
      undefined,
    );
    expect(initializeAccountServiceMock).toHaveBeenCalled();
    expect(getNextPoolAccountNumberMock).toHaveBeenCalled();
    expect(poolAccountIdMock).toHaveBeenCalledWith(8);
  });

  test("setupNewWalletWorkflow writes a backup immediately in machine mode", async () => {
    const backupPath = join(process.env.PRIVACY_POOLS_HOME!, "workflow-wallet.txt");

    const result = await setupNewWalletWorkflow({
      workflowId: "wf-machine-wallet",
      chainConfig: CHAINS.sepolia,
      pool: ETH_POOL,
      amount: 500n,
      recipient: sampleSnapshot().recipient as Address,
      exportNewWallet: backupPath,
      mode: JSON_MODE,
    });

    expect(result.snapshot.phase).toBe("awaiting_funding");
    expect(result.snapshot.walletMode).toBe("new_wallet");
    expect(result.snapshot.backupConfirmed).toBe(true);
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf8")).toContain("workflow wallet");
    expect(result.secretRecord.exportedBackupPath).toBe(backupPath);
  });

  test("setupNewWalletWorkflow supports manual backup confirmation for ERC20 flows", async () => {
    state.resolvedPool = USDC_POOL;
    inputPromptMock.mockImplementation(async () => join(process.env.PRIVACY_POOLS_HOME!, "unused.txt"));
    selectPromptMock.mockImplementation(async () => "copied");

    let result:
      | Awaited<ReturnType<typeof setupNewWalletWorkflow>>
      | null = null;
    const captured = await captureAsyncOutput(async () => {
      result = await setupNewWalletWorkflow({
        workflowId: "wf-human-wallet",
        chainConfig: CHAINS.sepolia,
        pool: USDC_POOL,
        amount: 5_000_000n,
        recipient: sampleSnapshot().recipient as Address,
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
      });
    });

    expect(result).not.toBeNull();
    expect(captured.stdout).toBe("");
    expect(captured.stderr).toContain("Private key:");
    expect(captured.stderr).toMatch(/Private key:\s*0x[a-f0-9]{64}/i);
    expect(result!.snapshot.phase).toBe("awaiting_funding");
    expect(result!.snapshot.requiredTokenFunding).toBe("5000000");
    expect(BigInt(result!.snapshot.requiredNativeFunding ?? "0")).toBeGreaterThan(0n);
    expect(result!.secretRecord.exportedBackupPath).toBeNull();
    expect(typeof result!.secretRecord.backupConfirmedAt).toBe("string");
    expect(state.warnings.join("\n")).toContain("Save this private key now.");
  });

  test("loadWorkflowPoolAccountContext rejects workflows that do not have a saved Pool Account yet", async () => {
    await expect(
      loadWorkflowPoolAccountContext(
        sampleSnapshot({ poolAccountNumber: null, poolAccountId: null }),
        undefined,
        true,
      ),
    ).rejects.toThrow(
      "This workflow does not have a saved Pool Account yet.",
    );
  });

  test("loadWorkflowPoolAccountContext fails closed while ASP roots are still converging", async () => {
    state.aspRoots = { mtRoot: "1", onchainMtRoot: "2" };

    await expect(
      loadWorkflowPoolAccountContext(sampleSnapshot(), undefined, true),
    ).rejects.toMatchObject({
      category: "ASP",
      message: "Withdrawal service data is still updating.",
    } satisfies Partial<CLIError>);
  });

  test("loadWorkflowPoolAccountContext returns the selected Pool Account and ASP context", async () => {
    const pendingPoolAccount: MockPoolAccount = {
      ...state.allPoolAccounts[0],
      status: "pending",
      aspStatus: "pending",
    };
    state.allPoolAccounts = [pendingPoolAccount];
    state.activePoolAccounts = [state.allPoolAccounts[0]];

    const context = await loadWorkflowPoolAccountContext(
      sampleSnapshot(),
      undefined,
      true,
    );

    expect(context.chainConfig.name).toBe("sepolia");
    expect(context.pool.pool).toBe(ETH_POOL.pool);
    expect(context.selectedPoolAccount.paId).toBe("PA-7");
    expect(context.aspLabels).toEqual([91n]);
    expect(context.allCommitmentHashes).toEqual([88n]);
    expect(context.rootsOnchainMtRoot).toBe(1n);
  });

  test("executeRelayedWithdrawalForFlow rejects workflows below the relayer minimum", async () => {
    state.relayerDetails = {
      ...state.relayerDetails,
      minWithdrawAmount: "600",
    };
    const context = await loadWorkflowPoolAccountContext(
      sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
      }),
      undefined,
      true,
    );

    await expect(
      executeRelayedWithdrawalForFlow({
        snapshot: sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
        }),
        context,
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow amount is below the relayer minimum");
  });

  test("executeRelayedWithdrawalForFlow submits the relay and persists the local commitment update", async () => {
    const addWithdrawalCommitmentMock = mock(() => undefined);
    state.accountServiceResult = {
      ...state.accountServiceResult,
      addWithdrawalCommitment: addWithdrawalCommitmentMock,
    };
    state.remainderAdvisory = "remainder warning";

    const context = await loadWorkflowPoolAccountContext(
      sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
      }),
      undefined,
      true,
    );

    const result = await executeRelayedWithdrawalForFlow({
      snapshot: sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
      }),
      context,
      mode: JSON_MODE,
      isVerbose: true,
    });

    expect(result.withdrawTxHash).toBe(state.relayTxHash);
    expect(result.withdrawBlockNumber).toBe("999");
    expect(addWithdrawalCommitmentMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
    expect(getRelayedWithdrawalRemainderAdvisoryMock).toHaveBeenCalledTimes(1);
  });

  test("continueApprovedWorkflowWithdrawal keeps watching while a saved relay transaction is still pending", async () => {
    state.withdrawReceiptMode = "missing";

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        aspStatus: "approved",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("withdrawing");
  });

  test("continueApprovedWorkflowWithdrawal stops when the saved Pool Account changed externally", async () => {
    state.allPoolAccounts = [
      {
        ...state.allPoolAccounts[0],
        status: "spent",
      },
    ];
    state.activePoolAccounts = state.allPoolAccounts;

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(false);
    expect(result.snapshot.phase).toBe("stopped_external");
  });

  test("inspectFundingAndDeposit rewinds clean submission failures back to awaiting funding", async () => {
    state.nativeBalance = 0n;

    const result = await inspectFundingAndDeposit({
      snapshot: sampleSnapshot({
        lastError: {
          step: "deposit",
          errorCode: "RPC_ERROR",
          errorMessage: "submit failed",
          retryable: true,
          at: "2026-03-24T12:01:00.000Z",
        },
        depositTxHash: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("awaiting_funding");
    expect(result.snapshot.lastError).toBeUndefined();
  });

  test("inspectFundingAndDeposit fails closed when a deposit may have been submitted without a checkpoint", async () => {
    await expect(
      inspectFundingAndDeposit({
        snapshot: sampleSnapshot({
          depositTxHash: null,
          lastError: {
            step: "deposit",
            errorCode: "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED",
            errorMessage:
              "Public deposit was submitted, but the workflow could not checkpoint it locally.",
            retryable: false,
            at: "2026-03-24T12:01:00.000Z",
          },
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow(
      "This workflow may have submitted a public deposit, but the transaction hash was not checkpointed locally.",
    );
  });

  test("inspectFundingAndDeposit reattaches a deposit from local account state while the receipt is still pending", async () => {
    state.depositReceiptMode = "missing";

    const result = await inspectFundingAndDeposit({
      snapshot: sampleSnapshot({
        phase: "depositing_publicly",
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("awaiting_asp");
    expect(result.snapshot.depositBlockNumber).toBe("123");
    expect(result.snapshot.poolAccountId).toBe("PA-7");
  });

  test("inspectFundingAndDeposit keeps waiting for mining when no local Pool Account exists yet", async () => {
    state.depositReceiptMode = "missing";

    const result = await inspectFundingAndDeposit({
      snapshot: sampleSnapshot({
        poolAccountNumber: null,
        poolAccountId: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("depositing_publicly");
    expect(result.snapshot.depositBlockNumber).toBeNull();
  });

  test("executeRelayedWithdrawalForFlow refreshes an expired quote after proof generation when the fee is unchanged", async () => {
    const originalDateNow = Date.now;
    Date.now = () => {
      const next = dateNowValues.shift();
      return next ?? 2;
    };
    const dateNowValues = [0, 2];

    requestQuoteMock
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeBPS: "250",
        feeCommitment: {
          ...state.relayerQuote.feeCommitment,
          expiration: 1,
        },
      }))
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeBPS: "250",
        feeCommitment: {
          ...state.relayerQuote.feeCommitment,
          expiration: 4_102_444_800_000,
        },
      }));

    try {
      const context = await loadWorkflowPoolAccountContext(
        sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
        }),
        undefined,
        true,
      );

      const result = await executeRelayedWithdrawalForFlow({
        snapshot: sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
        }),
        context,
        mode: JSON_MODE,
        isVerbose: false,
      });

      expect(result.withdrawTxHash).toBe(state.relayTxHash);
      expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("executeRelayedWithdrawalForFlow fails closed when the refreshed fee changes after proof generation", async () => {
    const originalDateNow = Date.now;
    Date.now = () => {
      const next = dateNowValues.shift();
      return next ?? 2;
    };
    const dateNowValues = [0, 2];

    requestQuoteMock
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeBPS: "250",
        feeCommitment: {
          ...state.relayerQuote.feeCommitment,
          expiration: 1,
        },
      }))
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeBPS: "300",
        feeCommitment: {
          ...state.relayerQuote.feeCommitment,
          expiration: 4_102_444_800_000,
        },
      }));

    try {
      const context = await loadWorkflowPoolAccountContext(
        sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
        }),
        undefined,
        true,
      );

      await expect(
        executeRelayedWithdrawalForFlow({
          snapshot: sampleSnapshot({
            phase: "approved_ready_to_withdraw",
            aspStatus: "approved",
          }),
          context,
          mode: JSON_MODE,
          isVerbose: false,
        }),
      ).rejects.toThrow("Relayer fee changed during proof generation");
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("reconcilePendingDepositReceipt returns null for snapshots without a pending deposit receipt to inspect", async () => {
    await expect(
      reconcilePendingDepositReceipt({
        snapshot: sampleSnapshot({ depositTxHash: null }),
        chainConfig: CHAINS.sepolia,
        pool: ETH_POOL,
      }),
    ).resolves.toBeNull();

    await expect(
      reconcilePendingDepositReceipt({
        snapshot: sampleSnapshot({ depositBlockNumber: "123" }),
        chainConfig: CHAINS.sepolia,
        pool: ETH_POOL,
      }),
    ).resolves.toBeNull();
  });

  test("reconcilePendingDepositReceipt returns null while the receipt is still unavailable", async () => {
    state.depositReceiptMode = "missing";

    const reconciled = await reconcilePendingDepositReceipt({
      snapshot: sampleSnapshot(),
      chainConfig: CHAINS.sepolia,
      pool: ETH_POOL,
    });

    expect(reconciled).toBeNull();
  });

  test("reconcilePendingDepositReceipt fails closed when the saved deposit reverts", async () => {
    state.depositReceiptMode = "reverted";

    await expect(
      reconcilePendingDepositReceipt({
        snapshot: sampleSnapshot(),
        chainConfig: CHAINS.sepolia,
        pool: ETH_POOL,
      }),
    ).rejects.toThrow("Previously submitted workflow deposit reverted");
  });

  test("reconcilePendingDepositReceipt fails closed when receipt metadata is missing", async () => {
    state.depositReceiptMode = "missing_metadata";

    await expect(
      reconcilePendingDepositReceipt({
        snapshot: sampleSnapshot(),
        chainConfig: CHAINS.sepolia,
        pool: ETH_POOL,
      }),
    ).rejects.toThrow(
      "Deposit confirmed, but the workflow could not recover the saved Pool Account metadata from the transaction receipt.",
    );
  });

  test("reconcilePendingDepositReceipt reattaches deposit metadata from the saved receipt", async () => {
    const reconciled = await reconcilePendingDepositReceipt({
      snapshot: sampleSnapshot({
        poolAccountId: null,
        poolAccountNumber: null,
        depositExplorerUrl: null,
      }),
      chainConfig: CHAINS.sepolia,
      pool: ETH_POOL,
    });

    expect(reconciled?.phase).toBe("awaiting_asp");
    expect(reconciled?.depositBlockNumber).toBe("123");
    expect(reconciled?.depositLabel).toBe("99");
    expect(reconciled?.committedValue).toBe("777");
    expect(reconciled?.poolAccountId).toBe("PA-?");
  });

  test("reconcilePendingWithdrawalReceipt returns null when there is no saved pending withdrawal", async () => {
    await expect(
      reconcilePendingWithdrawalReceipt({
        snapshot: sampleSnapshot({ withdrawTxHash: null }),
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      }),
    ).resolves.toBeNull();

    await expect(
      reconcilePendingWithdrawalReceipt({
        snapshot: sampleSnapshot({
          phase: "withdrawing",
          withdrawTxHash: "0x" + "bb".repeat(32),
          withdrawBlockNumber: "456",
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).resolves.toBeNull();
  });

  test("reconcilePendingWithdrawalReceipt fails closed on reverted receipts", async () => {
    state.withdrawReceiptMode = "reverted";

    await expect(
      reconcilePendingWithdrawalReceipt({
        snapshot: sampleSnapshot({
          phase: "withdrawing",
          withdrawTxHash: "0x" + "bb".repeat(32),
          withdrawBlockNumber: null,
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("Previously submitted workflow withdrawal reverted");
  });

  test("reconcilePendingWithdrawalReceipt completes even when local refresh needs a manual follow-up", async () => {
    state.refreshInitError = true;

    const reconciled = await reconcilePendingWithdrawalReceipt({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
        withdrawExplorerUrl: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(reconciled?.phase).toBe("completed");
    expect(reconciled?.withdrawBlockNumber).toBe("456");
    expect(state.warnings.join("\n")).toContain(
      "local account reconciliation needs a manual refresh",
    );
  });

  test("reconcilePendingRagequitReceipt returns null when there is no saved pending recovery", async () => {
    await expect(
      reconcilePendingRagequitReceipt({
        snapshot: sampleSnapshot({ ragequitTxHash: null }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).resolves.toBeNull();
  });

  test("reconcilePendingRagequitReceipt fails closed on reverted receipts", async () => {
    state.ragequitReceiptMode = "reverted";

    await expect(
      reconcilePendingRagequitReceipt({
        snapshot: sampleSnapshot({
          phase: "paused_declined",
          ragequitTxHash: "0x" + "cc".repeat(32),
          ragequitBlockNumber: null,
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("Previously submitted workflow ragequit reverted");
  });

  test("reconcilePendingRagequitReceipt completes even when local refresh needs a manual follow-up", async () => {
    state.refreshInitError = true;

    const reconciled = await reconcilePendingRagequitReceipt({
      snapshot: sampleSnapshot({
        phase: "paused_declined",
        ragequitTxHash: "0x" + "cc".repeat(32),
        ragequitBlockNumber: null,
        ragequitExplorerUrl: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(reconciled?.phase).toBe("completed_public_recovery");
    expect(reconciled?.ragequitBlockNumber).toBe("789");
    expect(state.warnings.join("\n")).toContain(
      "local account reconciliation needs a manual refresh",
    );
  });
});
