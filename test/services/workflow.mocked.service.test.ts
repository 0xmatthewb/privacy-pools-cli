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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {
  captureAsyncOutput,
  expectSilentOutput,
} from "../helpers/output.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/services/workflow-storage-version.ts";

const realConfig = await import("../../src/services/config.ts");
const realAccount = await import("../../src/services/account.ts");
const realAsp = await import("../../src/services/asp.ts");
const realChains = await import("../../src/config/chains.ts");
const realContracts = await import("../../src/services/contracts.ts");
const realFormat = await import("../../src/utils/format.ts");
const realInquirerPrompts = await import("@inquirer/prompts");
const realPoolAccounts = await import("../../src/utils/pool-accounts.ts");
const realPools = await import("../../src/services/pools.ts");
const realPreflight = await import("../../src/utils/preflight.ts");
const realProofs = await import("../../src/services/proofs.ts");
const realRelayer = await import("../../src/services/relayer.ts");
const realSdk = await import("../../src/services/sdk.ts");
const realWallet = await import("../../src/services/wallet.ts");
const realWithdraw = await import("../../src/commands/withdraw.ts");
const realViemAccounts = await import("viem/accounts");

const GLOBAL_SIGNER_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const MISMATCH_SIGNER_PRIVATE_KEY =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const NEW_WALLET_PRIVATE_KEY =
  "0x3333333333333333333333333333333333333333333333333333333333333333" as const;
const GLOBAL_SIGNER_ADDRESS =
  realViemAccounts.privateKeyToAccount(GLOBAL_SIGNER_PRIVATE_KEY).address;
const MISMATCH_SIGNER_ADDRESS =
  realViemAccounts.privateKeyToAccount(MISMATCH_SIGNER_PRIVATE_KEY).address;
const NEW_WALLET_ADDRESS =
  realViemAccounts.privateKeyToAccount(NEW_WALLET_PRIVATE_KEY).address;

const depositEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

interface MockState {
  tempHome: string;
  currentSignerPrivateKey: Hex | null;
  onchainDepositor: Address;
  loadPrivateKeyCalls: number;
  pool: {
    pool: Address;
    scope: bigint;
    asset: Address;
    symbol: string;
    decimals: number;
    minimumDepositAmount: bigint;
    vettingFeeBPS: bigint;
    maxRelayFeeBPS: bigint;
    deploymentBlock: bigint;
  };
  nativeBalance: bigint;
  tokenBalance: bigint;
  nativeBalanceSequence: bigint[] | null;
  tokenBalanceSequence: bigint[] | null;
  gasPrice: bigint;
  gasPriceError: boolean;
  aspUnavailable: boolean;
  aspStatus: "approved" | "pending" | "declined" | "poi_required";
  aspStatusSequence:
    | Array<"approved" | "pending" | "declined" | "poi_required">
    | null;
  latestRoot: bigint;
  latestRootSequence: bigint[] | null;
  aspMtRoot: bigint;
  currentRoot: bigint;
  commitmentHash: bigint;
  label: bigint;
  committedValue: bigint;
  precommitmentHash: bigint;
  poolAccountAvailable: boolean;
  poolAccountAvailableAfterReceiptChecks: number | null;
  poolAccountStatus: "approved" | "spent" | "exited";
  depositTxHash: Hex;
  approvalTxHash: Hex;
  relayTxHash: Hex;
  ragequitTxHash: Hex;
  approvalReceiptMode: "success" | "timeout" | "reverted";
  depositConfirmationMode: "success" | "timeout" | "reverted" | "missing_metadata";
  relayReceiptMode: "success" | "timeout" | "reverted";
  ragequitReceiptMode: "success" | "timeout" | "reverted";
  ragequitPendingReceiptMode: "success" | "pending" | "reverted";
  ragequitPendingReceiptAvailableAfter: number;
  feeReceiverAddress: Address;
  minWithdrawAmount: bigint;
  pendingReceiptMode: "success" | "pending" | "reverted";
  pendingReceiptAvailableAfter: number;
  getTransactionReceiptCalls: number;
  requestQuoteCalls: Array<{ amount: bigint; asset: Address; extraGas: boolean; recipient: Address }>;
  depositEthCalls: number;
  depositErc20Calls: number;
  approveErc20Calls: number;
  depositEthFailuresRemaining: number;
  depositErc20FailuresRemaining: number;
  submitRagequitCalls: number;
  addPoolAccountCalls: number;
  addWithdrawalCommitmentCalls: number;
  addRagequitCalls: number;
}

const state: MockState = {} as MockState;
type PromptBackupChoice = "copied" | "file";

const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () =>
  state.tempHome
    ? join(state.tempHome, "unused-wallet.txt")
    : "unused-wallet.txt",
);
const selectPromptMock = mock(async () => "copied" as PromptBackupChoice);

function makeTempHome(): string {
  return createTrackedTempDir("pp-workflow-mocked-");
}

function setPromptResponses({
  confirm = true,
  input = join(state.tempHome, "unused-wallet.txt"),
  select = "copied",
}: {
  confirm?: boolean;
  input?: string;
  select?: PromptBackupChoice;
} = {}): void {
  confirmPromptMock.mockClear();
  confirmPromptMock.mockImplementation(async () => confirm);
  inputPromptMock.mockClear();
  inputPromptMock.mockImplementation(async () => input);
  selectPromptMock.mockClear();
  selectPromptMock.mockImplementation(async () => select);
}

function useImmediateTimers(): () => void {
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (((callback: Parameters<typeof setTimeout>[0], _delay?: number, ...args: unknown[]) => {
    if (typeof callback === "function") {
      callback(...args);
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  return () => {
    globalThis.setTimeout = originalSetTimeout;
  };
}

function makeDepositLog(depositor: Address) {
  return {
    address: state.pool.pool,
    topics: encodeEventTopics({
      abi: depositEventAbi,
      eventName: "Deposited",
      args: {
        _depositor: depositor,
      },
    }),
    data: encodeAbiParameters(
      [
        { name: "_commitment", type: "uint256" },
        { name: "_label", type: "uint256" },
        { name: "_value", type: "uint256" },
        { name: "_precommitmentHash", type: "uint256" },
      ],
      [
        state.commitmentHash,
        state.label,
        state.committedValue,
        state.precommitmentHash,
      ],
    ),
  };
}

function depositReceipt(depositor: Address) {
  return {
    status: "success" as const,
    blockNumber: 101n,
    logs: [makeDepositLog(depositor)],
  };
}

function resetState(): void {
  state.tempHome = makeTempHome();
  state.currentSignerPrivateKey = GLOBAL_SIGNER_PRIVATE_KEY;
  state.onchainDepositor = GLOBAL_SIGNER_ADDRESS;
  state.loadPrivateKeyCalls = 0;
  state.pool = {
    pool: "0x5555555555555555555555555555555555555555",
    scope: 9n,
    asset: realChains.NATIVE_ASSET_ADDRESS,
    symbol: "ETH",
    decimals: 18,
    minimumDepositAmount: 1n,
    vettingFeeBPS: 50n,
    maxRelayFeeBPS: 100n,
    deploymentBlock: 0n,
  };
  state.nativeBalance = 10n ** 20n;
  state.tokenBalance = 0n;
  state.nativeBalanceSequence = null;
  state.tokenBalanceSequence = null;
  state.gasPrice = 10n ** 9n;
  state.gasPriceError = false;
  state.aspUnavailable = false;
  state.aspStatus = "approved";
  state.aspStatusSequence = null;
  state.latestRoot = 77n;
  state.latestRootSequence = null;
  state.aspMtRoot = 77n;
  state.currentRoot = 88n;
  state.commitmentHash = 88n;
  state.label = 91n;
  state.committedValue = 9950000000000000n;
  state.precommitmentHash = 42n;
  state.poolAccountAvailable = true;
  state.poolAccountAvailableAfterReceiptChecks = null;
  state.poolAccountStatus = "approved";
  state.depositTxHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  state.approvalTxHash =
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  state.relayTxHash =
    "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  state.ragequitTxHash =
    "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  state.approvalReceiptMode = "success";
  state.depositConfirmationMode = "success";
  state.relayReceiptMode = "success";
  state.ragequitReceiptMode = "success";
  state.ragequitPendingReceiptMode = "success";
  state.ragequitPendingReceiptAvailableAfter = 0;
  state.feeReceiverAddress = "0x6666666666666666666666666666666666666666";
  state.minWithdrawAmount = 1n;
  state.pendingReceiptMode = "success";
  state.pendingReceiptAvailableAfter = 0;
  state.getTransactionReceiptCalls = 0;
  state.requestQuoteCalls = [];
  state.depositEthCalls = 0;
  state.depositErc20Calls = 0;
  state.approveErc20Calls = 0;
  state.depositEthFailuresRemaining = 0;
  state.depositErc20FailuresRemaining = 0;
  state.submitRagequitCalls = 0;
  state.addPoolAccountCalls = 0;
  state.addWithdrawalCommitmentCalls = 0;
  state.addRagequitCalls = 0;
}

function nextBalance(sequence: bigint[] | null, fallback: bigint): bigint {
  if (!sequence || sequence.length === 0) return fallback;
  if (sequence.length === 1) return sequence[0];
  return sequence.shift()!;
}

function nextAspStatus(): MockState["aspStatus"] {
  if (!state.aspStatusSequence || state.aspStatusSequence.length === 0) {
    return state.aspStatus;
  }
  if (state.aspStatusSequence.length === 1) {
    state.aspStatus = state.aspStatusSequence[0];
    return state.aspStatus;
  }
  state.aspStatus = state.aspStatusSequence.shift()!;
  return state.aspStatus;
}

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

const depositEthMock = mock(async () => {
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

const submitRagequitMock = mock(async () => {
  state.submitRagequitCalls += 1;
  return { hash: state.ragequitTxHash };
});

const getDataServiceMock = mock(async () => ({ service: "data" }));
const initializeAccountServiceMock = mock(async () => accountService);
const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
const resolvePoolMock = mock(async () => state.pool);
const getRelayerDetailsMock = mock(async () => ({
  feeReceiverAddress: state.feeReceiverAddress,
  minWithdrawAmount: state.minWithdrawAmount.toString(),
}));
const requestQuoteMock = mock(async (
  _chain: unknown,
  args: { amount: bigint; asset: Address; extraGas: boolean; recipient: Address },
) => {
  state.requestQuoteCalls.push(args);
  return {
    feeBPS: "50",
    feeCommitment: "0xfeed",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
});
const submitRelayRequestMock = mock(async () => ({
  txHash: state.relayTxHash,
}));
const getRelayedWithdrawalRemainderAdvisoryMock = mock(() => null);
const refreshExpiredRelayerQuoteForWithdrawalMock = mock(async () => ({
  quote: {
    feeBPS: "50",
    feeCommitment: "0xfeed",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  quoteFeeBPS: 50,
  expirationMs: Date.now() + 60_000,
}));
const validateRelayerQuoteForWithdrawalMock = mock(() => ({
  quoteFeeBPS: 50,
  expirationMs: Date.now() + 60_000,
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

const publicClient = {
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
        throw new Error("relay receipt unavailable");
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
          throw new Error("ragequit receipt unavailable");
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
      throw new Error("Transaction still pending");
    }
    return depositReceipt(NEW_WALLET_ADDRESS);
  }),
};

const accountService = {
  account: {},
  createDepositSecrets: mock(() => ({
    precommitment: state.precommitmentHash,
    nullifier: 111n,
    secret: 222n,
  })),
  addPoolAccount: mock(() => {
    state.addPoolAccountCalls += 1;
  }),
  getSpendableCommitments: mock(() =>
    new Map([[state.pool.scope, [selectedPoolAccount().commitment]]]),
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

function selectedPoolAccount() {
  return {
    paNumber: 7,
    paId: "PA-7",
    status: state.poolAccountStatus,
    aspStatus: state.aspStatus,
    asset: state.pool.symbol,
    scope: state.pool.scope,
    value: state.committedValue,
    label: state.label,
    txHash: state.depositTxHash,
    blockNumber: 101n,
    commitment: {
      hash: state.commitmentHash,
      label: state.label,
      value: state.committedValue,
      nullifier: 555n,
      secret: 666n,
    },
  };
}

function isPoolAccountCurrentlyAvailable(): boolean {
  if (state.poolAccountAvailableAfterReceiptChecks === null) {
    return state.poolAccountAvailable;
  }
  return state.getTransactionReceiptCalls > state.poolAccountAvailableAfterReceiptChecks;
}

type WorkflowModuleType = typeof import("../../src/services/workflow.ts");
let getWorkflowStatus: WorkflowModuleType["getWorkflowStatus"];
let loadWorkflowSnapshot: WorkflowModuleType["loadWorkflowSnapshot"];
let ragequitWorkflow: WorkflowModuleType["ragequitWorkflow"];
let startWorkflow: WorkflowModuleType["startWorkflow"];
let watchWorkflow: WorkflowModuleType["watchWorkflow"];

async function installWorkflowMocks(): Promise<void> {
  mock.module("../../src/services/config.ts", () => ({
    ...realConfig,
    loadConfig: () => ({
      defaultChain: "sepolia",
    }),
  }));

  mock.module("../../src/services/wallet.ts", () => ({
    ...realWallet,
    loadMnemonic: loadMnemonicMock,
    loadPrivateKey: loadPrivateKeyMock,
  }));

  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    resolvePool: resolvePoolMock,
  }));

  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getPublicClient: mock(() => publicClient),
    getDataService: getDataServiceMock,
  }));

  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountService: initializeAccountServiceMock,
    saveAccount: saveAccountMock,
    saveSyncMeta: saveSyncMetaMock,
    withSuppressedSdkStdoutSync: <T>(fn: () => T) => fn(),
  }));

  mock.module("../../src/services/asp.ts", () => ({
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

  mock.module("../../src/services/contracts.ts", () => ({
    ...realContracts,
    approveERC20: approveErc20Mock,
    depositERC20: depositErc20Mock,
    depositETH: depositEthMock,
    ragequit: submitRagequitMock,
  }));

  mock.module("../../src/services/proofs.ts", () => ({
    ...realProofs,
    proveCommitment: mock(async () => ({
      proof: {
        pi_a: [1n, 2n],
        pi_b: [
          [3n, 4n],
          [5n, 6n],
        ],
        pi_c: [7n, 8n],
      },
      publicSignals: [9n, 10n, 11n, 12n],
    })),
    proveWithdrawal: mock(async () => ({
      proof: {
        pi_a: [1n, 2n],
        pi_b: [
          [3n, 4n],
          [5n, 6n],
        ],
        pi_c: [7n, 8n],
      },
      publicSignals: [13n, 14n, 15n, 16n],
    })),
  }));

  mock.module("../../src/services/relayer.ts", () => ({
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

  mock.module("../../src/utils/preflight.ts", () => ({
    ...realPreflight,
    checkErc20Balance: mock(async () => undefined),
    checkHasGas: mock(async () => undefined),
    checkNativeBalance: mock(async () => undefined),
  }));

  mock.module("../../src/utils/proof-progress.ts", () => ({
    withProofProgress: async (
      _spin: unknown,
      _label: string,
      fn: () => Promise<unknown>,
    ) => fn(),
  }));

  mock.module("../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
    buildAllPoolAccountRefs: mock(() =>
      isPoolAccountCurrentlyAvailable() ? [selectedPoolAccount()] : [],
    ),
    buildPoolAccountRefs: mock(() =>
      isPoolAccountCurrentlyAvailable() &&
      state.poolAccountStatus === "approved" &&
      state.aspStatus === "approved"
        ? [selectedPoolAccount()]
        : [],
    ),
    collectActiveLabels: mock(() => [state.label]),
    getNextPoolAccountNumber: mock(() => 7),
    poolAccountId: (paNumber: number) => `PA-${paNumber}`,
  }));

  mock.module("../../src/commands/withdraw.ts", () => ({
    ...realWithdraw,
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
    spinner: () => ({
      text: "",
      start() {},
      stop() {},
      succeed() {},
      fail() {},
    }),
    stageHeader: () => undefined,
    verbose: () => undefined,
    warn: () => undefined,
  }));

  mock.module("viem/accounts", () => ({
    ...realViemAccounts,
    generatePrivateKey: () => NEW_WALLET_PRIVATE_KEY,
  }));

  const workflowModule = await import("../../src/services/workflow.ts?workflow-mocked");
  ({
    getWorkflowStatus,
    loadWorkflowSnapshot,
    ragequitWorkflow,
    startWorkflow,
    watchWorkflow,
  } = workflowModule);
}

function writeWorkflowSnapshot(workflowId: string, patch: Record<string, unknown>) {
  realConfig.ensureConfigDir();
  const workflowsDir = realConfig.getWorkflowsDir();
  const snapshot = {
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId,
    createdAt: "2026-03-24T12:00:00.000Z",
    updatedAt: "2026-03-24T12:00:00.000Z",
    phase: "depositing_publicly",
    walletMode: "configured",
    walletAddress: GLOBAL_SIGNER_ADDRESS,
    chain: "sepolia",
    asset: state.pool.symbol,
    depositAmount: state.pool.decimals === 6 ? "100000000" : "10000000000000000",
    recipient: "0x7777777777777777777777777777777777777777",
    poolAccountId: "PA-7",
    poolAccountNumber: 7,
    depositTxHash: state.depositTxHash,
    depositBlockNumber: null,
    depositExplorerUrl: "https://example.test/deposit",
    committedValue: state.committedValue.toString(),
    aspStatus: "pending",
    ...patch,
  };
  writeFileSync(join(workflowsDir, `${workflowId}.json`), JSON.stringify(snapshot, null, 2), "utf8");
}

function writeWorkflowSecret(workflowId: string): void {
  realConfig.ensureConfigDir();
  writeFileSync(
    join(realConfig.getWorkflowSecretsDir(), `${workflowId}.json`),
    JSON.stringify(
      {
        schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
        workflowId,
        chain: "sepolia",
        walletAddress: NEW_WALLET_ADDRESS,
        privateKey: NEW_WALLET_PRIVATE_KEY,
        createdAt: "2026-03-24T12:00:00.000Z",
        backupConfirmedAt: "2026-03-24T12:00:01.000Z",
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("workflow service mocked coverage", () => {
  beforeAll(async () => {
    await installWorkflowMocks();
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    resetState();
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
    resolvePoolMock.mockClear();
    resolvePoolMock.mockImplementation(async () => state.pool);
    getRelayerDetailsMock.mockClear();
    getRelayerDetailsMock.mockImplementation(async () => ({
      feeReceiverAddress: state.feeReceiverAddress,
      minWithdrawAmount: state.minWithdrawAmount.toString(),
    }));
    requestQuoteMock.mockClear();
    requestQuoteMock.mockImplementation(async (_chain, args) => {
      state.requestQuoteCalls.push(args);
      return {
        feeBPS: "50",
        feeCommitment: "0xfeed",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    });
    submitRelayRequestMock.mockClear();
    submitRelayRequestMock.mockImplementation(async () => ({
      txHash: state.relayTxHash,
    }));
    getRelayedWithdrawalRemainderAdvisoryMock.mockClear();
    getRelayedWithdrawalRemainderAdvisoryMock.mockImplementation(() => null);
    refreshExpiredRelayerQuoteForWithdrawalMock.mockClear();
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementation(async () => ({
      quote: {
        feeBPS: "50",
        feeCommitment: "0xfeed",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      quoteFeeBPS: 50,
      expirationMs: Date.now() + 60_000,
    }));
    validateRelayerQuoteForWithdrawalMock.mockClear();
    validateRelayerQuoteForWithdrawalMock.mockImplementation(() => ({
      quoteFeeBPS: 50,
      expirationMs: Date.now() + 60_000,
    }));
  });

  afterEach(() => {
    delete process.env.PRIVACY_POOLS_HOME;
    rmSync(state.tempHome, { recursive: true, force: true });
  });

  test("configured flow start binds the original signer address into the saved workflow", async () => {
    const snapshot = await startWorkflow({
      amountInput: "0.01",
      assetInput: "ETH",
      recipient: "0x7777777777777777777777777777777777777777",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
      watch: false,
    });

    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.walletAddress).toBe(GLOBAL_SIGNER_ADDRESS);
    expect(snapshot.phase).toBe("awaiting_asp");
    expect(loadWorkflowSnapshot(snapshot.workflowId).walletAddress).toBe(
      GLOBAL_SIGNER_ADDRESS,
    );
  });

  test("flow start rejects amounts below the pool minimum before any deposit work", async () => {
    state.pool = {
      ...state.pool,
      minimumDepositAmount: 20_000_000_000_000_000n,
    };

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Deposit amount is below the minimum");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("machine-mode flow start rejects non-round amounts before submitting a deposit", async () => {
    await expect(
      startWorkflow({
        amountInput: "0.011",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Non-round amount 0.011 ETH may reduce privacy.");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("new-wallet flows require --export-new-wallet in machine mode", async () => {
    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Non-interactive workflow wallets require --export-new-wallet");
  });

  test("flow start rejects --export-new-wallet without --new-wallet", async () => {
    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        exportNewWallet: join(state.tempHome, "workflow-wallet.txt"),
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("--export-new-wallet requires --new-wallet");
  });

  test("new-wallet flows reject backup paths whose parent directory is missing", async () => {
    const backupPath = join(state.tempHome, "missing", "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup directory does not exist");

    expect(existsSync(backupPath)).toBe(false);
    const secretsDir = realConfig.getWorkflowSecretsDir();
    expect(
      existsSync(secretsDir) ? readdirSync(secretsDir) : [],
    ).toHaveLength(0);
  });

  test("new-wallet flows reject backup paths whose parent is a file", async () => {
    const parentPath = join(state.tempHome, "not-a-directory");
    writeFileSync(parentPath, "nope", "utf8");
    const backupPath = join(parentPath, "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup parent is not a directory");
  });

  test("new-wallet flows reject existing backup targets without overwriting them", async () => {
    const backupPath = join(state.tempHome, "workflow-wallet.txt");
    writeFileSync(backupPath, "do not overwrite", "utf8");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup file already exists");

    expect(readFileSync(backupPath, "utf8")).toBe("do not overwrite");
    const secretsDir = realConfig.getWorkflowSecretsDir();
    expect(
      existsSync(secretsDir) ? readdirSync(secretsDir) : [],
    ).toHaveLength(0);
  });

  test("new-wallet flows reject directory backup targets", async () => {
    const backupPath = join(state.tempHome, "existing-directory");
    mkdirSync(backupPath, { recursive: true });

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Workflow wallet backup path must point to a file");
  });

  test("new-wallet setup does not write secrets or backups before readiness checks pass", async () => {
    state.gasPriceError = true;
    const backupPath = join(state.tempHome, "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Could not estimate the workflow wallet gas reserve");

    expect(existsSync(backupPath)).toBe(false);
    const secretsDir = realConfig.getWorkflowSecretsDir();
    expect(
      existsSync(secretsDir) ? readdirSync(secretsDir) : [],
    ).toHaveLength(0);
  });

  test("configured ERC20 flows fail closed when approval confirmation times out", async () => {
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 0n;
    state.nativeBalance = 0n;
    state.approvalReceiptMode = "timeout";

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Timed out waiting for approval confirmation.");

    expect(state.approveErc20Calls).toBe(1);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("configured ERC20 flows fail closed when approval reverts", async () => {
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;
    state.approvalReceiptMode = "reverted";

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Approval transaction reverted");

    expect(state.approveErc20Calls).toBe(1);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("configured deposits fail closed when confirmation reverts", async () => {
    state.depositConfirmationMode = "reverted";

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Deposit transaction reverted");

    expect(state.depositEthCalls).toBe(1);
    expect(state.addPoolAccountCalls).toBe(0);
  });

  test("configured deposits fail closed when confirmation times out", async () => {
    state.depositConfirmationMode = "timeout";

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Timed out waiting for deposit confirmation.");

    expect(state.depositEthCalls).toBe(1);
    expect(state.addPoolAccountCalls).toBe(0);
  });

  test("configured deposits fail closed when receipt metadata cannot be recovered", async () => {
    state.depositConfirmationMode = "missing_metadata";

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow(
      "Deposit confirmed, but the workflow could not capture the new Pool Account metadata.",
    );

    expect(state.depositEthCalls).toBe(1);
    expect(state.addPoolAccountCalls).toBe(0);
  });

  test("configured deposits continue when local account persistence fails after confirmation", async () => {
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    let snapshot!: Awaited<ReturnType<typeof startWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("awaiting_asp");
    expect(snapshot.depositTxHash).toBe(state.depositTxHash);
    expect(state.addPoolAccountCalls).toBe(1);
    expect(saveAccountMock).toHaveBeenCalled();
  });

  test("new-wallet ERC20 flow completes with extra gas enabled and no global signer", async () => {
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const backupPath = join(state.tempHome, "workflow-wallet.txt");
    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(snapshot.walletMode).toBe("new_wallet");
      expect(snapshot.walletAddress).toBe(NEW_WALLET_ADDRESS);
      expect(snapshot.requiredTokenFunding).toBe("100000000");
      expect(state.loadPrivateKeyCalls).toBe(0);
      expect(state.approveErc20Calls).toBe(1);
      expect(state.depositErc20Calls).toBe(1);
      expect(state.requestQuoteCalls.at(-1)?.extraGas).toBe(true);
      expect(readFileSync(backupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
      expect(statSync(backupPath).mode & 0o777).toBe(0o600);
      expect(
        existsSync(
          join(realConfig.getWorkflowSecretsDir(), `${snapshot.workflowId}.json`),
        ),
      ).toBe(false);
    } finally {
      restoreTimers();
    }
  });

  test("configured flow start --watch completes the approved path", async () => {
    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: true,
      });

      expect(snapshot.phase).toBe("completed");
      expect(snapshot.depositTxHash).toBe(state.depositTxHash);
      expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
      expect(state.depositEthCalls).toBe(1);
      expect(state.requestQuoteCalls).toHaveLength(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow does not re-submit a pending public deposit", async () => {
    state.pendingReceiptAvailableAfter = 1;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-pending", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-pending",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(1);
      expect(getWorkflowStatus({ workflowId: "wf-pending" }).depositBlockNumber).toBe("101");
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow fails closed when a saved deposit may have been submitted without a persisted tx hash", async () => {
    writeWorkflowSecret("wf-ambiguous-deposit");
    writeWorkflowSnapshot("wf-ambiguous-deposit", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-ambiguous-deposit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    const failedSnapshot = getWorkflowStatus({ workflowId: "wf-ambiguous-deposit" });
    expect(failedSnapshot.phase).toBe("depositing_publicly");
    expect(failedSnapshot.depositTxHash).toBeNull();
    expect(failedSnapshot.lastError?.step).toBe("deposit");
    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);

    await expect(
      watchWorkflow({
        workflowId: "wf-ambiguous-deposit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow returns saved terminal workflows without advancing them again", async () => {
    writeWorkflowSnapshot("wf-terminal", {
      phase: "completed",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: "101",
      depositExplorerUrl: "https://example.invalid/tx/terminal",
      committedValue: state.committedValue.toString(),
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: "202",
      withdrawExplorerUrl: "https://example.invalid/tx/withdraw",
    });

    const result = await watchWorkflow({
      workflowId: "wf-terminal",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(result.phase).toBe("completed");
    expect(state.depositEthCalls).toBe(0);
    expect(state.submitRagequitCalls).toBe(0);
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow does not retry after a checkpoint failure without a saved tx hash", async () => {
    writeWorkflowSecret("wf-checkpoint-failed");
    writeWorkflowSnapshot("wf-checkpoint-failed", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
      lastError: {
        step: "deposit",
        errorCode: "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED",
        errorMessage: "Public deposit was submitted, but the workflow could not checkpoint it locally.",
        retryable: false,
        at: "2026-03-24T12:00:00.000Z",
      },
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-checkpoint-failed",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow does not retry legacy checkpoint failures without a saved tx hash", async () => {
    writeWorkflowSecret("wf-legacy-checkpoint-failed");
    writeWorkflowSnapshot("wf-legacy-checkpoint-failed", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
      lastError: {
        step: "deposit",
        errorCode: "INPUT_ERROR",
        errorMessage: "Public deposit was submitted, but the workflow could not checkpoint it locally.",
        retryable: false,
        at: "2026-03-24T12:00:00.000Z",
      },
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-legacy-checkpoint-failed",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("transaction hash was not checkpointed locally");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("watchWorkflow reattaches a confirmed pending deposit before continuing", async () => {
    state.pendingReceiptAvailableAfter = 0;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-pending-confirmed", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-pending-confirmed",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(snapshot.depositBlockNumber).toBe("101");
      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow keeps waiting for mining until the submitted deposit is indexed", async () => {
    state.pendingReceiptAvailableAfter = 1;
    state.poolAccountAvailable = false;
    state.poolAccountAvailableAfterReceiptChecks = 1;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-pending-mining", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-pending-mining",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(snapshot.depositBlockNumber).toBe("101");
      expect(state.depositEthCalls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(2);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow reconciles a depositing snapshot from local account state when the receipt lookup is still pending", async () => {
    state.pendingReceiptAvailableAfter = 99;
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-local-deposit-reconcile", {
      phase: "depositing_publicly",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-local-deposit-reconcile",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("paused_declined");
      expect(snapshot.depositBlockNumber).toBe("101");
      expect(snapshot.poolAccountId).toBe("PA-7");
      expect(state.getTransactionReceiptCalls).toBe(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow pauses configured flows when the ASP declines them", async () => {
    state.aspStatus = "declined";
    writeWorkflowSnapshot("wf-declined", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-declined",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_declined");
    expect(snapshot.aspStatus).toBe("declined");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow pauses flows that require Proof of Association", async () => {
    state.aspStatus = "poi_required";
    writeWorkflowSnapshot("wf-poi", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-poi",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_poi_required");
    expect(snapshot.aspStatus).toBe("poi_required");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow stops when the saved workflow no longer matches the Pool Account state", async () => {
    writeWorkflowSnapshot("wf-mismatch", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositLabel: state.label.toString(),
      committedValue: "1",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-mismatch",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(snapshot.workflowId).toBe("wf-mismatch");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow reconciles paused declined workflows after manual recovery", async () => {
    state.poolAccountStatus = "exited";
    writeWorkflowSnapshot("wf-declined-external-ragequit", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-declined-external-ragequit",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("watchWorkflow keeps paused declined workflows readable during ASP outages", async () => {
    state.aspStatus = "declined";
    state.aspUnavailable = true;
    writeWorkflowSnapshot("wf-declined-asp-outage", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-declined-asp-outage",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_declined");
    expect(snapshot.aspStatus).toBe("declined");
    expect(state.requestQuoteCalls).toHaveLength(0);
  });

  test("configured flow ragequit fails fast when the signer no longer matches the original depositor", async () => {
    writeWorkflowSnapshot("wf-ragequit", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.currentSignerPrivateKey = MISMATCH_SIGNER_PRIVATE_KEY;

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow(
      `Configured signer ${MISMATCH_SIGNER_ADDRESS} does not match the original depositor ${GLOBAL_SIGNER_ADDRESS}.`,
    );
  });

  test("configured flow ragequit succeeds with the original signer", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.currentSignerPrivateKey = GLOBAL_SIGNER_PRIVATE_KEY;

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.loadPrivateKeyCalls).toBe(1);
    expect(state.submitRagequitCalls).toBe(1);
    expect(state.addRagequitCalls).toBe(1);
  });

  test("configured flow ragequit reconciles workflows already recovered manually", async () => {
    state.poolAccountStatus = "exited";
    writeWorkflowSnapshot("wf-configured-ragequit-external", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit-external",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("stopped_external");
    expect(state.submitRagequitCalls).toBe(0);
    expect(state.addRagequitCalls).toBe(0);
  });

  test("configured flow ragequit does not depend on ASP availability", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-no-asp", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.aspUnavailable = true;

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit-no-asp",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
  });

  test("configured flow ragequit continues when depositor preverification is unavailable", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-no-preverify", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    publicClient.readContract.mockImplementationOnce(async ({ functionName }: { functionName: string }) => {
      if (functionName === "depositors") {
        throw new Error("depositor lookup unavailable");
      }
      return functionName === "currentRoot" ? state.currentRoot : state.latestRoot;
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-configured-ragequit-no-preverify",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: true,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(1);
  });

  test("configured flow ragequit still completes when local account persistence fails", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-save-warning", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    let snapshot!: Awaited<ReturnType<typeof ragequitWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await ragequitWorkflow({
        workflowId: "wf-configured-ragequit-save-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(saveAccountMock).toHaveBeenCalled();
  });

  test("configured flow ragequit fails closed when confirmation times out", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-timeout", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.ragequitReceiptMode = "timeout";

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-timeout",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Timed out waiting for workflow ragequit confirmation.");
  });

  test("configured flow ragequit fails closed when confirmation reverts", async () => {
    writeWorkflowSnapshot("wf-configured-ragequit-revert", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.ragequitReceiptMode = "reverted";

    await expect(
      ragequitWorkflow({
        workflowId: "wf-configured-ragequit-revert",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow ragequit transaction reverted");
  });

  test("new-wallet ragequit succeeds with the stored workflow secret", async () => {
    writeWorkflowSecret("wf-new-wallet-ragequit");
    writeWorkflowSnapshot("wf-new-wallet-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    state.currentSignerPrivateKey = null;
    state.onchainDepositor = NEW_WALLET_ADDRESS;

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-new-wallet-ragequit",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(1);
    expect(state.addRagequitCalls).toBe(1);
    expect(
      existsSync(
        join(realConfig.getWorkflowSecretsDir(), "wf-new-wallet-ragequit.json"),
      ),
    ).toBe(false);
  });

  test("new-wallet ragequit fails cleanly when the stored workflow secret is missing", async () => {
    writeWorkflowSnapshot("wf-missing-secret-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-missing-secret-ragequit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow wallet secret is missing");
  });

  test("new-wallet ragequit fails cleanly when the stored workflow secret is unreadable", async () => {
    writeWorkflowSnapshot("wf-broken-secret-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    realConfig.ensureConfigDir();
    writeFileSync(
      join(realConfig.getWorkflowSecretsDir(), "wf-broken-secret-ragequit.json"),
      "{not-json",
      "utf8",
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-broken-secret-ragequit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow wallet secret is unreadable");
  });

  test("new-wallet ragequit fails cleanly when the stored workflow secret is malformed", async () => {
    writeWorkflowSnapshot("wf-invalid-secret-ragequit", {
      phase: "paused_declined",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });
    realConfig.ensureConfigDir();
    writeFileSync(
      join(realConfig.getWorkflowSecretsDir(), "wf-invalid-secret-ragequit.json"),
      JSON.stringify(
        {
          schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
          workflowId: "wf-invalid-secret-ragequit",
          chain: "sepolia",
          walletAddress: NEW_WALLET_ADDRESS,
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      ragequitWorkflow({
        workflowId: "wf-invalid-secret-ragequit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow wallet secret has invalid structure");
  });

  test("ragequitWorkflow accepts explicit latest and waits on the saved public recovery tx", async () => {
    writeWorkflowSnapshot("wf-ragequit-older", {
      phase: "paused_declined",
      aspStatus: "declined",
      updatedAt: "2026-03-24T12:00:00.000Z",
    });
    writeWorkflowSnapshot("wf-ragequit-latest", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
      updatedAt: "2026-03-24T12:10:00.000Z",
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "latest",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.workflowId).toBe("wf-ragequit-latest");
    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(0);
  });

  test("ragequitWorkflow waits for a saved public recovery when the quick receipt lookup is pending", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    writeWorkflowSnapshot("wf-ragequit-await-confirmation", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    const snapshot = await ragequitWorkflow({
      workflowId: "wf-ragequit-await-confirmation",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitBlockNumber).toBe("303");
    expect(state.submitRagequitCalls).toBe(0);
  });

  test("ragequitWorkflow fails closed when a saved public recovery times out while waiting for confirmation", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    state.ragequitReceiptMode = "timeout";
    writeWorkflowSnapshot("wf-ragequit-await-timeout", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-await-timeout",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Timed out waiting for workflow ragequit confirmation.");
  });

  test("ragequitWorkflow fails closed when a saved public recovery reverts while waiting for confirmation", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    state.ragequitReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-ragequit-await-revert", {
      phase: "paused_declined",
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-ragequit-await-revert",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow ragequit transaction reverted");
  });

  test("watchWorkflow clears new-wallet secrets after a saved public recovery confirms", async () => {
    writeWorkflowSecret("wf-ragequit-watch");
    writeWorkflowSnapshot("wf-ragequit-watch", {
      phase: "paused_poi_required",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      aspStatus: "poi_required",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-ragequit-watch",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(state.submitRagequitCalls).toBe(0);
    expect(
      existsSync(join(realConfig.getWorkflowSecretsDir(), "wf-ragequit-watch.json")),
    ).toBe(false);
  });

  test("watchWorkflow leaves pending public recoveries unresolved when confirmation is still pending", async () => {
    state.ragequitPendingReceiptMode = "pending";
    state.ragequitPendingReceiptAvailableAfter = 1;
    writeWorkflowSnapshot("wf-ragequit-still-pending", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-ragequit-still-pending",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("paused_declined");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
    expect(snapshot.ragequitBlockNumber).toBeNull();
  });

  test("watchWorkflow completes pending public recoveries even if local refresh fails", async () => {
    initializeAccountServiceMock.mockImplementation(async () => {
      throw new Error("refresh failed");
    });
    writeWorkflowSnapshot("wf-ragequit-refresh-warning", {
      phase: "paused_poi_required",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      aspStatus: "poi_required",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await watchWorkflow({
        workflowId: "wf-ragequit-refresh-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed_public_recovery");
    expect(snapshot.ragequitBlockNumber).toBe("303");
    expect(snapshot.ragequitTxHash).toBe(state.ragequitTxHash);
  });

  test("watchWorkflow fails closed when a pending public recovery reverts", async () => {
    state.ragequitPendingReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-ragequit-reverted", {
      phase: "paused_declined",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      aspStatus: "declined",
      ragequitTxHash: state.ragequitTxHash,
      ragequitBlockNumber: null,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-ragequit-reverted",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Previously submitted workflow ragequit reverted");

    expect(getWorkflowStatus({ workflowId: "wf-ragequit-reverted" }).lastError?.step).toBe(
      "inspect_approval",
    );
  });

  test("saved new-wallet workflows wait for funding and then complete once balances arrive", async () => {
    writeWorkflowSecret("wf-funded-later");
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.nativeBalanceSequence = [0n, 10n ** 18n, 10n ** 18n];
    state.tokenBalanceSequence = [0n, 100000000n, 100000000n];

    writeWorkflowSnapshot("wf-funded-later", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: "100000000",
      aspStatus: undefined,
    });

    const restoreTimers = useImmediateTimers();
    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-funded-later",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(state.depositErc20Calls).toBe(1);
      expect(state.approveErc20Calls).toBe(1);
      expect(getWorkflowStatus({ workflowId: "wf-funded-later" }).withdrawTxHash).toBe(
        state.relayTxHash,
      );
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow retries a new-wallet deposit after a submission failure before any tx hash is saved", async () => {
    writeWorkflowSecret("wf-retry-submit");
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.nativeBalance = 10n ** 18n;
    state.tokenBalance = 100000000n;
    state.depositErc20FailuresRemaining = 1;
    state.poolAccountAvailable = false;

    writeWorkflowSnapshot("wf-retry-submit", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: "100000000",
      aspStatus: undefined,
    });

    const restoreTimers = useImmediateTimers();
    try {
      await expect(
        watchWorkflow({
          workflowId: "wf-retry-submit",
          globalOpts: { chain: "sepolia" },
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
      ).rejects.toThrow("Simulated ERC20 deposit submission failure");

      const failedSnapshot = getWorkflowStatus({ workflowId: "wf-retry-submit" });
      expect(failedSnapshot.phase).toBe("depositing_publicly");
      expect(failedSnapshot.depositTxHash).toBeNull();
      expect(failedSnapshot.lastError?.step).toBe("deposit");
      expect(state.depositErc20Calls).toBe(1);

      const retriedSnapshot = await watchWorkflow({
        workflowId: "wf-retry-submit",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(retriedSnapshot.phase).toBe("completed");
      expect(retriedSnapshot.depositTxHash).toBe(state.depositTxHash);
      expect(retriedSnapshot.lastError).toBeUndefined();
      expect(state.depositErc20Calls).toBe(2);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow saves a withdraw lastError when the relayer minimum blocks the flow", async () => {
    state.minWithdrawAmount = state.committedValue + 1n;
    writeWorkflowSnapshot("wf-relayer-min", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-relayer-min",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow amount is below the relayer minimum");

    const snapshot = getWorkflowStatus({ workflowId: "wf-relayer-min" });
    expect(snapshot.lastError?.step).toBe("withdraw");
    expect(snapshot.lastError?.errorMessage).toContain("below the relayer minimum");
  });

  test("watchWorkflow refreshes an expired relayer quote before proof generation", async () => {
    const originalNow = Date.now;
    Date.now = () => 3_000;
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => ({
      quoteFeeBPS: 50,
      expirationMs: 2_000,
    }));
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementationOnce(async () => ({
      quote: {
        feeBPS: "50",
        feeCommitment: "0xfeed",
        expiresAt: new Date(9_000).toISOString(),
      },
      quoteFeeBPS: 50,
      expirationMs: 9_000,
    }));
    writeWorkflowSnapshot("wf-refresh-before-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-refresh-before-proof",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(refreshExpiredRelayerQuoteForWithdrawalMock).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalNow;
    }
  });

  test("watchWorkflow refreshes an expired relayer quote after proof generation when the fee is unchanged", async () => {
    const originalNow = Date.now;
    let nowCalls = 0;
    Date.now = () => (++nowCalls === 1 ? 1_000 : 3_000);
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => ({
      quoteFeeBPS: 50,
      expirationMs: 2_000,
    }));
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementationOnce(async () => ({
      quote: {
        feeBPS: "50",
        feeCommitment: "0xfeed",
        expiresAt: new Date(9_000).toISOString(),
      },
      quoteFeeBPS: 50,
      expirationMs: 9_000,
    }));
    requestQuoteMock.mockImplementationOnce(async (_chain, args) => {
      state.requestQuoteCalls.push(args);
      return {
        feeBPS: "50",
        feeCommitment: "0xfeed",
        expiresAt: new Date(2_000).toISOString(),
      };
    });
    writeWorkflowSnapshot("wf-refresh-after-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    try {
      const snapshot = await watchWorkflow({
        workflowId: "wf-refresh-after-proof",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });

      expect(snapshot.phase).toBe("completed");
      expect(refreshExpiredRelayerQuoteForWithdrawalMock).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalNow;
    }
  });

  test("watchWorkflow fails closed when the relayer fee changes after proof generation", async () => {
    const originalNow = Date.now;
    let nowCalls = 0;
    Date.now = () => (++nowCalls === 1 ? 1_000 : 3_000);
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => ({
      quoteFeeBPS: 50,
      expirationMs: 2_000,
    }));
    refreshExpiredRelayerQuoteForWithdrawalMock.mockImplementationOnce(async () => ({
      quote: {
        feeBPS: "75",
        feeCommitment: "0xfeed",
        expiresAt: new Date(9_000).toISOString(),
      },
      quoteFeeBPS: 75,
      expirationMs: 9_000,
    }));
    requestQuoteMock.mockImplementationOnce(async (_chain, args) => {
      state.requestQuoteCalls.push(args);
      return {
        feeBPS: "50",
        feeCommitment: "0xfeed",
        expiresAt: new Date(2_000).toISOString(),
      };
    });
    writeWorkflowSnapshot("wf-fee-change-after-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    try {
      await expect(
        watchWorkflow({
          workflowId: "wf-fee-change-after-proof",
          globalOpts: { chain: "sepolia" },
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
      ).rejects.toThrow("Relayer fee changed during proof generation");

      expect(getWorkflowStatus({ workflowId: "wf-fee-change-after-proof" }).lastError?.step).toBe(
        "withdraw",
      );
    } finally {
      Date.now = originalNow;
    }
  });

  test("watchWorkflow fails closed when the latest root changes before workflow proof generation", async () => {
    state.latestRootSequence = [2n];
    writeWorkflowSnapshot("wf-latest-root-before-proof", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-latest-root-before-proof",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Pool state changed while preparing the workflow proof.");

    expect(getWorkflowStatus({ workflowId: "wf-latest-root-before-proof" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when the latest root changes before relay submission", async () => {
    state.latestRootSequence = [state.latestRoot, 2n];
    writeWorkflowSnapshot("wf-latest-root-before-submit", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-latest-root-before-submit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Pool state changed before submission.");

    expect(getWorkflowStatus({ workflowId: "wf-latest-root-before-submit" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when the workflow relayer quote request fails", async () => {
    requestQuoteMock.mockImplementationOnce(async () => {
      throw new Error("quote offline");
    });
    writeWorkflowSnapshot("wf-quote-request-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-quote-request-failure",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("quote offline");

    expect(getWorkflowStatus({ workflowId: "wf-quote-request-failure" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when workflow relayer quote validation fails", async () => {
    validateRelayerQuoteForWithdrawalMock.mockImplementationOnce(() => {
      throw new Error("Workflow relayer quote is invalid.");
    });
    writeWorkflowSnapshot("wf-quote-validation-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-quote-validation-failure",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow relayer quote is invalid.");

    expect(getWorkflowStatus({ workflowId: "wf-quote-validation-failure" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when workflow relay submission fails", async () => {
    submitRelayRequestMock.mockImplementationOnce(async () => {
      throw new Error("relay unavailable");
    });
    writeWorkflowSnapshot("wf-relay-submit-failure", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-relay-submit-failure",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("relay unavailable");

    expect(getWorkflowStatus({ workflowId: "wf-relay-submit-failure" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when a new-wallet funding snapshot is missing the wallet address", async () => {
    writeWorkflowSecret("wf-missing-wallet-address");
    writeWorkflowSnapshot("wf-missing-wallet-address", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: null,
      depositTxHash: null,
      depositBlockNumber: null,
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: null,
      aspStatus: undefined,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-missing-wallet-address",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Workflow wallet address is missing");

    expect(getWorkflowStatus({ workflowId: "wf-missing-wallet-address" }).lastError?.step).toBe(
      "funding",
    );
  });

  test("watchWorkflow fails closed when workflow withdrawal sees a stale pool root", async () => {
    state.currentRoot = 999n;
    writeWorkflowSnapshot("wf-stale-pool-root", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-stale-pool-root",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Pool data is out of date.");

    expect(getWorkflowStatus({ workflowId: "wf-stale-pool-root" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow still completes approved flows when local withdrawal persistence fails", async () => {
    saveAccountMock.mockImplementation(() => {
      throw new Error("disk full");
    });
    writeWorkflowSnapshot("wf-withdraw-save-warning", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await watchWorkflow({
        workflowId: "wf-withdraw-save-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
    expect(saveAccountMock).toHaveBeenCalled();
  });

  test("watchWorkflow fails closed when relayed withdrawal confirmation times out", async () => {
    state.relayReceiptMode = "timeout";
    writeWorkflowSnapshot("wf-withdraw-timeout", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-withdraw-timeout",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Timed out waiting for relayed withdrawal confirmation.");

    expect(getWorkflowStatus({ workflowId: "wf-withdraw-timeout" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("watchWorkflow fails closed when relayed withdrawal confirmation reverts", async () => {
    state.relayReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-withdraw-submit-reverted", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-withdraw-submit-reverted",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Relay transaction reverted");

    expect(
      getWorkflowStatus({ workflowId: "wf-withdraw-submit-reverted" }).lastError?.step,
    ).toBe("withdraw");
  });

  test("watchWorkflow fails closed when ASP roots are mid-update", async () => {
    state.aspMtRoot = state.latestRoot - 1n;
    writeWorkflowSnapshot("wf-asp-updating", {
      phase: "awaiting_asp",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-asp-updating",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Withdrawal service data is still updating");

    expect(getWorkflowStatus({ workflowId: "wf-asp-updating" }).lastError?.step).toBe(
      "inspect_approval",
    );
  });

  test("watchWorkflow fails closed when a saved deposit receipt shows a revert", async () => {
    state.pendingReceiptMode = "reverted";
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    writeWorkflowSnapshot("wf-reverted-pending", {
      phase: "depositing_publicly",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: state.depositTxHash,
      depositBlockNumber: null,
      depositExplorerUrl: "https://example.test/deposit",
      requiredNativeFunding: "1000000000000000",
      requiredTokenFunding: "100000000",
      aspStatus: undefined,
    });
    writeWorkflowSecret("wf-reverted-pending");

    const restoreTimers = useImmediateTimers();
    try {
      await expect(
        watchWorkflow({
          workflowId: "wf-reverted-pending",
          globalOpts: { chain: "sepolia" },
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
      ).rejects.toThrow("Previously submitted workflow deposit reverted");

      const failedSnapshot = getWorkflowStatus({ workflowId: "wf-reverted-pending" });
      expect(failedSnapshot.phase).toBe("depositing_publicly");
      expect(failedSnapshot.depositTxHash).toBe(state.depositTxHash);
      expect(failedSnapshot.depositBlockNumber).toBeNull();
      expect(failedSnapshot.lastError?.step).toBe("deposit");
      expect(failedSnapshot.lastError?.errorMessage).toContain("deposit reverted");
      expect(state.approveErc20Calls).toBe(0);
      expect(state.depositErc20Calls).toBe(0);
      expect(state.getTransactionReceiptCalls).toBe(1);
    } finally {
      restoreTimers();
    }
  });

  test("watchWorkflow rebinds the saved Pool Account using the deposit label when numbering drifts", async () => {
    writeWorkflowSnapshot("wf-label-rebind", {
      phase: "awaiting_asp",
      poolAccountId: "PA-99",
      poolAccountNumber: 99,
      depositTxHash:
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      depositLabel: state.label.toString(),
      depositBlockNumber: "101",
      aspStatus: "approved",
    });

    const snapshot = await watchWorkflow({
      workflowId: "wf-label-rebind",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.phase).toBe("completed");
    expect(snapshot.poolAccountNumber).toBe(7);
    expect(snapshot.poolAccountId).toBe("PA-7");
    expect(snapshot.depositTxHash).toBe(state.depositTxHash);
  });

  test("watchWorkflow accepts explicit latest and resumes a submitted relayed withdrawal", async () => {
    writeWorkflowSnapshot("wf-watch-older", {
      phase: "awaiting_asp",
      aspStatus: "pending",
      updatedAt: "2026-03-24T12:00:00.000Z",
    });
    writeWorkflowSnapshot("wf-watch-latest", {
      phase: "withdrawing",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
      updatedAt: "2026-03-24T12:10:00.000Z",
    });

    const snapshot = await watchWorkflow({
      workflowId: "latest",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: true,
        isJson: true,
        isCsv: false,
        isQuiet: true,
        format: "json",
        skipPrompts: true,
      },
      isVerbose: false,
    });

    expect(snapshot.workflowId).toBe("wf-watch-latest");
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
    expect(state.requestQuoteCalls).toHaveLength(0);
    expect(state.addWithdrawalCommitmentCalls).toBe(0);
  });

  test("watchWorkflow completes pending relayed withdrawals even if local refresh fails", async () => {
    initializeAccountServiceMock.mockImplementation(async () => {
      throw new Error("refresh failed");
    });
    writeWorkflowSnapshot("wf-withdraw-refresh-warning", {
      phase: "withdrawing",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
    });

    let snapshot!: Awaited<ReturnType<typeof watchWorkflow>>;
    const output = await captureAsyncOutput(async () => {
      snapshot = await watchWorkflow({
        workflowId: "wf-withdraw-refresh-warning",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
      });
    });

    expectSilentOutput(output);
    expect(snapshot.phase).toBe("completed");
    expect(snapshot.withdrawBlockNumber).toBe("202");
    expect(snapshot.withdrawTxHash).toBe(state.relayTxHash);
  });

  test("watchWorkflow fails closed when a pending relayed withdrawal reverts", async () => {
    state.relayReceiptMode = "reverted";
    writeWorkflowSnapshot("wf-withdraw-reverted", {
      phase: "withdrawing",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
    });

    await expect(
      watchWorkflow({
        workflowId: "wf-withdraw-reverted",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("Previously submitted workflow withdrawal reverted");

    expect(getWorkflowStatus({ workflowId: "wf-withdraw-reverted" }).lastError?.step).toBe(
      "withdraw",
    );
  });

  test("interactive configured flows confirm the manual signer path before saving the workflow", async () => {
    setPromptResponses();

    const snapshot = await startWorkflow({
      amountInput: "0.01",
      assetInput: "ETH",
      recipient: "0x7777777777777777777777777777777777777777",
      globalOpts: { chain: "sepolia" },
      mode: {
        isAgent: false,
        isJson: false,
        isCsv: false,
        isQuiet: false,
        format: "table",
        skipPrompts: false,
      },
      isVerbose: false,
      watch: false,
    });

    expect(snapshot.phase).toBe("awaiting_asp");
    expect(snapshot.walletMode).toBe("configured");
    expect(snapshot.walletAddress).toBe(GLOBAL_SIGNER_ADDRESS);
    expect(snapshot.depositTxHash).toBe(state.depositTxHash);
  });

  test("configured flow start fails closed when the workflow snapshot cannot be saved after deposit", async () => {
    realConfig.ensureConfigDir();
    rmSync(realConfig.getWorkflowsDir(), { recursive: true, force: true });
    writeFileSync(realConfig.getWorkflowsDir(), "not-a-directory", "utf8");

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Deposit succeeded, but the workflow could not be saved locally.");

    expect(state.depositEthCalls).toBe(1);
  });

  test("new-wallet flow start cleans up the saved secret if the workflow snapshot cannot be persisted", async () => {
    realConfig.ensureConfigDir();
    rmSync(realConfig.getWorkflowsDir(), { recursive: true, force: true });
    writeFileSync(realConfig.getWorkflowsDir(), "not-a-directory", "utf8");
    const backupPath = join(state.tempHome, "workflow-wallet.txt");

    await expect(
      startWorkflow({
        amountInput: "100",
        assetInput: "USDC",
        recipient: "0x7777777777777777777777777777777777777777",
        newWallet: true,
        exportNewWallet: backupPath,
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: true,
          isJson: true,
          isCsv: false,
          isQuiet: true,
          format: "json",
          skipPrompts: true,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("ENOTDIR");

    expect(existsSync(backupPath)).toBe(true);
    const secretFiles = existsSync(realConfig.getWorkflowSecretsDir())
      ? readdirSync(realConfig.getWorkflowSecretsDir())
      : [];
    expect(secretFiles).toHaveLength(0);
  });

  test("interactive configured flows can cancel on the non-round amount privacy warning", async () => {
    setPromptResponses({ confirm: false });

    await expect(
      startWorkflow({
        amountInput: "0.011",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Flow cancelled.");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("interactive configured flows can cancel at the final confirmation prompt", async () => {
    setPromptResponses({ confirm: false });

    await expect(
      startWorkflow({
        amountInput: "0.01",
        assetInput: "ETH",
        recipient: "0x7777777777777777777777777777777777777777",
        globalOpts: { chain: "sepolia" },
        mode: {
          isAgent: false,
          isJson: false,
          isCsv: false,
          isQuiet: false,
          format: "table",
          skipPrompts: false,
        },
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("Flow cancelled.");

    expect(state.depositEthCalls).toBe(0);
    expect(state.depositErc20Calls).toBe(0);
  });

  test("interactive new-wallet flows can confirm backup and complete", async () => {
    setPromptResponses({ input: join(state.tempHome, "ignored-wallet.txt") });
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const backupPath = join(state.tempHome, "interactive-wallet.txt");
    const restoreTimers = useImmediateTimers();
    try {
      let snapshot: Awaited<ReturnType<typeof startWorkflow>> | null = null;
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        snapshot = await startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          newWallet: true,
          exportNewWallet: backupPath,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: true,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        });
      });

      expect(stdout).toBe("");
      expect(stderr.trim()).toBe("");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.phase).toBe("completed");
      expect(snapshot!.backupConfirmed).toBe(true);
      expect(readFileSync(backupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
    } finally {
      restoreTimers();
    }
  });

  test("interactive new-wallet flows can choose a backup file path and complete", async () => {
    const promptedBackupPath = join(state.tempHome, "prompted-wallet.txt");
    setPromptResponses({ input: promptedBackupPath, select: "file" });
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const restoreTimers = useImmediateTimers();
    try {
      let snapshot: Awaited<ReturnType<typeof startWorkflow>> | null = null;
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        snapshot = await startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: true,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        });
      });

      expect(stdout).toBe("");
      expect(stderr.trim()).toBe("");
      expect(snapshot).not.toBeNull();
      expect(snapshot!.phase).toBe("completed");
      expect(readFileSync(promptedBackupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
    } finally {
      restoreTimers();
    }
  });

  test("interactive new-wallet flows persist ERC20 funding requirements for follow-up", async () => {
    const promptedBackupPath = join(state.tempHome, "visible-wallet.txt");
    setPromptResponses({ input: promptedBackupPath, select: "file" });
    state.currentSignerPrivateKey = null;
    state.pool = {
      ...state.pool,
      asset: "0x8888888888888888888888888888888888888888",
      symbol: "USDC",
      decimals: 6,
    };
    state.tokenBalance = 100000000n;
    state.nativeBalance = 10n ** 18n;

    const restoreTimers = useImmediateTimers();
    try {
      const { stderr } = await captureAsyncOutput(async () => {
        const snapshot = await startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: false,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        });

        expect(snapshot.walletAddress).toBe(NEW_WALLET_ADDRESS);
        expect(snapshot.requiredTokenFunding).toBe("100000000");
        expect(BigInt(snapshot.requiredNativeFunding ?? "0")).toBeGreaterThan(0n);
      });

      expect(stderr).toContain("\n");
      expect(readFileSync(promptedBackupPath, "utf8")).toContain(NEW_WALLET_PRIVATE_KEY);
    } finally {
      restoreTimers();
    }
  });

  test("interactive new-wallet flows stop when backup confirmation is declined", async () => {
    setPromptResponses({ confirm: false });
    state.currentSignerPrivateKey = null;

    const { stdout, stderr } = await captureAsyncOutput(async () => {
      await expect(
        startWorkflow({
          amountInput: "100",
          assetInput: "USDC",
          recipient: "0x7777777777777777777777777777777777777777",
          newWallet: true,
          globalOpts: { chain: "sepolia" },
          mode: {
            isAgent: false,
            isJson: false,
            isCsv: false,
            isQuiet: true,
            format: "table",
            skipPrompts: false,
          },
          isVerbose: false,
          watch: false,
        }),
      ).rejects.toThrow("You must confirm that the workflow wallet is backed up.");
    });
    expect(stdout).toBe("");
    expect(stderr).toContain("Private key:");
    expect(stderr).toContain(NEW_WALLET_PRIVATE_KEY);
  });

  test("ragequitWorkflow rejects workflows that have not deposited publicly yet", async () => {
    writeWorkflowSnapshot("wf-no-deposit", {
      phase: "awaiting_funding",
      walletMode: "new_wallet",
      walletAddress: NEW_WALLET_ADDRESS,
      depositTxHash: null,
      depositBlockNumber: null,
      depositExplorerUrl: null,
      aspStatus: undefined,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-no-deposit",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("This workflow has not deposited publicly yet.");
  });

  test("ragequitWorkflow rejects workflows that are already terminal", async () => {
    writeWorkflowSnapshot("wf-terminal", {
      phase: "completed_public_recovery",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "declined",
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-terminal",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("This workflow is already terminal.");
  });

  test("ragequitWorkflow rejects workflows with an in-flight relayed withdrawal", async () => {
    writeWorkflowSnapshot("wf-inflight-withdrawal", {
      phase: "withdrawing",
      walletMode: "configured",
      walletAddress: GLOBAL_SIGNER_ADDRESS,
      depositBlockNumber: "101",
      aspStatus: "approved",
      withdrawTxHash: state.relayTxHash,
      withdrawBlockNumber: null,
    });

    await expect(
      ragequitWorkflow({
        workflowId: "wf-inflight-withdrawal",
        globalOpts: { chain: "sepolia" },
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
    ).rejects.toThrow("A relayed withdrawal is already in flight for this workflow.");
  });
});
