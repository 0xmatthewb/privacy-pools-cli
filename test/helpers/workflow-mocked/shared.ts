import { mock } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { createTrackedTempDir } from "../temp.ts";
import {
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "../../../src/services/workflow-storage-version.ts";

export const realConfig = await import("../../../src/services/config.ts");
export const realWritePrivateFileAtomic = realConfig.writePrivateFileAtomic;
export const realAccount = await import("../../../src/services/account.ts");
export const realAsp = await import("../../../src/services/asp.ts");
export const realChains = await import("../../../src/config/chains.ts");
export const realContracts = await import("../../../src/services/contracts.ts");
export const realErrors = await import("../../../src/utils/errors.ts");
export const realFormat = await import("../../../src/utils/format.ts");
export const realInquirerPrompts = await import("@inquirer/prompts");
export const realPoolAccounts = await import("../../../src/utils/pool-accounts.ts");
export const realPools = await import("../../../src/services/pools.ts");
export const realPreflight = await import("../../../src/utils/preflight.ts");
export const realProofs = await import("../../../src/services/proofs.ts");
export const realRelayer = await import("../../../src/services/relayer.ts");
export const realSdk = await import("../../../src/services/sdk.ts");
export const realWallet = await import("../../../src/services/wallet.ts");
export const realWithdraw = await import("../../../src/commands/withdraw.ts");
export const realViemAccounts = await import("viem/accounts");

export const GLOBAL_SIGNER_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
export const MISMATCH_SIGNER_PRIVATE_KEY =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
export const NEW_WALLET_PRIVATE_KEY =
  "0x3333333333333333333333333333333333333333333333333333333333333333" as const;
export const GLOBAL_SIGNER_ADDRESS =
  realViemAccounts.privateKeyToAccount(GLOBAL_SIGNER_PRIVATE_KEY).address;
export const MISMATCH_SIGNER_ADDRESS =
  realViemAccounts.privateKeyToAccount(MISMATCH_SIGNER_PRIVATE_KEY).address;
export const NEW_WALLET_ADDRESS =
  realViemAccounts.privateKeyToAccount(NEW_WALLET_PRIVATE_KEY).address;

const depositEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

export interface MockState {
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

export const state: MockState = {} as MockState;
export type PromptBackupChoice = "copied" | "file";

export const confirmPromptMock = mock(async () => true);
export const inputPromptMock = mock(async () =>
  state.tempHome
    ? join(state.tempHome, "unused-wallet.txt")
    : "unused-wallet.txt",
);
export const selectPromptMock = mock(async () => "copied" as PromptBackupChoice);
export const proveCommitmentMock = mock(async () => ({
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
export const proveWithdrawalMock = mock(async () => ({
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
export const writePrivateFileAtomicMock = mock(
  (filePath: string, content: string) =>
    realWritePrivateFileAtomic(filePath, content),
);

function makeTempHome(): string {
  return createTrackedTempDir("pp-workflow-mocked-");
}

export function setPromptResponses({
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

export function useImmediateTimers(): () => void {
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

export function depositReceipt(depositor: Address) {
  return {
    status: "success" as const,
    blockNumber: 101n,
    logs: [makeDepositLog(depositor)],
  };
}

export function resetState(): void {
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

export function nextBalance(sequence: bigint[] | null, fallback: bigint): bigint {
  if (!sequence || sequence.length === 0) return fallback;
  if (sequence.length === 1) return sequence[0];
  return sequence.shift()!;
}

export function nextAspStatus(): MockState["aspStatus"] {
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

export function selectedPoolAccount() {
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

export function isPoolAccountCurrentlyAvailable(): boolean {
  if (state.poolAccountAvailableAfterReceiptChecks === null) {
    return state.poolAccountAvailable;
  }
  return state.getTransactionReceiptCalls > state.poolAccountAvailableAfterReceiptChecks;
}

export function writeWorkflowSnapshot(
  workflowId: string,
  patch: Record<string, unknown>,
) {
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
  writeFileSync(
    join(workflowsDir, `${workflowId}.json`),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
}

export function writeWorkflowSecret(workflowId: string): void {
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
