import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  mock,
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
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from "viem";
import {
  captureAsyncOutput,
  expectSilentOutput,
} from "../helpers/output.ts";
import { encodeRelayerWithdrawalData } from "../helpers/relayer-withdrawal-data.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../src/services/workflow-storage-version.ts";

const realConfig = await import("../../src/services/config.ts");
const realWritePrivateFileAtomic = realConfig.writePrivateFileAtomic;
const realAccount = await import("../../src/services/account.ts");
const realAsp = await import("../../src/services/asp.ts");
const realChains = await import("../../src/config/chains.ts");
const realContracts = await import("../../src/services/contracts.ts");
const realErrors = await import("../../src/utils/errors.ts");
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
  relayerUrl: string;
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
  requestQuoteCalls: Array<{
    amount: bigint;
    asset: Address;
    extraGas: boolean;
    recipient: Address;
    relayerUrl?: string;
  }>;
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
const proveCommitmentMock = mock(async () => ({
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
const proveWithdrawalMock = mock(async () => ({
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
const writePrivateFileAtomicMock = mock(
  (filePath: string, content: string) =>
    realWritePrivateFileAtomic(filePath, content),
);

function makeTempHome(): string {
  return createTrackedTempDir("pp-workflow-mocked-");
}

function setPromptResponses({
  confirm = true,
  input = join(state.tempHome, "unused-wallet.txt"),
  select = "copied",
}: {
  confirm?: boolean | boolean[];
  input?: string;
  select?: PromptBackupChoice;
} = {}): void {
  confirmPromptMock.mockClear();
  const confirmQueue = Array.isArray(confirm) ? [...confirm] : [confirm];
  const finalConfirm = confirmQueue[confirmQueue.length - 1] ?? true;
  confirmPromptMock.mockImplementation(async () => confirmQueue.shift() ?? finalConfirm);
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
  state.relayerUrl = "https://fastrelay.xyz";
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
  relayerUrl: state.relayerUrl,
}));

function buildMockRelayerQuote(
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

const requestQuoteMock = mock(async (
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
const submitRelayRequestMock = mock(async () => ({
  txHash: state.relayTxHash,
}));
const getRelayedWithdrawalRemainderAdvisoryMock = mock(() => null);
const refreshExpiredRelayerQuoteForWithdrawalMock = mock(async () => ({
  quote: buildMockRelayerQuote({
    amount: state.committedValue,
    asset: state.pool.asset,
    extraGas: state.pool.symbol !== "ETH",
    recipient: "0x7777777777777777777777777777777777777777",
  }),
  quoteFeeBPS: 50n,
  expirationMs: Date.now() + 60_000,
}));
const validateRelayerQuoteForWithdrawalMock = mock((quote?: {
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
let overrideWorkflowTimingForTests: WorkflowModuleType["overrideWorkflowTimingForTests"];
let ragequitWorkflow: WorkflowModuleType["ragequitWorkflow"];
let startWorkflow: WorkflowModuleType["startWorkflow"];
let watchWorkflow: WorkflowModuleType["watchWorkflow"];

function failWorkflowSnapshotWriteOnCall(
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

async function installWorkflowMocks(): Promise<void> {
  mock.module("../../src/services/config.ts", () => ({
    ...realConfig,
    loadConfig: () => ({
      defaultChain: "sepolia",
    }),
    writePrivateFileAtomic: writePrivateFileAtomicMock,
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
    proveCommitment: proveCommitmentMock,
    proveWithdrawal: proveWithdrawalMock,
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

  const workflowModule = await import("../../src/services/workflow.ts?workflow-mocked");
  ({
    getWorkflowStatus,
    loadWorkflowSnapshot,
    overrideWorkflowTimingForTests,
    ragequitWorkflow,
    startWorkflow,
    watchWorkflow,
  } = workflowModule);

  // Restore real formatting for later imports in this Bun process.
  mock.module("../../src/utils/format.ts", () => realFormat);
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

export function registerWorkflowMockedHarness(): void {
  beforeAll(async () => {
    await installWorkflowMocks();
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
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
  });

  afterEach(() => {
    delete process.env.PRIVACY_POOLS_HOME;
    rmSync(state.tempHome, { recursive: true, force: true });
  });
}

export {
  GLOBAL_SIGNER_ADDRESS,
  GLOBAL_SIGNER_PRIVATE_KEY,
  MISMATCH_SIGNER_ADDRESS,
  MISMATCH_SIGNER_PRIVATE_KEY,
  NEW_WALLET_ADDRESS,
  NEW_WALLET_PRIVATE_KEY,
  buildMockRelayerQuote,
  depositEthMock,
  failWorkflowSnapshotWriteOnCall,
  getWorkflowStatus,
  initializeAccountServiceMock,
  loadWorkflowSnapshot,
  overrideWorkflowTimingForTests,
  proveWithdrawalMock,
  publicClient,
  ragequitWorkflow,
  realConfig,
  realErrors,
  realWritePrivateFileAtomic,
  refreshExpiredRelayerQuoteForWithdrawalMock,
  requestQuoteMock,
  saveAccountMock,
  setPromptResponses,
  startWorkflow,
  state,
  submitRelayRequestMock,
  useImmediateTimers,
  validateRelayerQuoteForWithdrawalMock,
  watchWorkflow,
  writePrivateFileAtomicMock,
  writeWorkflowSecret,
  writeWorkflowSnapshot,
};
