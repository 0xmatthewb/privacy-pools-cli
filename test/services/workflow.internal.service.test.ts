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
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import { CLIError } from "../../src/utils/errors.ts";
import type { FlowSnapshot } from "../../src/services/workflow.ts";
import {
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/services/workflow-storage-version.ts";
import { encodeRelayerWithdrawalData } from "../helpers/relayer-withdrawal-data.ts";
import { captureAsyncOutput } from "../helpers/output.ts";
import { restoreTestTty, setTestTty } from "../helpers/tty.ts";
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
const realContracts = await import("../../src/services/contracts.ts");
const realSdkPackage = await import("@0xbow/privacy-pools-core-sdk");
const realAsp = await import("../../src/services/asp.ts");
const realPoolAccounts = await import("../../src/utils/pool-accounts.ts");
const realRelayer = await import("../../src/services/relayer.ts");
const realProofs = await import("../../src/services/proofs.ts");
const realPreviewRuntime = await import("../../src/preview/runtime.ts");

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

const OP_SEPOLIA_WETH_POOL = {
  ...ETH_POOL,
  asset: "0x4200000000000000000000000000000000000006" as Address,
  symbol: "WETH",
};

const DEFAULT_WORKFLOW_RECIPIENT =
  "0x5555555555555555555555555555555555555555" as Address;
const DEFAULT_WORKFLOW_FEE_RECEIVER =
  "0x6666666666666666666666666666666666666666" as Address;

function buildWorkflowRelayerQuote(params: {
  feeBPS?: string;
  expiration?: number;
  recipient?: Address;
  feeRecipient?: Address;
  asset?: Address;
  amount?: string;
  extraGas?: boolean;
  signedRelayerCommitment?: Hex;
  relayerUrl?: string;
} = {}) {
  const feeBPS = params.feeBPS ?? "250";
  return {
    feeBPS,
    relayerUrl: params.relayerUrl ?? "https://fastrelay.xyz",
    feeCommitment: {
      expiration: params.expiration ?? 4_102_444_800_000,
      asset: params.asset ?? ETH_POOL.asset,
      amount: params.amount ?? "500",
      extraGas: params.extraGas ?? false,
      signedRelayerCommitment: params.signedRelayerCommitment ?? "0x1234",
      withdrawalData: encodeRelayerWithdrawalData({
        recipient: params.recipient ?? DEFAULT_WORKFLOW_RECIPIENT,
        feeRecipient: params.feeRecipient ?? DEFAULT_WORKFLOW_FEE_RECEIVER,
        relayFeeBPS: BigInt(feeBPS),
      }),
    },
  };
}

type MockPoolAccount = {
  paNumber: number;
  paId: string;
  status:
    | "approved"
    | "pending"
    | "declined"
    | "poa_required"
    | "unknown"
    | "spent"
    | "exited";
  aspStatus:
    | "approved"
    | "pending"
    | "declined"
    | "poa_required"
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

function buildHistoricalPoolAccount(paNumber: number): MockPoolAccount {
  const label = BigInt(90 + paNumber);
  const hash = BigInt(80 + paNumber);
  const txHex = paNumber.toString(16).padStart(64, "0");

  return {
    paNumber,
    paId: `PA-${paNumber}`,
    status: "spent",
    aspStatus: "unknown",
    label,
    value: 100n + BigInt(paNumber),
    blockNumber: 100n + BigInt(paNumber),
    txHash: (`0x${txHex}`) as Hex,
    commitment: {
      hash,
      label,
      value: 100n + BigInt(paNumber),
      nullifier: 200n + BigInt(paNumber),
      secret: 300n + BigInt(paNumber),
      blockNumber: 100n + BigInt(paNumber),
      txHash: (`0x${txHex}`) as Hex,
    },
  };
}

interface MockState {
  gasPrice: bigint;
  gasPriceError: boolean;
  nativeBalance: bigint;
  tokenBalance: bigint;
  approvalReceiptMode: "success" | "timeout" | "reverted";
  depositSubmissionReceiptMode:
    | "success"
    | "timeout"
    | "reverted"
    | "missing_metadata";
  depositReceiptMode:
    | "success"
    | "missing"
    | "rpc_error"
    | "reverted"
    | "missing_metadata";
  withdrawReceiptMode: "success" | "missing" | "rpc_error" | "reverted";
  ragequitReceiptMode: "success" | "missing" | "rpc_error" | "reverted";
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
  aspRoots: { mtRoot: string; onchainMtRoot: string };
  aspLeaves: { aspLeaves: string[]; stateTreeLeaves: string[] };
  reviewStatuses: Map<string, MockPoolAccount["aspStatus"]>;
  relayerDetails: {
    minWithdrawAmount: string;
    feeReceiverAddress: Address;
    relayerUrl?: string;
  };
  relayerQuote: {
    feeBPS: string;
    relayerUrl?: string;
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
  approvalTxHash: Hex;
  depositSubmitTxHash: Hex;
  relayTxHash: Hex;
}

const state: MockState = {} as MockState;
const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

function getCanonicalPoolAccounts(): MockPoolAccount[] {
  const visiblePoolAccounts = [...state.allPoolAccounts].sort(
    (left, right) => left.paNumber - right.paNumber,
  );
  const firstVisible = visiblePoolAccounts[0]?.paNumber ?? 1;
  const historicalPrefix = Array.from(
    { length: Math.max(0, firstVisible - 1) },
    (_value, index) => buildHistoricalPoolAccount(index + 1),
  );

  return [...historicalPrefix, ...visiblePoolAccounts];
}

function getSpendableMockPoolAccounts(): MockPoolAccount[] {
  return state.allPoolAccounts.filter((poolAccount) => (
    poolAccount.status !== "spent" &&
    poolAccount.status !== "exited" &&
    poolAccount.value > 0n
  ));
}

function buildMockAccountPoolAccounts() {
  return new Map([
    [1n, getCanonicalPoolAccounts().map((poolAccount) => ({
      deposit: poolAccount.commitment,
      children: [],
      ragequit: poolAccount.status === "exited"
        ? {
            blockNumber: poolAccount.blockNumber ?? poolAccount.commitment.blockNumber,
            transactionHash: poolAccount.txHash ?? poolAccount.commitment.txHash,
          }
        : null,
      isMigrated: false,
    }))],
  ]);
}

function buildAccountServiceResult(
  overrides?: Partial<MockState["accountServiceResult"]>,
): MockState["accountServiceResult"] {
  return {
    get account() {
      return { poolAccounts: buildMockAccountPoolAccounts() };
    },
    getSpendableCommitments: () => new Map([
      [1n, getSpendableMockPoolAccounts().map((poolAccount) => poolAccount.commitment)],
    ]),
    createDepositSecrets: () => createDepositSecretsMock(),
    createWithdrawalSecrets: () => ({ nullifier: 901n, secret: 902n }),
    addPoolAccount: (...args: unknown[]) => addPoolAccountMock(...args),
    addWithdrawalCommitment: () => undefined,
    ...overrides,
  };
}

const getDataServiceMock = mock(async () => ({ service: "data" }));
const initializeAccountServiceMock = mock(async () => state.accountServiceResult);
const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
const acquireProcessLockMock = mock(() => () => undefined);
const guardCriticalSectionMock = mock(() => undefined);
const releaseCriticalSectionMock = mock(() => undefined);
const createDepositSecretsMock = mock(() => ({
  precommitment: 44n,
  nullifier: 45n,
  secret: 46n,
}));
const addPoolAccountMock = mock(() => undefined);
const approveERC20Mock = mock(async () => ({
  hash: state.approvalTxHash,
}));
const depositETHMock = mock(async () => ({
  hash: state.depositSubmitTxHash,
}));
const depositERC20Mock = mock(async () => ({
  hash: state.depositSubmitTxHash,
}));
const getPublicClientMock = mock(() => ({
  getGasPrice: async () => state.gasPrice,
  getBalance: async () => state.nativeBalance,
  readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === "balanceOf") return state.tokenBalance;
    if (functionName === "currentRoot") return state.poolCurrentRoot;
    if (functionName === "latestRoot") return state.latestRoot;
    return 0n;
  },
  waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
    if (hash === state.approvalTxHash) {
      if (state.approvalReceiptMode === "timeout") {
        throw new Error("timed out");
      }
      return {
        status:
          state.approvalReceiptMode === "reverted"
            ? ("reverted" as const)
            : ("success" as const),
        blockNumber: 222n,
      };
    }

    if (hash === state.depositSubmitTxHash) {
      if (state.depositSubmissionReceiptMode === "timeout") {
        throw new Error("timed out");
      }
      if (state.depositSubmissionReceiptMode === "reverted") {
        return {
          status: "reverted" as const,
          blockNumber: 333n,
          logs: [],
        };
      }
      if (state.depositSubmissionReceiptMode === "missing_metadata") {
        return {
          status: "success" as const,
          blockNumber: 333n,
          logs: [],
        };
      }

      return {
        status: "success" as const,
        blockNumber: 333n,
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
              [188n, 199n, 777n, 144n],
            ),
          },
        ],
      };
    }

    if (hash === state.relayTxHash) {
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
    }

    throw new Error(`Unexpected tx wait: ${hash}`);
  },
  getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
    if (hash === ("0x" + "aa".repeat(32)) as Hex) {
      if (state.depositReceiptMode === "missing") {
        throw new TransactionReceiptNotFoundError({ hash });
      }
      if (state.depositReceiptMode === "rpc_error") {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8545");
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
        throw new TransactionReceiptNotFoundError({ hash });
      }
      if (state.withdrawReceiptMode === "rpc_error") {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8545");
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
        throw new TransactionReceiptNotFoundError({ hash });
      }
      if (state.ragequitReceiptMode === "rpc_error") {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8545");
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
const buildPoolAccountRefsMock = mock(() => getSpendableMockPoolAccounts());
const collectActiveLabelsMock = mock(() =>
  getSpendableMockPoolAccounts().map((poolAccount) => poolAccount.label.toString()),
);
const getNextPoolAccountNumberMock = mock(() => 8);
const poolAccountIdMock = mock((poolAccountNumber: number) => `PA-${poolAccountNumber}`);
const getRelayerDetailsMock = mock(async () => state.relayerDetails);
const requestQuoteMock = mock(async (_chain: unknown, args?: {
  amount: bigint;
  asset: Address;
  extraGas: boolean;
  recipient?: Address;
  relayerUrl?: string;
}) => ({
  baseFeeBPS: "200",
  gasPrice: "1",
  detail: { relayTxCost: { gas: "0", eth: "0" } },
  ...buildWorkflowRelayerQuote({
    ...args,
    amount: args?.amount?.toString(),
    relayerUrl: args?.relayerUrl,
  }),
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
  async <T>(
    _spin: unknown,
    _label: string,
    build: (_progress: unknown) => Promise<T>,
  ) => await build({}),
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
const maybeRenderPreviewScenarioMock = mock(async () => false);
const maybeRenderPreviewProgressStepMock = mock(async () => false);

let getFlowFundingRequirements: typeof import("../../src/services/workflow.ts").getFlowFundingRequirements;
let readFlowFundingState: typeof import("../../src/services/workflow.ts").readFlowFundingState;
let getNextFlowPoolAccountRef: typeof import("../../src/services/workflow.ts").getNextFlowPoolAccountRef;
let inspectFundingAndDeposit: typeof import("../../src/services/workflow.ts").inspectFundingAndDeposit;
let setupNewWalletWorkflow: typeof import("../../src/services/workflow.ts").setupNewWalletWorkflow;
let startWorkflow: typeof import("../../src/services/workflow.ts").startWorkflow;
let watchWorkflow: typeof import("../../src/services/workflow.ts").watchWorkflow;
let ragequitWorkflow: typeof import("../../src/services/workflow.ts").ragequitWorkflow;
let reconcilePendingDepositReceipt: typeof import("../../src/services/workflow.ts").reconcilePendingDepositReceipt;
let reconcilePendingWithdrawalReceipt: typeof import("../../src/services/workflow.ts").reconcilePendingWithdrawalReceipt;
let reconcilePendingRagequitReceipt: typeof import("../../src/services/workflow.ts").reconcilePendingRagequitReceipt;
let loadWorkflowPoolAccountContext: typeof import("../../src/services/workflow.ts").loadWorkflowPoolAccountContext;
let executeRelayedWithdrawalForFlow: typeof import("../../src/services/workflow.ts").executeRelayedWithdrawalForFlow;
let continueApprovedWorkflowWithdrawal: typeof import("../../src/services/workflow.ts").continueApprovedWorkflowWithdrawal;
let getWorkflowStatus: typeof import("../../src/services/workflow.ts").getWorkflowStatus;
let overrideWorkflowTimingForTests: typeof import("../../src/services/workflow.ts").overrideWorkflowTimingForTests;
let saveWorkflowSnapshot: typeof import("../../src/services/workflow.ts").saveWorkflowSnapshot;
let saveWorkflowSecretRecord: typeof import("../../src/services/workflow.ts").saveWorkflowSecretRecord;

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
    recipient: DEFAULT_WORKFLOW_RECIPIENT,
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

function seedWorkflowWalletSecret(workflowId = "wf-internal"): void {
  const privateKey =
    "0x1111111111111111111111111111111111111111111111111111111111111111";
  saveWorkflowSecretRecord({
    schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
    workflowId,
    chain: "sepolia",
    walletAddress: privateKeyToAccount(privateKey).address,
    privateKey,
  });
}

const JSON_MODE = {
  isAgent: true,
  isJson: true,
  isCsv: false,
  isQuiet: true,
  format: "json" as const,
  skipPrompts: true,
};

const HUMAN_MODE = {
  isAgent: false,
  isJson: false,
  isCsv: false,
  isQuiet: false,
  format: "table" as const,
  skipPrompts: true,
};
const INTERACTIVE_HUMAN_MODE = {
  ...HUMAN_MODE,
  skipPrompts: false,
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
  mock.module("../../src/services/contracts.ts", () => ({
    ...realContracts,
    approveERC20: approveERC20Mock,
    depositETH: depositETHMock,
    depositERC20: depositERC20Mock,
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
      fail() {},
    }),
    warn: (message: string) => {
      state.warnings.push(message);
    },
    verbose: () => undefined,
  }));
  mock.module("../../src/preview/runtime.ts", () => ({
    ...realPreviewRuntime,
    maybeRenderPreviewScenario: maybeRenderPreviewScenarioMock,
    maybeRenderPreviewProgressStep: maybeRenderPreviewProgressStepMock,
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
    startWorkflow,
    watchWorkflow,
    ragequitWorkflow,
    loadWorkflowPoolAccountContext,
    executeRelayedWithdrawalForFlow,
    continueApprovedWorkflowWithdrawal,
    getWorkflowStatus,
    overrideWorkflowTimingForTests,
    saveWorkflowSnapshot,
    saveWorkflowSecretRecord,
    reconcilePendingDepositReceipt,
    reconcilePendingWithdrawalReceipt,
    reconcilePendingRagequitReceipt,
  } = await import("../../src/services/workflow.ts"));

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
  overrideWorkflowTimingForTests();
  cleanupTrackedTempDirs();
  restoreTestTty();
});

beforeEach(() => {
  setTestTty();
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
  state.approvalReceiptMode = "success";
  state.depositSubmissionReceiptMode = "success";
  state.depositReceiptMode = "success";
  state.withdrawReceiptMode = "success";
  state.ragequitReceiptMode = "success";
  state.relayReceiptMode = "success";
  state.refreshInitError = false;
  state.warnings = [];
  state.resolvedPool = ETH_POOL;
  state.latestRoot = 1n;
  state.poolCurrentRoot = 1n;
  state.accountServiceResult = buildAccountServiceResult();
  state.allPoolAccounts = [activePoolAccount];
  state.aspRoots = { mtRoot: "1", onchainMtRoot: "1" };
  state.aspLeaves = { aspLeaves: ["91"], stateTreeLeaves: ["88"] };
  state.reviewStatuses = new Map([["91", "approved"]]);
  state.relayerDetails = {
    minWithdrawAmount: "100",
    feeReceiverAddress: DEFAULT_WORKFLOW_FEE_RECEIVER,
    relayerUrl: "https://fastrelay.xyz",
  };
  state.relayerQuote = buildWorkflowRelayerQuote({
    relayerUrl: state.relayerDetails.relayerUrl,
  });
  state.remainderAdvisory = null;
  state.approvalTxHash = ("0x" + "ee".repeat(32)) as Hex;
  state.depositSubmitTxHash = ("0x" + "ff".repeat(32)) as Hex;
  state.relayTxHash = ("0x" + "dd".repeat(32)) as Hex;
  getDataServiceMock.mockClear();
  initializeAccountServiceMock.mockClear();
  saveAccountMock.mockClear();
  saveSyncMetaMock.mockClear();
  acquireProcessLockMock.mockClear();
  guardCriticalSectionMock.mockClear();
  releaseCriticalSectionMock.mockClear();
  createDepositSecretsMock.mockClear();
  addPoolAccountMock.mockClear();
  approveERC20Mock.mockClear();
  depositETHMock.mockClear();
  depositERC20Mock.mockClear();
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
  maybeRenderPreviewScenarioMock.mockClear();
  maybeRenderPreviewProgressStepMock.mockClear();
  confirmPromptMock.mockImplementation(async () => true);
  inputPromptMock.mockImplementation(async () => "");
  selectPromptMock.mockImplementation(async () => "copied");
  maybeRenderPreviewScenarioMock.mockImplementation(async () => false);
  maybeRenderPreviewProgressStepMock.mockImplementation(async () => false);
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

  test("getFlowFundingRequirements treats op-sepolia WETH as native funding", async () => {
    const result = await getFlowFundingRequirements({
      chainConfig: CHAINS["op-sepolia"],
      pool: OP_SEPOLIA_WETH_POOL,
      amount: 500n,
    });

    expect(result.requiredNativeFunding).toBeGreaterThan(500n);
    expect(result.requiredTokenFunding).toBeNull();
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
    expect(captured.stderr).toContain("Workflow wallet backup");
    expect(captured.stderr).toContain("Recovery key:");
    expect(captured.stderr).toMatch(/Recovery key:\s*0x[a-f0-9]{64}/i);
    expect(captured.stderr).toContain("Confirm workflow wallet backup");
    expect(result!.snapshot.phase).toBe("awaiting_funding");
    expect(result!.snapshot.requiredTokenFunding).toBe("5000000");
    expect(BigInt(result!.snapshot.requiredNativeFunding ?? "0")).toBeGreaterThan(0n);
    expect(result!.secretRecord.exportedBackupPath).toBeNull();
    expect(typeof result!.secretRecord.backupConfirmedAt).toBe("string");
    expect(state.warnings.join("\n")).toContain(
      "A dedicated workflow wallet was created for this flow.",
    );
  });

  test("setupNewWalletWorkflow accepts an explicit backup path in human mode", async () => {
    const backupPath = join(process.env.PRIVACY_POOLS_HOME!, "workflow-wallet.txt");

    const result = await setupNewWalletWorkflow({
      workflowId: "wf-human-backed-up",
      chainConfig: CHAINS.sepolia,
      pool: ETH_POOL,
      amount: 500n,
      recipient: sampleSnapshot().recipient as Address,
      exportNewWallet: backupPath,
      mode: INTERACTIVE_HUMAN_MODE,
    });

    expect(result.secretRecord.exportedBackupPath).toBe(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(result.snapshot.phase).toBe("awaiting_funding");
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
    state.accountServiceResult = buildAccountServiceResult({
      addWithdrawalCommitment: addWithdrawalCommitmentMock,
    });
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
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relayerUrl: state.relayerDetails.relayerUrl,
      }),
    );
    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
    expect(submitRelayRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relayerUrl: state.relayerQuote.relayerUrl,
      }),
    );
    expect(getRelayedWithdrawalRemainderAdvisoryMock).toHaveBeenCalledTimes(1);
  });

  test("executeRelayedWithdrawalForFlow logs remainder guidance and retries without extra gas when the relayer does not support it", async () => {
    state.resolvedPool = USDC_POOL;
    state.relayerQuote = buildWorkflowRelayerQuote({
      asset: USDC_POOL.asset,
      extraGas: false,
    });
    state.remainderAdvisory = "remainder warning";
    requestQuoteMock.mockImplementationOnce(async (_chainConfig, params) => {
      expect(params.extraGas).toBe(true);
      throw new CLIError(
        "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
        "RELAYER",
        "UNSUPPORTED_FEATURE",
      );
    });

    const snapshot = sampleSnapshot({
      phase: "approved_ready_to_withdraw",
      aspStatus: "approved",
      asset: "USDC",
      assetDecimals: 6,
    });
    const context = await loadWorkflowPoolAccountContext(
      snapshot,
      undefined,
      true,
    );

    const result = await executeRelayedWithdrawalForFlow({
      snapshot,
      context,
      mode: JSON_MODE,
      isVerbose: true,
    });

    expect(result.withdrawTxHash).toBe(state.relayTxHash);
    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(state.warnings).toContain(
      "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
    );
  });

  test("executeRelayedWithdrawalForFlow refreshes an already expired quote before proof generation and can drop extra gas", async () => {
    const originalDateNow = Date.now;
    Date.now = () => 2;
    state.resolvedPool = USDC_POOL;
    state.relayerQuote = buildWorkflowRelayerQuote({
      asset: USDC_POOL.asset,
      extraGas: true,
      expiration: 1,
    });
    requestQuoteMock
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params.extraGas).toBe(true);
        return {
          baseFeeBPS: "200",
          gasPrice: "1",
          detail: { relayTxCost: { gas: "0", eth: "0" } },
          ...state.relayerQuote,
        };
      })
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params.extraGas).toBe(true);
        throw new CLIError(
          "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
          "RELAYER",
          "UNSUPPORTED_FEATURE",
        );
      })
      .mockImplementationOnce(async (_chainConfig, params) => {
        expect(params.extraGas).toBe(false);
        return {
          baseFeeBPS: "200",
          gasPrice: "1",
          detail: { relayTxCost: { gas: "0", eth: "0" } },
          ...buildWorkflowRelayerQuote({
            asset: USDC_POOL.asset,
            extraGas: false,
            expiration: 4_102_444_800_000,
          }),
        };
      });

    try {
      const snapshot = sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        asset: "USDC",
        assetDecimals: 6,
      });
      const context = await loadWorkflowPoolAccountContext(
        snapshot,
        undefined,
        true,
      );

      const result = await executeRelayedWithdrawalForFlow({
        snapshot,
        context,
        mode: JSON_MODE,
        isVerbose: false,
      });

      expect(result.withdrawTxHash).toBe(state.relayTxHash);
      expect(requestQuoteMock).toHaveBeenCalledTimes(3);
      expect(state.warnings).toContain(
        "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
      );
    } finally {
      Date.now = originalDateNow;
    }
  });

  test("continueApprovedWorkflowWithdrawal keeps watching while a saved relay transaction is still pending", async () => {
    state.withdrawReceiptMode = "missing";

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        aspStatus: "approved",
        committedValue: "500",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("withdrawing");
  });

  test("continueApprovedWorkflowWithdrawal fails closed when a relayed withdraw tx hash was never checkpointed", async () => {
    await expect(
      continueApprovedWorkflowWithdrawal({
        snapshot: sampleSnapshot({
          phase: "withdrawing",
          aspStatus: "approved",
          committedValue: "500",
          pendingSubmission: "withdraw",
          withdrawTxHash: null,
          withdrawBlockNumber: null,
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("transaction hash was not checkpointed locally");
  });

  test("continueApprovedWorkflowWithdrawal stops when a saved relay hash sees external Pool Account mutation", async () => {
    state.withdrawReceiptMode = "missing";
    state.allPoolAccounts = [
      {
        ...state.allPoolAccounts[0],
        status: "spent",
      },
    ];

    const secretFilePath = join(
      process.env.PRIVACY_POOLS_HOME!,
      "workflow-secrets",
      "wf-internal.json",
    );
    saveWorkflowSecretRecord({
      schemaVersion: "1",
      workflowId: "wf-internal",
      chain: "sepolia",
      walletAddress: sampleSnapshot().walletAddress as Address,
      privateKey: ("0x" + "11".repeat(32)) as Hex,
      createdAt: "2026-03-24T12:00:00.000Z",
    });

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        aspStatus: "approved",
        committedValue: "500",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(false);
    expect(result.snapshot.phase).toBe("stopped_external");
    expect(existsSync(secretFilePath)).toBe(false);
  });

  test("continueApprovedWorkflowWithdrawal keeps watching when relay-hash reconciliation cannot reload account context", async () => {
    state.refreshInitError = true;
    state.withdrawReceiptMode = "missing";

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        aspStatus: "approved",
        committedValue: "500",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("withdrawing");
  });

  test("continueApprovedWorkflowWithdrawal finalizes when a saved relay receipt is found", async () => {
    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        aspStatus: "approved",
        committedValue: "500",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(false);
    expect(result.snapshot.phase).toBe("completed");
    expect(result.snapshot.withdrawTxHash).toBe("0x" + "bb".repeat(32));
    expect(result.snapshot.withdrawBlockNumber).toBe("456");
  });

  test("continueApprovedWorkflowWithdrawal completes the relayed withdrawal and cleans up saved workflow secrets", async () => {
    const approvedPoolAccount: MockPoolAccount = {
      ...state.allPoolAccounts[0],
      status: "approved",
      aspStatus: "approved",
      value: 500n,
      label: 91n,
      txHash: ("0x" + "aa".repeat(32)) as Hex,
      commitment: {
        ...state.allPoolAccounts[0].commitment,
        value: 500n,
        label: 91n,
        txHash: ("0x" + "aa".repeat(32)) as Hex,
      },
    };
    state.allPoolAccounts = [approvedPoolAccount];

    const secretFilePath = join(
      process.env.PRIVACY_POOLS_HOME!,
      "workflow-secrets",
      "wf-internal.json",
    );
    saveWorkflowSecretRecord({
      schemaVersion: "1",
      workflowId: "wf-internal",
      chain: "sepolia",
      walletAddress: sampleSnapshot().walletAddress as Address,
      privateKey: ("0x" + "11".repeat(32)) as Hex,
      createdAt: "2026-03-24T12:00:00.000Z",
    });
    expect(existsSync(secretFilePath)).toBe(true);

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        committedValue: "500",
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(false);
    expect(result.snapshot.phase).toBe("completed");
    expect(result.snapshot.aspStatus).toBe("approved");
    expect(result.snapshot.withdrawTxHash).toBe(state.relayTxHash);
    expect(result.snapshot.withdrawBlockNumber).toBe("999");
    expect(result.snapshot.withdrawExplorerUrl).toContain(state.relayTxHash);
    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
    expect(existsSync(secretFilePath)).toBe(false);
  });

  test("continueApprovedWorkflowWithdrawal stops when the saved Pool Account changed externally", async () => {
    state.allPoolAccounts = [
      {
        ...state.allPoolAccounts[0],
        status: "spent",
      },
    ];

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        committedValue: "500",
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(false);
    expect(result.snapshot.phase).toBe("stopped_external");
  });

  test("continueApprovedWorkflowWithdrawal keeps the workflow ready-to-withdraw when the relayer minimum blocks it before submission", async () => {
    state.relayerDetails = {
      ...state.relayerDetails,
      minWithdrawAmount: "600",
    };

    await expect(
      continueApprovedWorkflowWithdrawal({
        snapshot: sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
          committedValue: "500",
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("Workflow amount is below the relayer minimum");
  });

  test("continueApprovedWorkflowWithdrawal completes the relayed withdrawal and finalizes the workflow", async () => {
    const approvedPoolAccount: MockPoolAccount = {
      ...state.allPoolAccounts[0],
      status: "approved",
      aspStatus: "approved",
      value: 500n,
      label: 91n,
      txHash: ("0x" + "aa".repeat(32)) as Hex,
      commitment: {
        ...state.allPoolAccounts[0].commitment,
        value: 500n,
        label: 91n,
        txHash: ("0x" + "aa".repeat(32)) as Hex,
      },
    };
    state.allPoolAccounts = [approvedPoolAccount];

    const result = await continueApprovedWorkflowWithdrawal({
      snapshot: sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        committedValue: "500",
      }),
      mode: JSON_MODE,
      isVerbose: true,
    });

    expect(result.continueWatching).toBe(false);
    expect(result.snapshot.phase).toBe("completed");
    expect(result.snapshot.aspStatus).toBe("approved");
    expect(result.snapshot.withdrawTxHash).toBe(state.relayTxHash);
    expect(result.snapshot.withdrawBlockNumber).toBe("999");
    expect(result.snapshot.withdrawExplorerUrl).toContain(
      state.relayTxHash.slice(2),
    );
    expect(requestQuoteMock).toHaveBeenCalledTimes(1);
    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
  });

  test("startWorkflow checkpoints and finalizes a configured workflow snapshot when watch is disabled", async () => {
    state.nativeBalance = 1_000_000_000_000_000_000_000n;

    const snapshot = await startWorkflow({
      amountInput: "0.1",
      assetInput: "ETH",
      recipient: DEFAULT_WORKFLOW_RECIPIENT,
      privacyDelayProfile: "balanced",
      globalOpts: { chain: "sepolia" },
      mode: JSON_MODE,
      isVerbose: false,
      watch: false,
    });

    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.phase).toBe("awaiting_asp");
    expect(snapshot.privacyDelayProfile).toBe("balanced");
    expect(snapshot.privacyDelayConfigured).toBe(true);
    expect(snapshot.depositTxHash).toBe(state.depositSubmitTxHash);
    expect(snapshot.depositBlockNumber).toBe("333");
    expect(snapshot.poolAccountId).toBe("PA-8");

    const saved = getWorkflowStatus({ workflowId: snapshot.workflowId });
    expect(saved.depositTxHash).toBe(state.depositSubmitTxHash);
    expect(saved.depositBlockNumber).toBe("333");
    expect(saved.walletAddress.toLowerCase()).toBe(
      "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a",
    );
  });

  test("startWorkflow stops when preview rendering takes over deposit submission", async () => {
    maybeRenderPreviewProgressStepMock.mockImplementationOnce(
      async (stepId: string) => stepId === "flow.start.submit-deposit",
    );

    await expect(
      startWorkflow({
        amountInput: "0.1",
        assetInput: "ETH",
        recipient: DEFAULT_WORKFLOW_RECIPIENT,
        globalOpts: { chain: "sepolia" },
        mode: INTERACTIVE_HUMAN_MODE,
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toBeInstanceOf(realPreviewRuntime.PreviewScenarioRenderedError);
  });

  test("startWorkflow stops when preview rendering takes over new-wallet backup choice", async () => {
    maybeRenderPreviewScenarioMock.mockImplementationOnce(
      async (scenarioId: string) =>
        scenarioId === "flow start new-wallet backup choice",
    );

    await expect(
      startWorkflow({
        amountInput: "0.1",
        assetInput: "ETH",
        recipient: DEFAULT_WORKFLOW_RECIPIENT,
        newWallet: true,
        exportNewWallet: join(process.env.PRIVACY_POOLS_HOME!, "wf-choice.txt"),
        globalOpts: { chain: "sepolia" },
        mode: HUMAN_MODE,
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toBeInstanceOf(realPreviewRuntime.PreviewScenarioRenderedError);
  });

  test("startWorkflow stops when preview rendering takes over new-wallet backup path review", async () => {
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (scenarioId: string) =>
        scenarioId === "flow start new-wallet backup path",
    );

    await expect(
      startWorkflow({
        amountInput: "0.1",
        assetInput: "ETH",
        recipient: DEFAULT_WORKFLOW_RECIPIENT,
        newWallet: true,
        exportNewWallet: join(process.env.PRIVACY_POOLS_HOME!, "wf-path.txt"),
        globalOpts: { chain: "sepolia" },
        mode: HUMAN_MODE,
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toBeInstanceOf(realPreviewRuntime.PreviewScenarioRenderedError);
  });

  test("startWorkflow stops when preview rendering takes over new-wallet backup confirmation", async () => {
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (scenarioId: string) =>
        scenarioId === "flow start new-wallet backup confirm",
    );

    await expect(
      startWorkflow({
        amountInput: "0.1",
        assetInput: "ETH",
        recipient: DEFAULT_WORKFLOW_RECIPIENT,
        newWallet: true,
        exportNewWallet: join(process.env.PRIVACY_POOLS_HOME!, "wf-confirm.txt"),
        globalOpts: { chain: "sepolia" },
        mode: HUMAN_MODE,
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toBeInstanceOf(realPreviewRuntime.PreviewScenarioRenderedError);
  });

  test("startWorkflow stops when preview rendering takes over the final human confirmation", async () => {
    state.nativeBalance = 1_000_000_000_000_000_000_000n;
    maybeRenderPreviewScenarioMock.mockImplementation(
      async (scenarioId: string, options?: { timing?: string }) =>
        scenarioId === "flow start confirm" && options?.timing === "after-prompts",
    );

    await expect(
      startWorkflow({
        amountInput: "0.1",
        assetInput: "ETH",
        recipient: DEFAULT_WORKFLOW_RECIPIENT,
        globalOpts: { chain: "sepolia" },
        mode: INTERACTIVE_HUMAN_MODE,
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toBeInstanceOf(realPreviewRuntime.PreviewScenarioRenderedError);
  });

  test("watchWorkflow applies privacy-delay overrides before returning a later terminal snapshot", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-watch-delay",
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        privacyDelayProfile: "off",
        privacyDelayConfigured: false,
        privacyDelayUntil: null,
      }),
    );
    overrideWorkflowTimingForTests({
      nowMs: () => Date.parse("2026-03-24T12:00:00.000Z"),
      samplePrivacyDelayMs: () => 30 * 60_000,
      sleep: async () => {
        const current = getWorkflowStatus({ workflowId: "wf-watch-delay" });
        saveWorkflowSnapshot({
          ...current,
          phase: "completed",
        });
      },
    });

    const watched = await watchWorkflow({
      workflowId: "wf-watch-delay",
      privacyDelayProfile: "balanced",
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(watched.phase).toBe("stopped_external");
    expect(watched.privacyDelayProfile).toBe("balanced");
    expect(watched.privacyDelayConfigured).toBe(true);
    expect(watched.privacyDelayUntil).toBe("2026-03-24T12:30:00.000Z");
  });

  test("watchWorkflow persists retryable errors and retries until the saved workflow becomes terminal", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-watch-retry",
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        committedValue: "500",
      }),
    );
    requestQuoteMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "temporary relayer issue",
        "RELAYER",
        "retry later",
        "RELAYER_TEMPORARY",
        true,
      );
    });
    overrideWorkflowTimingForTests({
      sleep: async () => {
        const current = getWorkflowStatus({ workflowId: "wf-watch-retry" });
        saveWorkflowSnapshot({
          ...current,
          phase: "stopped_external",
        });
      },
    });

    const watched = await watchWorkflow({
      workflowId: "wf-watch-retry",
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(watched.phase).toBe("stopped_external");
    expect(getWorkflowStatus({ workflowId: "wf-watch-retry" }).lastError).toMatchObject({
      step: "withdraw",
      errorCode: "RELAYER_TEMPORARY",
      retryable: true,
    });
  });

  test("watchWorkflow persists non-retryable errors before failing closed", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-watch-fatal",
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
        committedValue: "500",
      }),
    );
    requestQuoteMock.mockImplementationOnce(async () => {
      throw new CLIError(
        "fatal relayer rejection",
        "RELAYER",
        "fix the quote inputs",
        "RELAYER_FATAL",
        false,
      );
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-watch-fatal",
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toMatchObject({
      code: "RELAYER_FATAL",
    });
    expect(getWorkflowStatus({ workflowId: "wf-watch-fatal" }).lastError).toMatchObject({
      step: "withdraw",
      errorCode: "RELAYER_FATAL",
      retryable: false,
    });
  });

  test("watchWorkflow logs elapsed human phase transitions as privacy delay clears and the workflow completes", async () => {
    const workflowId = "wf-watch-human-phase-log";
    const originalPerformanceNow = performance.now;
    const privacyDelayStart = Date.parse("2026-03-24T12:00:00.000Z");
    let currentNowMs = privacyDelayStart;
    let performanceTick = 0;

    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId,
        phase: "approved_waiting_privacy_delay",
        aspStatus: "approved",
        committedValue: "500",
        privacyDelayProfile: "balanced",
        privacyDelayConfigured: true,
        approvalObservedAt: "2026-03-24T11:30:00.000Z",
        privacyDelayUntil: "2026-03-24T12:15:00.000Z",
      }),
    );

    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => {
        performanceTick += 1;
        return performanceTick * 1_500;
      },
    });

    overrideWorkflowTimingForTests({
      nowMs: () => currentNowMs,
      sleep: async () => {
        currentNowMs = Date.parse("2026-03-24T12:16:00.000Z");
      },
    });

    try {
      const { stderr } = await captureAsyncOutput(async () => {
        await watchWorkflow({
          workflowId,
          mode: HUMAN_MODE,
          isVerbose: false,
        });
      });

      expect(stderr).toContain("approved_waiting_privacy_delay completed in");
      expect(stderr).toContain("approved_ready_to_withdraw completed in");
    } finally {
      Object.defineProperty(performance, "now", {
        configurable: true,
        value: originalPerformanceNow,
      });
    }
  });

  test("ragequitWorkflow rejects workflows that have not deposited publicly yet", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-ragequit-undeposited",
        depositTxHash: null,
        poolAccountId: null,
        poolAccountNumber: null,
      }),
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-undeposited",
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("has not deposited publicly yet");
  });

  test("ragequitWorkflow rejects workflows that are already terminal", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-ragequit-terminal",
        phase: "completed",
      }),
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-terminal",
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("already terminal");
  });

  test("ragequitWorkflow rejects workflows with an in-flight relayed withdrawal", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-ragequit-withdrawing",
        phase: "withdrawing",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-withdrawing",
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("already in flight");
  });

  test("ragequitWorkflow fails closed when a pending ragequit was never checkpointed", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-ragequit-ambiguous",
        phase: "paused_declined",
        pendingSubmission: "ragequit",
        ragequitTxHash: null,
      }),
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-ambiguous",
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("may have submitted a public recovery transaction");
  });

  test("ragequitWorkflow finalizes pending ragequit receipts and cleans up workflow secrets", async () => {
    const secretFilePath = join(
      process.env.PRIVACY_POOLS_HOME!,
      "workflow-secrets",
      "wf-ragequit-receipt.json",
    );
    saveWorkflowSecretRecord({
      schemaVersion: "1",
      workflowId: "wf-ragequit-receipt",
      chain: "sepolia",
      walletAddress: sampleSnapshot().walletAddress as Address,
      privateKey: ("0x" + "11".repeat(32)) as Hex,
      createdAt: "2026-03-24T12:00:00.000Z",
    });
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-ragequit-receipt",
        phase: "paused_declined",
        ragequitTxHash: "0x" + "cc".repeat(32),
        ragequitBlockNumber: null,
        ragequitExplorerUrl: null,
      }),
    );

    const result = await ragequitWorkflow({
      workflowId: "wf-ragequit-receipt",
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.phase).toBe("completed_public_recovery");
    expect(result.ragequitBlockNumber).toBe("789");
    expect(existsSync(secretFilePath)).toBe(false);
  });

  test("ragequitWorkflow stops externally when the saved Pool Account was spent outside the workflow", async () => {
    saveWorkflowSnapshot(
      sampleSnapshot({
        workflowId: "wf-ragequit-mutated",
        phase: "paused_declined",
        aspStatus: "declined",
        committedValue: "500",
        ragequitTxHash: null,
        ragequitBlockNumber: null,
      }),
    );
    state.allPoolAccounts = [
      {
        ...state.allPoolAccounts[0],
        status: "spent",
        aspStatus: "approved",
      },
    ];

    const result = await ragequitWorkflow({
      workflowId: "wf-ragequit-mutated",
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.phase).toBe("stopped_external");
    expect(result.aspStatus).toBe("unknown");
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

  test("inspectFundingAndDeposit submits and checkpoints a funded native workflow deposit", async () => {
    state.nativeBalance = 1_000_000_000_000_000_000_000n;
    seedWorkflowWalletSecret();

    const result = await inspectFundingAndDeposit({
      snapshot: sampleSnapshot({
        phase: "awaiting_funding",
        depositTxHash: null,
        depositBlockNumber: null,
        requiredNativeFunding: "1",
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.continueWatching).toBe(true);
    expect(result.snapshot.phase).toBe("awaiting_asp");
    expect(result.snapshot.poolAccountId).toBe("PA-8");
    expect(result.snapshot.depositTxHash).toBe(state.depositSubmitTxHash);
    expect(result.snapshot.depositBlockNumber).toBe("333");
    expect(result.snapshot.depositLabel).toBe("199");
    expect(result.snapshot.committedValue).toBe("777");
    expect(depositETHMock).toHaveBeenCalledTimes(1);
    expect(approveERC20Mock).not.toHaveBeenCalled();
    expect(addPoolAccountMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
  });

  test("inspectFundingAndDeposit runs ERC20 approval before submitting the workflow deposit", async () => {
    state.resolvedPool = USDC_POOL;
    state.nativeBalance = 1_000_000_000_000_000_000_000n;
    state.tokenBalance = 10_000_000n;
    seedWorkflowWalletSecret();

    const result = await inspectFundingAndDeposit({
      snapshot: sampleSnapshot({
        phase: "awaiting_funding",
        asset: "USDC",
        assetDecimals: 6,
        depositAmount: "1000000",
        depositTxHash: null,
        depositBlockNumber: null,
        requiredNativeFunding: "1",
        requiredTokenFunding: "1000000",
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(result.snapshot.phase).toBe("awaiting_asp");
    expect(approveERC20Mock).toHaveBeenCalledTimes(1);
    expect(depositERC20Mock).toHaveBeenCalledTimes(1);
    expect(depositETHMock).not.toHaveBeenCalled();
    expect(addPoolAccountMock).toHaveBeenCalledTimes(1);
  });

  test("inspectFundingAndDeposit fails closed when ERC20 approval confirmation times out", async () => {
    state.resolvedPool = USDC_POOL;
    state.nativeBalance = 1_000_000_000_000_000_000_000n;
    state.tokenBalance = 10_000_000n;
    state.approvalReceiptMode = "timeout";
    seedWorkflowWalletSecret();

    await expect(
      inspectFundingAndDeposit({
        snapshot: sampleSnapshot({
          phase: "awaiting_funding",
          asset: "USDC",
          assetDecimals: 6,
          depositAmount: "1000000",
          depositTxHash: null,
          depositBlockNumber: null,
          requiredNativeFunding: "1",
          requiredTokenFunding: "1000000",
        }),
        mode: JSON_MODE,
        isVerbose: false,
      }),
    ).rejects.toThrow("Timed out waiting for approval confirmation.");

    expect(approveERC20Mock).toHaveBeenCalledTimes(1);
    expect(depositERC20Mock).not.toHaveBeenCalled();
  });

  test("inspectFundingAndDeposit warns but keeps the workflow moving when local deposit persistence fails", async () => {
    state.nativeBalance = 1_000_000_000_000_000_000_000n;
    saveAccountMock.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    seedWorkflowWalletSecret();

    const result = await inspectFundingAndDeposit({
      snapshot: sampleSnapshot({
        phase: "awaiting_funding",
        depositTxHash: null,
        depositBlockNumber: null,
        requiredNativeFunding: "1",
      }),
      mode: {
        ...JSON_MODE,
        isAgent: false,
        isJson: false,
        isQuiet: false,
        format: "table",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(result.snapshot.phase).toBe("awaiting_asp");
    expect(state.warnings.join("\n")).toContain(
      "Deposit confirmed onchain but failed to update local account state immediately",
    );
    expect(state.warnings.join("\n")).toContain(
      "Run 'privacy-pools sync --chain sepolia --asset ETH' before resuming this workflow.",
    );
  });

  test("executeRelayedWithdrawalForFlow fails closed when the latest root changes before proof generation", async () => {
    const context = await loadWorkflowPoolAccountContext(
      sampleSnapshot({
        phase: "approved_ready_to_withdraw",
        aspStatus: "approved",
      }),
      undefined,
      true,
    );
    state.latestRoot = 2n;

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
    ).rejects.toThrow("Pool state changed while preparing the workflow proof.");
  });

  test("executeRelayedWithdrawalForFlow fails closed when the latest root changes before relay submission", async () => {
    proveWithdrawalMock.mockImplementationOnce(async () => {
      state.latestRoot = 2n;
      return {
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
      };
    });

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
    ).rejects.toThrow("Pool state changed before submission.");

    expect(submitRelayRequestMock).not.toHaveBeenCalled();
  });

  test("executeRelayedWithdrawalForFlow fails closed when local proof verification fails", async () => {
    const proofError = new CLIError(
      "Generated withdrawal proof failed local verification.",
      "PROOF",
      "Re-run 'privacy-pools flow watch' to generate a fresh proof.",
      "PROOF_VERIFICATION_FAILED",
    );
    proveWithdrawalMock.mockImplementationOnce(async () => {
      throw proofError;
    });

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
    ).rejects.toBe(proofError);

    expect(submitRelayRequestMock).not.toHaveBeenCalled();
    expect(saveAccountMock).not.toHaveBeenCalled();
    expect(saveSyncMetaMock).not.toHaveBeenCalled();
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

  test("executeRelayedWithdrawalForFlow fails closed when the refreshed withdrawal data changes after proof generation", async () => {
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
          withdrawalData: encodeRelayerWithdrawalData({
            recipient: DEFAULT_WORKFLOW_RECIPIENT,
            feeRecipient:
              "0x9999999999999999999999999999999999999999" as Address,
            relayFeeBPS: 250n,
          }),
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
      ).rejects.toThrow("Relayer withdrawal data changed during proof generation");
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

  test("reconcilePendingDepositReceipt returns null when the client returns a null receipt payload", async () => {
    getPublicClientMock.mockImplementationOnce(() => ({
      ...getPublicClientMock(),
      getTransactionReceipt: async () => null,
    }));

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

  test("reconcilePendingDepositReceipt surfaces receipt lookup RPC failures", async () => {
    state.depositReceiptMode = "rpc_error";

    await expect(
      reconcilePendingDepositReceipt({
        snapshot: sampleSnapshot(),
        chainConfig: CHAINS.sepolia,
        pool: ETH_POOL,
      }),
    ).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_NETWORK_ERROR",
      retryable: true,
      message: expect.stringContaining("Network error: connect ECONNREFUSED"),
    });
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

  test("reconcilePendingWithdrawalReceipt returns null when the client returns a null receipt payload", async () => {
    getPublicClientMock.mockImplementationOnce(() => ({
      ...getPublicClientMock(),
      getTransactionReceipt: async () => null,
    }));

    const reconciled = await reconcilePendingWithdrawalReceipt({
      snapshot: sampleSnapshot({
        phase: "withdrawing",
        withdrawTxHash: "0x" + "bb".repeat(32),
        withdrawBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(reconciled).toBeNull();
  });

  test("reconcilePendingWithdrawalReceipt surfaces receipt lookup RPC failures", async () => {
    state.withdrawReceiptMode = "rpc_error";

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
    ).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_NETWORK_ERROR",
      retryable: true,
      message: expect.stringContaining("Network error: connect ECONNREFUSED"),
    });
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

  test("reconcilePendingRagequitReceipt returns null when the client returns a null receipt payload", async () => {
    getPublicClientMock.mockImplementationOnce(() => ({
      ...getPublicClientMock(),
      getTransactionReceipt: async () => null,
    }));

    const reconciled = await reconcilePendingRagequitReceipt({
      snapshot: sampleSnapshot({
        phase: "paused_declined",
        ragequitTxHash: "0x" + "cc".repeat(32),
        ragequitBlockNumber: null,
      }),
      mode: JSON_MODE,
      isVerbose: false,
    });

    expect(reconciled).toBeNull();
  });

  test("reconcilePendingRagequitReceipt surfaces receipt lookup RPC failures", async () => {
    state.ragequitReceiptMode = "rpc_error";

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
    ).rejects.toMatchObject({
      category: "RPC",
      code: "RPC_NETWORK_ERROR",
      retryable: true,
      message: expect.stringContaining("Network error: connect ECONNREFUSED"),
    });
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
