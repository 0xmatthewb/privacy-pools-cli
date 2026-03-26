import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  calculateContext,
  generateMerkleProof,
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import type { Address, Hex } from "viem";
import { decodeEventLog, encodeAbiParameters, erc20Abi, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTxUrl, NATIVE_ASSET_ADDRESS } from "../config/chains.js";
import {
  initializeAccountService,
  saveAccount,
  saveSyncMeta,
  withSuppressedSdkStdoutSync,
} from "./account.js";
import {
  buildLoadedAspDepositReviewState,
  fetchDepositReviewStatuses,
  fetchMerkleLeaves,
  fetchMerkleRoots,
} from "./asp.js";
import {
  approveERC20,
  depositERC20,
  depositETH,
  ragequit as submitRagequit,
} from "./contracts.js";
import {
  ensureConfigDir,
  getWorkflowSecretsDir,
  getWorkflowsDir,
  loadConfig,
} from "./config.js";
import { resolvePool } from "./pools.js";
import { proveCommitment, proveWithdrawal } from "./proofs.js";
import {
  getRelayerDetails,
  requestQuote,
  submitRelayRequest,
} from "./relayer.js";
import { getDataService, getPublicClient } from "./sdk.js";
import { loadMnemonic, loadPrivateKey } from "./wallet.js";
import {
  formatAmountDecimal,
  isRoundAmount,
  suggestRoundAmounts,
} from "../utils/amount-privacy.js";
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../utils/critical-section.js";
import { classifyError, CLIError } from "../utils/errors.js";
import {
  deriveTokenPrice,
  formatAddress,
  formatAmount,
  formatBPS,
  info,
  spinner,
  stageHeader,
  usdSuffix,
  verbose,
  warn,
} from "../utils/format.js";
import { JSON_SCHEMA_VERSION } from "../utils/json.js";
import { acquireProcessLock } from "../utils/lock.js";
import { getConfirmationTimeoutMs, type ResolvedGlobalMode } from "../utils/mode.js";
import {
  buildAllPoolAccountRefs,
  buildPoolAccountRefs,
  collectActiveLabels,
  getNextPoolAccountNumber,
  poolAccountId,
  type AspApprovalStatus,
  type PoolAccountRef,
} from "../utils/pool-accounts.js";
import {
  checkErc20Balance,
  checkHasGas,
  checkNativeBalance,
} from "../utils/preflight.js";
import { validateAddress, parseAmount, resolveChain, validatePositive } from "../utils/validation.js";
import { withProofProgress } from "../utils/proof-progress.js";
import {
  getRelayedWithdrawalRemainderAdvisory,
  refreshExpiredRelayerQuoteForWithdrawal,
  validateRelayerQuoteForWithdrawal,
} from "../commands/withdraw.js";
import { toSolidityProof } from "../utils/unsigned.js";
import type { GlobalOptions } from "../types.js";

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

const entrypointLatestRootAbi = [
  {
    name: "latestRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolCurrentRootAbi = [
  {
    name: "currentRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolDepositorAbi = [
  {
    name: "depositors",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_label", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

type WorkflowPool = Awaited<ReturnType<typeof resolvePool>>;

const FLOW_POLL_INITIAL_MS = 60_000;
const FLOW_POLL_MAX_MS = 300_000;
const FLOW_FUNDING_POLL_INITIAL_MS = 10_000;
const FLOW_FUNDING_POLL_MAX_MS = 60_000;
const FLOW_GAS_PRICE_BUFFER_NUMERATOR = 6n;
const FLOW_GAS_PRICE_BUFFER_DENOMINATOR = 5n;
const FLOW_GAS_RESERVE_MULTIPLIER = 2n;
const FLOW_GAS_NATIVE_DEPOSIT = 250_000n;
const FLOW_GAS_ERC20_APPROVAL = 100_000n;
const FLOW_GAS_ERC20_DEPOSIT = 275_000n;
const FLOW_GAS_RAGEQUIT = 325_000n;
const WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_CODE = "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED";

export type FlowPhase =
  | "awaiting_funding"
  | "depositing_publicly"
  | "awaiting_asp"
  | "approved_ready_to_withdraw"
  | "withdrawing"
  | "completed"
  | "completed_public_recovery"
  | "paused_poi_required"
  | "paused_declined"
  | "stopped_external";

export type FlowWalletMode = "configured" | "new_wallet";

export class FlowCancelledError extends Error {
  constructor() {
    super("Flow cancelled.");
    this.name = "FlowCancelledError";
  }
}

export interface FlowLastError {
  step: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  at: string;
}

export interface FlowSnapshot {
  schemaVersion: string;
  workflowId: string;
  createdAt: string;
  updatedAt: string;
  phase: FlowPhase;
  walletMode?: FlowWalletMode;
  walletAddress?: string | null;
  assetDecimals?: number | null;
  requiredNativeFunding?: string | null;
  requiredTokenFunding?: string | null;
  backupConfirmed?: boolean;
  chain: string;
  asset: string;
  depositAmount: string;
  recipient: string;
  poolAccountId?: string | null;
  poolAccountNumber?: number | null;
  depositTxHash?: string | null;
  depositBlockNumber?: string | null;
  depositExplorerUrl?: string | null;
  depositLabel?: string | null;
  committedValue?: string | null;
  aspStatus?: AspApprovalStatus;
  withdrawTxHash?: string | null;
  withdrawBlockNumber?: string | null;
  withdrawExplorerUrl?: string | null;
  ragequitTxHash?: string | null;
  ragequitBlockNumber?: string | null;
  ragequitExplorerUrl?: string | null;
  lastError?: FlowLastError;
}

interface StartFlowParams {
  amountInput: string;
  assetInput: string;
  recipient: string;
  newWallet?: boolean;
  exportNewWallet?: string;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
  watch: boolean;
}

interface WatchFlowParams {
  workflowId?: string;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}

interface StatusFlowParams {
  workflowId?: string;
}

interface RagequitFlowParams {
  workflowId?: string;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}

interface DepositExecutionResult {
  chain: string;
  asset: string;
  amount: bigint;
  decimals: number;
  poolAccountNumber: number;
  poolAccountId: string;
  depositTxHash: string;
  depositBlockNumber: bigint;
  depositExplorerUrl: string | null;
  depositLabel: bigint;
  committedValue: bigint;
}

interface ApprovalInspectionResult {
  snapshot: FlowSnapshot;
  continueWatching: boolean;
}

interface FundingInspectionResult {
  snapshot: FlowSnapshot;
  continueWatching: boolean;
}

interface WorkflowPoolAccountContext {
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  accountService: Awaited<ReturnType<typeof initializeAccountService>>;
  publicClient: ReturnType<typeof getPublicClient>;
  selectedPoolAccount: PoolAccountRef;
  spendableCommitments: readonly unknown[];
  aspRoot: SDKHash;
  aspLabels: bigint[];
  allCommitmentHashes: bigint[];
  rootsOnchainMtRoot: bigint;
}

interface FlowSecretRecord {
  schemaVersion: string;
  workflowId: string;
  chain: string;
  walletAddress: Address;
  privateKey: Hex;
  createdAt: string;
  backupConfirmedAt?: string;
  exportedBackupPath?: string | null;
}

interface FlowFundingRequirements {
  requiredNativeFunding: bigint;
  requiredTokenFunding: bigint | null;
}

interface NewWalletWorkflowSetupResult {
  snapshot: FlowSnapshot;
  secretRecord: FlowSecretRecord;
}

interface PendingDepositSnapshotData {
  depositTxHash: string;
  depositExplorerUrl: string | null;
}

function pickWorkflowPoolAccount(
  snapshot: FlowSnapshot,
  poolAccounts: readonly PoolAccountRef[],
): PoolAccountRef | undefined {
  if (snapshot.depositLabel) {
    const byLabel = poolAccounts.find(
      (poolAccount) => poolAccount.label.toString() === snapshot.depositLabel,
    );
    if (byLabel) return byLabel;
  }

  const normalizedDepositTxHash = snapshot.depositTxHash?.toLowerCase() ?? null;
  if (normalizedDepositTxHash) {
    const byTxHash = poolAccounts.find(
      (poolAccount) => poolAccount.txHash.toLowerCase() === normalizedDepositTxHash,
    );
    if (byTxHash) return byTxHash;
  }

  return poolAccounts.find(
    (poolAccount) => poolAccount.paNumber === snapshot.poolAccountNumber,
  );
}

function alignSnapshotToPoolAccount(
  snapshot: FlowSnapshot,
  chainId: number,
  poolAccount: PoolAccountRef,
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        poolAccountNumber: poolAccount.paNumber,
        poolAccountId: poolAccount.paId,
        depositTxHash: poolAccount.txHash,
        depositBlockNumber: poolAccount.blockNumber.toString(),
        depositExplorerUrl: explorerTxUrl(chainId, poolAccount.txHash),
        depositLabel: poolAccount.label.toString(),
        committedValue: poolAccount.value.toString(),
      }),
    ),
  );
}

function getWorkflowFilePath(workflowId: string): string {
  return join(getWorkflowsDir(), `${workflowId}.json`);
}

function getWorkflowSecretFilePath(workflowId: string): string {
  return join(getWorkflowSecretsDir(), `${workflowId}.json`);
}

function ensureWorkflowDir(): void {
  ensureConfigDir();
}

function writePrivateJsonFile(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  renameSync(tmpPath, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
}

function writePrivateTextFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmpPath, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
}

function persistWorkflowSnapshot(snapshot: FlowSnapshot): void {
  ensureWorkflowDir();
  writePrivateJsonFile(getWorkflowFilePath(snapshot.workflowId), snapshot);
}

function saveWorkflowSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  guardCriticalSection();
  try {
    persistWorkflowSnapshot(snapshot);
  } finally {
    releaseCriticalSection();
  }
  return snapshot;
}

function saveWorkflowSecretRecord(record: FlowSecretRecord): FlowSecretRecord {
  guardCriticalSection();
  try {
    ensureWorkflowDir();
    writePrivateJsonFile(getWorkflowSecretFilePath(record.workflowId), record);
  } finally {
    releaseCriticalSection();
  }
  return record;
}

function deleteWorkflowSecretRecord(workflowId: string): void {
  const filePath = getWorkflowSecretFilePath(workflowId);
  if (!existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort cleanup only.
  }
}

function loadWorkflowSecretRecord(workflowId: string): FlowSecretRecord {
  const filePath = getWorkflowSecretFilePath(workflowId);
  if (!existsSync(filePath)) {
    throw new CLIError(
      `Workflow wallet secret is missing for ${workflowId}.`,
      "INPUT",
      "Restore the workflow wallet backup you exported earlier, or continue manually with the wallet private key if you still have it.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    throw new CLIError(
      `Workflow wallet secret is unreadable: ${filePath}`,
      "INPUT",
      "Restore the workflow wallet backup or remove the broken secret file and start a new workflow.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as FlowSecretRecord).workflowId !== "string" ||
    typeof (parsed as FlowSecretRecord).walletAddress !== "string" ||
    typeof (parsed as FlowSecretRecord).privateKey !== "string"
  ) {
    throw new CLIError(
      `Workflow wallet secret has invalid structure: ${filePath}`,
      "INPUT",
      "Restore the workflow wallet backup or remove the broken secret file and start a new workflow.",
    );
  }

  return parsed as FlowSecretRecord;
}

function buildWorkflowWalletBackup(record: FlowSecretRecord): string {
  return [
    "Privacy Pools Flow Wallet",
    "",
    `Workflow ID: ${record.workflowId}`,
    `Chain: ${record.chain}`,
    `Wallet Address: ${record.walletAddress}`,
    `Private Key: ${record.privateKey}`,
    "",
    "IMPORTANT: Anyone with this private key can move funds from this workflow wallet.",
    "Keep this file secure and delete it after moving it to a safe location.",
  ].join("\n");
}

function defaultWorkflowWalletBackupPath(workflowId: string): string {
  return join(homedir(), `privacy-pools-flow-wallet-${workflowId}.txt`);
}

function isNewWalletFlow(snapshot: FlowSnapshot): boolean {
  return (snapshot.walletMode ?? "configured") === "new_wallet";
}

function normalizeWorkflowSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return {
    ...snapshot,
    walletMode: snapshot.walletMode ?? "configured",
    walletAddress: snapshot.walletAddress ?? null,
    assetDecimals: snapshot.assetDecimals ?? null,
    requiredNativeFunding: snapshot.requiredNativeFunding ?? null,
    requiredTokenFunding: snapshot.requiredTokenFunding ?? null,
    backupConfirmed: snapshot.backupConfirmed ?? false,
    poolAccountId: snapshot.poolAccountId ?? null,
    poolAccountNumber: snapshot.poolAccountNumber ?? null,
    depositTxHash: snapshot.depositTxHash ?? null,
    depositBlockNumber: snapshot.depositBlockNumber ?? null,
    depositExplorerUrl: snapshot.depositExplorerUrl ?? null,
    depositLabel: snapshot.depositLabel ?? null,
    committedValue: snapshot.committedValue ?? null,
    withdrawTxHash: snapshot.withdrawTxHash ?? null,
    withdrawBlockNumber: snapshot.withdrawBlockNumber ?? null,
    withdrawExplorerUrl: snapshot.withdrawExplorerUrl ?? null,
    ragequitTxHash: snapshot.ragequitTxHash ?? null,
    ragequitBlockNumber: snapshot.ragequitBlockNumber ?? null,
    ragequitExplorerUrl: snapshot.ragequitExplorerUrl ?? null,
  };
}

function comparableWorkflowSnapshot(snapshot: FlowSnapshot): Record<string, unknown> {
  const { updatedAt: _updatedAt, ...rest } = normalizeWorkflowSnapshot(snapshot);
  return rest;
}

function sameWorkflowSnapshotState(
  left: FlowSnapshot,
  right: FlowSnapshot,
): boolean {
  return (
    JSON.stringify(comparableWorkflowSnapshot(left)) ===
    JSON.stringify(comparableWorkflowSnapshot(right))
  );
}

function saveWorkflowSnapshotIfChanged(
  previous: FlowSnapshot,
  next: FlowSnapshot,
): FlowSnapshot {
  const normalizedNext = normalizeWorkflowSnapshot(next);
  if (sameWorkflowSnapshotState(previous, normalizedNext)) {
    return previous;
  }
  return saveWorkflowSnapshot(normalizedNext);
}

async function saveWorkflowSnapshotIfChangedWithLock(
  previous: FlowSnapshot,
  next: FlowSnapshot,
): Promise<FlowSnapshot> {
  const normalizedNext = normalizeWorkflowSnapshot(next);
  if (sameWorkflowSnapshotState(previous, normalizedNext)) {
    return previous;
  }
  return withProcessLock(async () => saveWorkflowSnapshot(normalizedNext));
}

function cleanupTerminalWorkflowSecret(snapshot: FlowSnapshot): void {
  if (
    isNewWalletFlow(snapshot) &&
    (snapshot.phase === "completed" ||
      snapshot.phase === "completed_public_recovery")
  ) {
    deleteWorkflowSecretRecord(snapshot.workflowId);
  }
}

async function withProcessLock<T>(fn: () => Promise<T>): Promise<T> {
  const releaseLock = acquireProcessLock();
  try {
    return await fn();
  } finally {
    releaseLock();
  }
}

function isTerminalFlowPhase(phase: FlowPhase): boolean {
  return (
    phase === "completed" ||
    phase === "completed_public_recovery" ||
    phase === "stopped_external"
  );
}

function parseWorkflowSnapshot(raw: string, filePath: string): FlowSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CLIError(
      `Workflow file is corrupt or unreadable: ${filePath}`,
      "INPUT",
      "Remove the broken workflow file or resolve the JSON manually, then retry.",
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new CLIError(
      `Workflow file has invalid structure: ${filePath}`,
      "INPUT",
      "Remove the broken workflow file or resolve the JSON manually, then retry.",
    );
  }

  const snapshot = parsed as FlowSnapshot;
  if (
    typeof snapshot.workflowId !== "string" ||
    typeof snapshot.phase !== "string" ||
    typeof snapshot.chain !== "string" ||
    typeof snapshot.asset !== "string"
  ) {
    throw new CLIError(
      `Workflow file has invalid structure: ${filePath}`,
      "INPUT",
      "Remove the broken workflow file or resolve the JSON manually, then retry.",
    );
  }

  return normalizeWorkflowSnapshot(snapshot);
}

export function loadWorkflowSnapshot(workflowId: string): FlowSnapshot {
  const filePath = getWorkflowFilePath(workflowId);
  if (!existsSync(filePath)) {
    throw new CLIError(
      `Unknown workflow: ${workflowId}`,
      "INPUT",
      "Run 'privacy-pools flow status latest' to inspect the most recent workflow, or start a new one with 'privacy-pools flow start <amount> <asset> --to <address>'.",
    );
  }

  return parseWorkflowSnapshot(readFileSync(filePath, "utf-8"), filePath);
}

function listWorkflowSnapshots(): {
  snapshots: FlowSnapshot[];
  invalidFiles: string[];
} {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) {
    return {
      snapshots: [],
      invalidFiles: [],
    };
  }

  const snapshots: FlowSnapshot[] = [];
  const invalidFiles: string[] = [];
  for (const entry of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const filePath = join(dir, entry);
    try {
      snapshots.push(parseWorkflowSnapshot(readFileSync(filePath, "utf-8"), filePath));
    } catch {
      invalidFiles.push(filePath);
    }
  }

  return {
    snapshots,
    invalidFiles,
  };
}

export function resolveLatestWorkflowId(): string {
  const { snapshots, invalidFiles } = listWorkflowSnapshots();
  const latest = snapshots
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt);
      const rightTime = Date.parse(right.updatedAt || right.createdAt);
      return rightTime - leftTime;
    })[0];

  if (!latest) {
    if (invalidFiles.length > 0) {
      throw new CLIError(
        "No readable saved workflows found.",
        "INPUT",
        "Remove or fix corrupt workflow files, or start a new workflow with 'privacy-pools flow start <amount> <asset> --to <address>'.",
      );
    }
    throw new CLIError(
      "No saved workflows found.",
      "INPUT",
      "Start one with 'privacy-pools flow start <amount> <asset> --to <address>'.",
    );
  }

  return latest.workflowId;
}

function resolveWorkflowId(input: string | undefined): string {
  if (!input || input === "latest") {
    return resolveLatestWorkflowId();
  }
  return input;
}

function workflowNow(): string {
  return new Date().toISOString();
}

function updateSnapshot(
  snapshot: FlowSnapshot,
  patch: Partial<FlowSnapshot>,
): FlowSnapshot {
  return {
    ...snapshot,
    ...patch,
    updatedAt: workflowNow(),
  };
}

function clearLastError(snapshot: FlowSnapshot): FlowSnapshot {
  if (!snapshot.lastError) return snapshot;
  const { lastError: _lastError, ...rest } = snapshot;
  return {
    ...rest,
    updatedAt: workflowNow(),
  };
}

function nextPollDelayMs(
  currentDelayMs: number,
  phase: FlowPhase,
): number {
  const maxDelay =
    phase === "awaiting_funding" || phase === "depositing_publicly"
      ? FLOW_FUNDING_POLL_MAX_MS
      : FLOW_POLL_MAX_MS;
  return Math.min(currentDelayMs * 2, maxDelay);
}

function initialPollDelayMs(phase: FlowPhase): number {
  return phase === "awaiting_funding" || phase === "depositing_publicly"
    ? FLOW_FUNDING_POLL_INITIAL_MS
    : FLOW_POLL_INITIAL_MS;
}

function humanPollDelayLabel(ms: number): string {
  if (ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${Math.round(ms / 1000)} seconds`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFlowMutation(current: FlowSnapshot, poolAccount: PoolAccountRef | undefined): FlowPhase | null {
  if (!poolAccount) {
    return current.phase === "withdrawing" ? "stopped_external" : "stopped_external";
  }

  if (poolAccount.status === "spent" || poolAccount.status === "exited") {
    return current.phase === "withdrawing" ? "stopped_external" : "stopped_external";
  }

  if (current.committedValue && poolAccount.value.toString() !== current.committedValue) {
    return current.phase === "withdrawing" ? "stopped_external" : "stopped_external";
  }

  if (current.depositLabel && poolAccount.label.toString() !== current.depositLabel) {
    return current.phase === "withdrawing" ? "stopped_external" : "stopped_external";
  }

  return null;
}

function saveMutatedWorkflowSnapshot(
  snapshot: FlowSnapshot,
  poolAccount: PoolAccountRef,
): FlowSnapshot | null {
  const mutationPhase = classifyFlowMutation(snapshot, poolAccount);
  if (!mutationPhase) {
    return null;
  }

  const stopped = clearLastError(
    updateSnapshot(snapshot, {
      phase: mutationPhase,
      aspStatus: poolAccount.aspStatus,
    }),
  );
  return saveWorkflowSnapshotIfChanged(snapshot, stopped);
}

function buildFlowLastError(step: string, error: unknown): FlowLastError {
  const classified = classifyError(error);
  return {
    step,
    errorCode: classified.code,
    errorMessage: classified.message,
    retryable: classified.retryable,
    at: workflowNow(),
  };
}

function validateFlowRecipient(value: string): Address {
  return validateAddress(value, "Recipient") as Address;
}

function getFlowSignerPrivateKey(snapshot: FlowSnapshot): Hex {
  if (isNewWalletFlow(snapshot)) {
    return loadWorkflowSecretRecord(snapshot.workflowId).privateKey;
  }
  return loadPrivateKey();
}

function getFlowSignerAddress(snapshot: FlowSnapshot): Address {
  return privateKeyToAccount(getFlowSignerPrivateKey(snapshot)).address;
}

async function getFlowFundingRequirements(params: {
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  amount: bigint;
  globalOpts?: GlobalOptions;
}): Promise<FlowFundingRequirements> {
  const publicClient = getPublicClient(params.chainConfig, params.globalOpts?.rpcUrl);
  let gasPrice: bigint;
  try {
    gasPrice = await publicClient.getGasPrice();
  } catch {
    throw new CLIError(
      "Could not estimate the workflow wallet gas reserve.",
      "RPC",
      "Retry with a healthy RPC connection before funding the new wallet.",
    );
  }

  const bufferedGasPrice =
    (gasPrice * FLOW_GAS_PRICE_BUFFER_NUMERATOR) / FLOW_GAS_PRICE_BUFFER_DENOMINATOR;
  const gasUnits =
    params.pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
      ? FLOW_GAS_NATIVE_DEPOSIT + FLOW_GAS_RAGEQUIT
      : FLOW_GAS_ERC20_APPROVAL + FLOW_GAS_ERC20_DEPOSIT + FLOW_GAS_RAGEQUIT;
  const reserve = gasUnits * bufferedGasPrice * FLOW_GAS_RESERVE_MULTIPLIER;

  return {
    requiredNativeFunding:
      params.pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
        ? params.amount + reserve
        : reserve,
    requiredTokenFunding:
      params.pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
        ? null
        : params.amount,
  };
}

async function getNextFlowPoolAccountRef(params: {
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  globalOpts?: GlobalOptions;
  silent: boolean;
}): Promise<{ poolAccountNumber: number; poolAccountId: string }> {
  const mnemonic = loadMnemonic();
  const dataService = await getDataService(
    params.chainConfig,
    params.pool.pool,
    params.globalOpts?.rpcUrl,
  );
  const accountService = await initializeAccountService(
    dataService,
    mnemonic,
    [
      {
        chainId: params.chainConfig.id,
        address: params.pool.pool,
        scope: params.pool.scope,
        deploymentBlock:
          params.pool.deploymentBlock ?? params.chainConfig.startBlock,
      },
    ],
    params.chainConfig.id,
    true,
    params.silent,
    true,
  );
  const poolAccountNumber = getNextPoolAccountNumber(
    accountService.account,
    params.pool.scope,
  );
  return {
    poolAccountNumber,
    poolAccountId: poolAccountId(poolAccountNumber),
  };
}

async function executeDepositForFlow(params: {
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  amount: bigint;
  privateKeyOverride?: Hex;
  onDepositSubmitted?: (pending: PendingDepositSnapshotData) => Promise<void> | void;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<DepositExecutionResult> {
  const {
    chainConfig,
    pool,
    amount,
    privateKeyOverride,
    onDepositSubmitted,
    globalOpts,
    mode,
    isVerbose,
  } = params;
  const silent = mode.isQuiet || mode.isJson;
  const isNative =
    pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase();

  return withProcessLock(async () => {
    const mnemonic = loadMnemonic();
    const dataService = await getDataService(
      chainConfig,
      pool.pool,
      globalOpts?.rpcUrl,
    );
    const accountService = await initializeAccountService(
      dataService,
      mnemonic,
      [
        {
          chainId: chainConfig.id,
          address: pool.pool,
          scope: pool.scope,
          deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
        },
      ],
      chainConfig.id,
      true,
      silent,
      true,
    );
    const nextPANumber = getNextPoolAccountNumber(
      accountService.account,
      pool.scope,
    );
    const nextPAId = poolAccountId(nextPANumber);

    const secrets = withSuppressedSdkStdoutSync(() =>
      accountService.createDepositSecrets(pool.scope as unknown as SDKHash),
    );
    const precommitment = secrets.precommitment;

    verbose(
      `Generated precommitment (truncated): ${precommitment.toString().slice(0, 8)}...`,
      isVerbose,
      silent,
    );

    const privateKey = privateKeyOverride ?? loadPrivateKey();
    const signerAddr = privateKeyToAccount(privateKey).address;
    const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

    if (isNative) {
      await checkNativeBalance(publicClient, signerAddr, amount, pool.symbol);
    } else {
      await checkErc20Balance(
        publicClient,
        pool.asset,
        signerAddr,
        amount,
        pool.decimals,
        pool.symbol,
      );
      await checkHasGas(publicClient, signerAddr);
    }

    const depositSteps = isNative ? 1 : 2;
    if (!isNative) {
      stageHeader(1, depositSteps, "Approving token spend", silent);
      const approvalSpin = spinner("Approving token spend...", silent);
      approvalSpin.start();
      try {
        const approveTx = await approveERC20(
          chainConfig,
          pool.asset,
          chainConfig.entrypoint,
          amount,
          globalOpts?.rpcUrl,
          privateKey,
        );
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveTx.hash as `0x${string}`,
          timeout: getConfirmationTimeoutMs(),
        }).catch(() => {
          throw new CLIError(
            "Timed out waiting for approval confirmation.",
            "RPC",
            `Tx ${approveTx.hash} may still confirm. Retry the flow start command to check allowance before depositing again.`,
          );
        });
        if (approvalReceipt.status !== "success") {
          throw new CLIError(
            `Approval transaction reverted: ${approveTx.hash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }
        approvalSpin.succeed("Token approved.");
      } catch (error) {
        approvalSpin.fail("Approval failed.");
        throw error;
      }
    }

    if (!isNative) {
      stageHeader(2, depositSteps, "Submitting deposit", silent);
    }
    const depositSpin = spinner("Submitting deposit transaction...", silent);
    depositSpin.start();

    const tx = isNative
      ? await depositETH(
          chainConfig,
          amount,
          precommitment as unknown as bigint,
          globalOpts?.rpcUrl,
          privateKey,
        )
      : await depositERC20(
          chainConfig,
          pool.asset,
          amount,
          precommitment as unknown as bigint,
          globalOpts?.rpcUrl,
          privateKey,
        );

    await onDepositSubmitted?.({
      depositTxHash: tx.hash,
      depositExplorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
    });

    depositSpin.text = "Waiting for confirmation...";
    const receipt = await getPublicClient(chainConfig, globalOpts?.rpcUrl)
      .waitForTransactionReceipt({
        hash: tx.hash as `0x${string}`,
        timeout: getConfirmationTimeoutMs(),
      })
      .catch(() => {
        throw new CLIError(
          "Timed out waiting for deposit confirmation.",
          "RPC",
          `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to pick up the transaction before retrying.`,
        );
      });

    if (receipt.status !== "success") {
      throw new CLIError(
        `Deposit transaction reverted: ${tx.hash}`,
        "CONTRACT",
        "Check the transaction on a block explorer for details.",
      );
    }

    let label: bigint | undefined;
    let committedValue: bigint | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== pool.pool.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: depositedEventAbi,
          data: log.data,
          topics: log.topics,
        });
        label = decoded.args._label;
        committedValue = decoded.args._value;
        break;
      } catch {
        // Ignore unrelated logs.
      }
    }

    if (label === undefined || committedValue === undefined) {
      throw new CLIError(
        "Deposit confirmed, but the workflow could not capture the new Pool Account metadata.",
        "CONTRACT",
        `Run 'privacy-pools sync --chain ${chainConfig.name} --asset ${pool.symbol}' to recover the deposit, then continue with the manual commands for this Pool Account.`,
      );
    }

    guardCriticalSection();
    try {
      try {
        withSuppressedSdkStdoutSync(() =>
          accountService.addPoolAccount(
            pool.scope as unknown as SDKHash,
            committedValue!,
            secrets.nullifier,
            secrets.secret,
            label as unknown as SDKHash,
            receipt.blockNumber,
            tx.hash as Hex,
          ),
        );
        saveAccount(chainConfig.id, accountService.account);
        saveSyncMeta(chainConfig.id);
      } catch (saveError) {
        warn(
          `Deposit confirmed onchain but failed to update local account state immediately: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
          silent,
        );
        warn(
          `Run 'privacy-pools sync --chain ${chainConfig.name} --asset ${pool.symbol}' before resuming this workflow.`,
          silent,
        );
      }
    } finally {
      releaseCriticalSection();
    }

    depositSpin.succeed("Deposit confirmed.");

    return {
      chain: chainConfig.name,
      asset: pool.symbol,
      amount,
      decimals: pool.decimals,
      poolAccountNumber: nextPANumber,
      poolAccountId: nextPAId,
      depositTxHash: tx.hash,
      depositBlockNumber: receipt.blockNumber,
      depositExplorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
      depositLabel: label,
      committedValue,
    };
  });
}

function createInitialSnapshot(params: {
  workflowId?: string;
  walletMode?: FlowWalletMode;
  walletAddress?: Address | null;
  assetDecimals?: number | null;
  requiredNativeFunding?: bigint | null;
  requiredTokenFunding?: bigint | null;
  backupConfirmed?: boolean;
  phase?: FlowPhase;
  chain: string;
  asset: string;
  depositAmount: bigint;
  recipient: Address;
  poolAccountNumber?: number | null;
  poolAccountId?: string | null;
  depositTxHash?: string | null;
  depositBlockNumber?: bigint | null;
  depositExplorerUrl?: string | null;
  depositLabel?: bigint | null;
  committedValue?: bigint | null;
}): FlowSnapshot {
  const now = workflowNow();
  return normalizeWorkflowSnapshot({
    schemaVersion: JSON_SCHEMA_VERSION,
    workflowId: params.workflowId ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
    phase: params.phase ?? "awaiting_asp",
    walletMode: params.walletMode ?? "configured",
    walletAddress: params.walletAddress ?? null,
    assetDecimals: params.assetDecimals ?? null,
    requiredNativeFunding: params.requiredNativeFunding?.toString() ?? null,
    requiredTokenFunding: params.requiredTokenFunding?.toString() ?? null,
    backupConfirmed: params.backupConfirmed ?? false,
    chain: params.chain,
    asset: params.asset,
    depositAmount: params.depositAmount.toString(),
    recipient: params.recipient,
    poolAccountId: params.poolAccountId ?? null,
    poolAccountNumber: params.poolAccountNumber ?? null,
    depositTxHash: params.depositTxHash ?? null,
    depositBlockNumber: params.depositBlockNumber?.toString() ?? null,
    depositExplorerUrl: params.depositExplorerUrl ?? null,
    depositLabel: params.depositLabel?.toString() ?? null,
    committedValue: params.committedValue?.toString() ?? null,
    aspStatus: params.phase === "awaiting_funding" ? undefined : "pending",
  });
}

function attachDepositResultToSnapshot(
  snapshot: FlowSnapshot,
  result: DepositExecutionResult,
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        phase: "awaiting_asp",
        poolAccountId: result.poolAccountId,
        poolAccountNumber: result.poolAccountNumber,
        depositTxHash: result.depositTxHash,
        depositBlockNumber: result.depositBlockNumber.toString(),
        depositExplorerUrl: result.depositExplorerUrl,
        depositLabel: result.depositLabel.toString(),
        committedValue: result.committedValue.toString(),
        aspStatus: "pending",
      }),
    ),
  );
}

function attachPendingDepositToSnapshot(
  snapshot: FlowSnapshot,
  pending: PendingDepositSnapshotData,
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        phase: "depositing_publicly",
        depositTxHash: pending.depositTxHash,
        depositExplorerUrl: pending.depositExplorerUrl,
      }),
    ),
  );
}

function attachPendingWithdrawalToSnapshot(
  snapshot: FlowSnapshot,
  chainId: number,
  withdrawTxHash: Hex,
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        phase: "withdrawing",
        withdrawTxHash,
        withdrawBlockNumber: null,
        withdrawExplorerUrl: explorerTxUrl(chainId, withdrawTxHash),
      }),
    ),
  );
}

function attachWithdrawalResultToSnapshot(
  snapshot: FlowSnapshot,
  result: {
    chainId: number;
    withdrawTxHash: string;
    withdrawBlockNumber: bigint | string;
    withdrawExplorerUrl?: string | null;
  },
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        phase: "completed",
        aspStatus: "approved",
        withdrawTxHash: result.withdrawTxHash,
        withdrawBlockNumber: result.withdrawBlockNumber.toString(),
        withdrawExplorerUrl:
          result.withdrawExplorerUrl ??
          explorerTxUrl(result.chainId, result.withdrawTxHash),
      }),
    ),
  );
}

function attachPendingRagequitToSnapshot(
  snapshot: FlowSnapshot,
  chainId: number,
  ragequitTxHash: Hex,
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        ragequitTxHash,
        ragequitBlockNumber: null,
        ragequitExplorerUrl: explorerTxUrl(chainId, ragequitTxHash),
      }),
    ),
  );
}

function attachRagequitResultToSnapshot(
  snapshot: FlowSnapshot,
  result: {
    chainId: number;
    aspStatus?: AspApprovalStatus;
    ragequitTxHash: string;
    ragequitBlockNumber: bigint | string;
    ragequitExplorerUrl?: string | null;
  },
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        phase: "completed_public_recovery",
        aspStatus: result.aspStatus ?? snapshot.aspStatus,
        ragequitTxHash: result.ragequitTxHash,
        ragequitBlockNumber: result.ragequitBlockNumber.toString(),
        ragequitExplorerUrl:
          result.ragequitExplorerUrl ??
          explorerTxUrl(result.chainId, result.ragequitTxHash),
      }),
    ),
  );
}

async function readFlowFundingState(params: {
  snapshot: FlowSnapshot;
  pool: WorkflowPool;
  globalOpts?: GlobalOptions;
}): Promise<{
  nativeBalance: bigint;
  tokenBalance: bigint | null;
  nativeSatisfied: boolean;
  tokenSatisfied: boolean;
}> {
  if (!params.snapshot.walletAddress) {
    throw new CLIError(
      "Workflow wallet address is missing.",
      "INPUT",
      "Inspect the saved workflow file or start a new workflow wallet.",
    );
  }

  const publicClient = getPublicClient(
    resolveChain(params.snapshot.chain),
    params.globalOpts?.rpcUrl,
  );
  const nativeBalance = await publicClient.getBalance({
    address: params.snapshot.walletAddress as Address,
  });
  const requiredNativeFunding = params.snapshot.requiredNativeFunding
    ? BigInt(params.snapshot.requiredNativeFunding)
    : 0n;
  const tokenBalance =
    params.pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
      ? null
      : ((await publicClient.readContract({
          address: params.pool.asset,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [params.snapshot.walletAddress as Address],
        })) as bigint);
  const requiredTokenFunding = params.snapshot.requiredTokenFunding
    ? BigInt(params.snapshot.requiredTokenFunding)
    : 0n;

  return {
    nativeBalance,
    tokenBalance,
    nativeSatisfied: nativeBalance >= requiredNativeFunding,
    tokenSatisfied: tokenBalance === null || tokenBalance >= requiredTokenFunding,
  };
}

async function reconcileDepositingSnapshot(
  snapshot: FlowSnapshot,
  globalOpts: GlobalOptions | undefined,
  silent: boolean,
): Promise<FlowSnapshot | null> {
  if (!snapshot.poolAccountNumber || !snapshot.poolAccountId) {
    return null;
  }

  try {
    const context = await loadWorkflowPoolAccountContext(snapshot, globalOpts, silent);
    return attachDepositResultToSnapshot(snapshot, {
      chain: snapshot.chain,
      asset: snapshot.asset,
      amount: BigInt(snapshot.depositAmount),
      decimals: context.pool.decimals,
      poolAccountNumber: context.selectedPoolAccount.paNumber,
      poolAccountId: context.selectedPoolAccount.paId,
      depositTxHash: context.selectedPoolAccount.txHash ?? snapshot.depositTxHash ?? "",
      depositBlockNumber:
        context.selectedPoolAccount.blockNumber ?? BigInt(snapshot.depositBlockNumber ?? "0"),
      depositExplorerUrl:
        context.selectedPoolAccount.txHash
          ? explorerTxUrl(context.chainConfig.id, context.selectedPoolAccount.txHash)
          : snapshot.depositExplorerUrl ?? null,
      depositLabel: context.selectedPoolAccount.label,
      committedValue: context.selectedPoolAccount.value,
    });
  } catch {
    return null;
  }
}

async function reconcilePendingDepositReceipt(params: {
  snapshot: FlowSnapshot;
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  globalOpts?: GlobalOptions;
}): Promise<FlowSnapshot | null> {
  const { snapshot, chainConfig, pool, globalOpts } = params;
  if (!snapshot.depositTxHash || snapshot.depositBlockNumber) {
    return null;
  }

  const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
  let receipt: Awaited<
    ReturnType<ReturnType<typeof getPublicClient>["getTransactionReceipt"]>
  > | null = null;

  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: snapshot.depositTxHash as `0x${string}`,
    });
  } catch {
    return null;
  }

  if (receipt.status !== "success") {
    throw new CLIError(
      `Previously submitted workflow deposit reverted: ${snapshot.depositTxHash}`,
      "CONTRACT",
      "Inspect the deposit transaction on a block explorer before retrying. Do not re-run 'privacy-pools flow watch' expecting this same deposit to succeed.",
    );
  }

  let depositLabel: bigint | undefined;
  let committedValue: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== pool.pool.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: depositedEventAbi,
        data: log.data,
        topics: log.topics,
      });
      depositLabel = decoded.args._label;
      committedValue = decoded.args._value;
      break;
    } catch {
      // Ignore unrelated logs.
    }
  }

  if (depositLabel === undefined || committedValue === undefined) {
    throw new CLIError(
      "Deposit confirmed, but the workflow could not recover the saved Pool Account metadata from the transaction receipt.",
      "CONTRACT",
      `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' to recover the deposit before resuming the workflow.`,
    );
  }

  return attachDepositResultToSnapshot(snapshot, {
    chain: snapshot.chain,
    asset: snapshot.asset,
    amount: BigInt(snapshot.depositAmount),
    decimals: pool.decimals,
    poolAccountNumber: snapshot.poolAccountNumber ?? 0,
    poolAccountId:
      snapshot.poolAccountId ?? `PA-${snapshot.poolAccountNumber ?? "?"}`,
    depositTxHash: snapshot.depositTxHash,
    depositBlockNumber: receipt.blockNumber,
    depositExplorerUrl:
      snapshot.depositExplorerUrl ??
      explorerTxUrl(chainConfig.id, snapshot.depositTxHash),
    depositLabel,
    committedValue,
  });
}

function buildSavedWorkflowRecoveryCommand(snapshot: FlowSnapshot): string {
  return `privacy-pools flow ragequit ${snapshot.workflowId}`;
}

async function refreshWorkflowAccountStateFromChain(params: {
  snapshot: FlowSnapshot;
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  globalOpts?: GlobalOptions;
  silent: boolean;
  isVerbose: boolean;
}): Promise<void> {
  const { snapshot, chainConfig, pool, globalOpts, silent, isVerbose } = params;

  try {
    const mnemonic = loadMnemonic();
    const dataService = await getDataService(
      chainConfig,
      pool.pool,
      globalOpts?.rpcUrl,
    );
    await initializeAccountService(
      dataService,
      mnemonic,
      [
        {
          chainId: chainConfig.id,
          address: pool.pool,
          scope: pool.scope,
          deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
        },
      ],
      chainConfig.id,
      true,
      silent,
      true,
    );
  } catch (error) {
    warn(
      `Workflow transaction confirmed onchain but local account reconciliation needs a manual refresh: ${error instanceof Error ? error.message : String(error)}`,
      silent,
    );
    warn(
      `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' to refresh the local account cache.`,
      silent,
    );
    verbose(
      `Workflow account refresh failed after confirmation for ${snapshot.workflowId}.`,
      isVerbose,
      silent,
    );
  }
}

async function reconcilePendingWithdrawalReceipt(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<FlowSnapshot | null> {
  const { snapshot, globalOpts, mode, isVerbose } = params;
  if (!snapshot.withdrawTxHash || snapshot.withdrawBlockNumber) {
    return null;
  }

  const silent = mode.isQuiet || mode.isJson;
  const chainConfig = assertWorkflowChain(snapshot);
  const pool = await resolvePool(chainConfig, snapshot.asset, globalOpts?.rpcUrl);
  const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

  let receipt: Awaited<
    ReturnType<ReturnType<typeof getPublicClient>["getTransactionReceipt"]>
  > | null = null;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: snapshot.withdrawTxHash as `0x${string}`,
    });
  } catch {
    return null;
  }

  if (receipt.status !== "success") {
    throw new CLIError(
      `Previously submitted workflow withdrawal reverted: ${snapshot.withdrawTxHash}`,
      "CONTRACT",
      "Inspect the relay transaction on a block explorer before retrying 'privacy-pools flow watch'.",
    );
  }

  await refreshWorkflowAccountStateFromChain({
    snapshot,
    chainConfig,
    pool,
    globalOpts,
    silent,
    isVerbose,
  });

  return attachWithdrawalResultToSnapshot(snapshot, {
    chainId: chainConfig.id,
    withdrawTxHash: snapshot.withdrawTxHash,
    withdrawBlockNumber: receipt.blockNumber,
    withdrawExplorerUrl:
      snapshot.withdrawExplorerUrl ??
      explorerTxUrl(chainConfig.id, snapshot.withdrawTxHash),
  });
}

async function reconcilePendingRagequitReceipt(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<FlowSnapshot | null> {
  const { snapshot, globalOpts, mode, isVerbose } = params;
  if (!snapshot.ragequitTxHash || snapshot.ragequitBlockNumber) {
    return null;
  }

  const silent = mode.isQuiet || mode.isJson;
  const chainConfig = assertWorkflowChain(snapshot);
  const pool = await resolvePool(chainConfig, snapshot.asset, globalOpts?.rpcUrl);
  const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

  let receipt: Awaited<
    ReturnType<ReturnType<typeof getPublicClient>["getTransactionReceipt"]>
  > | null = null;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: snapshot.ragequitTxHash as `0x${string}`,
    });
  } catch {
    return null;
  }

  if (receipt.status !== "success") {
    throw new CLIError(
      `Previously submitted workflow ragequit reverted: ${snapshot.ragequitTxHash}`,
      "CONTRACT",
      "Inspect the exit transaction on a block explorer before retrying 'privacy-pools flow ragequit'.",
    );
  }

  await refreshWorkflowAccountStateFromChain({
    snapshot,
    chainConfig,
    pool,
    globalOpts,
    silent,
    isVerbose,
  });

  return attachRagequitResultToSnapshot(snapshot, {
    chainId: chainConfig.id,
    aspStatus: snapshot.aspStatus,
    ragequitTxHash: snapshot.ragequitTxHash,
    ragequitBlockNumber: receipt.blockNumber,
    ragequitExplorerUrl:
      snapshot.ragequitExplorerUrl ??
      explorerTxUrl(chainConfig.id, snapshot.ragequitTxHash),
  });
}

async function awaitPendingRagequitReceipt(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<FlowSnapshot> {
  const immediate = await reconcilePendingRagequitReceipt(params);
  if (immediate) {
    return immediate;
  }

  const { snapshot, globalOpts, mode, isVerbose } = params;
  if (!snapshot.ragequitTxHash) {
    throw new CLIError(
      "This workflow does not have a pending public recovery transaction.",
      "INPUT",
      "Run 'privacy-pools flow ragequit' to submit the recovery transaction first.",
    );
  }

  const silent = mode.isQuiet || mode.isJson;
  const chainConfig = assertWorkflowChain(snapshot);
  const pool = await resolvePool(chainConfig, snapshot.asset, globalOpts?.rpcUrl);
  const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: snapshot.ragequitTxHash as `0x${string}`,
    timeout: getConfirmationTimeoutMs(),
  }).catch(() => {
    throw new CLIError(
      "Timed out waiting for workflow ragequit confirmation.",
      "RPC",
      `Tx ${snapshot.ragequitTxHash} may still confirm. Run 'privacy-pools flow status ${snapshot.workflowId}' to inspect the saved workflow and retry later.`,
    );
  });

  if (receipt.status !== "success") {
    throw new CLIError(
      `Workflow ragequit transaction reverted: ${snapshot.ragequitTxHash}`,
      "CONTRACT",
      "Check the transaction on a block explorer for details.",
    );
  }

  await refreshWorkflowAccountStateFromChain({
    snapshot,
    chainConfig,
    pool,
    globalOpts,
    silent,
    isVerbose,
  });

  return attachRagequitResultToSnapshot(snapshot, {
    chainId: chainConfig.id,
    aspStatus: snapshot.aspStatus,
    ragequitTxHash: snapshot.ragequitTxHash,
    ragequitBlockNumber: receipt.blockNumber,
    ragequitExplorerUrl:
      snapshot.ragequitExplorerUrl ??
      explorerTxUrl(chainConfig.id, snapshot.ragequitTxHash),
  });
}

async function inspectFundingAndDeposit(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<FundingInspectionResult> {
  const { snapshot, globalOpts, mode, isVerbose } = params;
  const silent = mode.isQuiet || mode.isJson;
  const chainConfig = assertWorkflowChain(snapshot);
  const pool = await resolvePool(chainConfig, snapshot.asset, globalOpts?.rpcUrl);
  let currentSnapshot = snapshot;

  if (currentSnapshot.phase === "depositing_publicly") {
    if (!currentSnapshot.depositTxHash) {
      const cleanSubmissionFailure =
        currentSnapshot.lastError?.step === "deposit" &&
        currentSnapshot.lastError.errorCode !== WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_CODE;
      if (cleanSubmissionFailure) {
        currentSnapshot = saveWorkflowSnapshotIfChanged(
          currentSnapshot,
          clearLastError(
            updateSnapshot(currentSnapshot, {
              phase: "awaiting_funding",
            }),
          ),
        );
      } else {
        throw new CLIError(
          "This workflow may have submitted a public deposit, but the transaction hash was not checkpointed locally.",
          "INPUT",
          `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' or inspect the deposit wallet before retrying 'privacy-pools flow watch'.`,
        );
      }
    }

    if (currentSnapshot.depositTxHash) {
      const pendingReceipt = await reconcilePendingDepositReceipt({
        snapshot: currentSnapshot,
        chainConfig,
        pool,
        globalOpts,
      });
      if (pendingReceipt) {
        return {
          snapshot: saveWorkflowSnapshotIfChanged(currentSnapshot, pendingReceipt),
          continueWatching: true,
        };
      }

      const reconciled = await reconcileDepositingSnapshot(currentSnapshot, globalOpts, silent);
      if (reconciled) {
        return {
          snapshot: saveWorkflowSnapshotIfChanged(currentSnapshot, reconciled),
          continueWatching: true,
        };
      }

      if (currentSnapshot.depositTxHash && !currentSnapshot.depositBlockNumber) {
        const waitingForMining = clearLastError(
          updateSnapshot(currentSnapshot, {
            phase: "depositing_publicly",
          }),
        );
        return {
          snapshot: saveWorkflowSnapshotIfChanged(currentSnapshot, waitingForMining),
          continueWatching: true,
        };
      }
    }
  }

  const fundingState = await readFlowFundingState({
    snapshot: currentSnapshot,
    pool,
    globalOpts,
  });

  if (!fundingState.nativeSatisfied || !fundingState.tokenSatisfied) {
    const awaitingFunding = clearLastError(
      updateSnapshot(currentSnapshot, {
        phase: "awaiting_funding",
      }),
    );
    return {
      snapshot: saveWorkflowSnapshotIfChanged(currentSnapshot, awaitingFunding),
      continueWatching: true,
    };
  }

  const privateKey = getFlowSignerPrivateKey(currentSnapshot);
  const depositing = clearLastError(
    updateSnapshot(currentSnapshot, {
      phase: "depositing_publicly",
    }),
  );
  const savedDepositing = saveWorkflowSnapshotIfChanged(currentSnapshot, depositing);

  const depositResult = await executeDepositForFlow({
    chainConfig,
    pool,
    amount: BigInt(snapshot.depositAmount),
    privateKeyOverride: privateKey,
    onDepositSubmitted: (pending) => {
      try {
        saveWorkflowSnapshotIfChanged(
          savedDepositing,
          attachPendingDepositToSnapshot(savedDepositing, pending),
        );
      } catch {
        throw new CLIError(
          "Public deposit was submitted, but the workflow could not checkpoint it locally.",
          "INPUT",
          `Tx ${pending.depositTxHash} may still confirm. Run 'privacy-pools sync --chain ${currentSnapshot.chain} --asset ${currentSnapshot.asset}' or inspect the deposit wallet before retrying 'privacy-pools flow watch'.`,
          WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_CODE,
        );
      }
    },
    globalOpts,
    mode,
    isVerbose,
  });

  const fundedSnapshot = attachDepositResultToSnapshot(
    savedDepositing,
    depositResult,
  );
  return {
    snapshot: saveWorkflowSnapshotIfChanged(savedDepositing, fundedSnapshot),
    continueWatching: true,
  };
}

function assertWorkflowChain(snapshot: FlowSnapshot): ReturnType<typeof resolveChain> {
  return resolveChain(snapshot.chain);
}

async function loadWorkflowPoolAccountContext(
  snapshot: FlowSnapshot,
  globalOpts: GlobalOptions | undefined,
  silent: boolean,
  requireAspData = true,
): Promise<WorkflowPoolAccountContext> {
  if (!snapshot.poolAccountNumber) {
    throw new CLIError(
      "This workflow does not have a saved Pool Account yet.",
      "INPUT",
      "Wait for the public deposit step to finish before continuing this workflow.",
    );
  }
  const chainConfig = assertWorkflowChain(snapshot);
  const pool = await resolvePool(chainConfig, snapshot.asset, globalOpts?.rpcUrl);
  const mnemonic = loadMnemonic();
  const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
  const dataService = await getDataService(
    chainConfig,
    pool.pool,
    globalOpts?.rpcUrl,
  );
  const accountService = await initializeAccountService(
    dataService,
    mnemonic,
    [
      {
        chainId: chainConfig.id,
        address: pool.pool,
        scope: pool.scope,
        deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
      },
    ],
    chainConfig.id,
    true,
    silent,
    true,
  );

  const spendableCommitments = withSuppressedSdkStdoutSync(() =>
    accountService.getSpendableCommitments(),
  ).get(pool.scope) ?? [];

  let aspLabels: bigint[] = [];
  let aspReviewState:
    | ReturnType<typeof buildLoadedAspDepositReviewState>
    | { approvedLabels: Set<string> | null; reviewStatuses: ReadonlyMap<string, AspApprovalStatus> | null } = {
      approvedLabels: null,
      reviewStatuses: null,
    };
  let allCommitmentHashes: bigint[] = [];
  let rootsOnchainMtRoot = 0n;

  if (requireAspData) {
    const activeLabels = collectActiveLabels(spendableCommitments);
    const [roots, leaves, rawReviewStatuses] = await Promise.all([
      fetchMerkleRoots(chainConfig, pool.scope),
      fetchMerkleLeaves(chainConfig, pool.scope),
      fetchDepositReviewStatuses(chainConfig, pool.scope, activeLabels),
    ]);

    if (BigInt(roots.mtRoot) !== BigInt(roots.onchainMtRoot)) {
      throw new CLIError(
        "Withdrawal service data is still updating.",
        "ASP",
        "Wait a few seconds and retry.",
      );
    }

    aspLabels = leaves.aspLeaves.map((value) => BigInt(value));
    const approvedLabelStrings = new Set(
      aspLabels.map((label) => label.toString()),
    );
    aspReviewState = buildLoadedAspDepositReviewState(
      activeLabels,
      approvedLabelStrings,
      rawReviewStatuses,
    );
    allCommitmentHashes = leaves.stateTreeLeaves.map((value) => BigInt(value));
    rootsOnchainMtRoot = BigInt(roots.onchainMtRoot);
  }

  const allPoolAccounts = buildAllPoolAccountRefs(
    accountService.account,
    pool.scope,
    spendableCommitments,
    aspReviewState.approvedLabels,
    aspReviewState.reviewStatuses,
  );
  const poolAccounts = buildPoolAccountRefs(
    accountService.account,
    pool.scope,
    spendableCommitments,
    aspReviewState.approvedLabels,
    aspReviewState.reviewStatuses,
  );

  const selectedPoolAccount = pickWorkflowPoolAccount(snapshot, allPoolAccounts);

  if (!selectedPoolAccount) {
    throw new CLIError(
      `Workflow Pool Account ${snapshot.poolAccountId} is no longer available in local state.`,
      "INPUT",
      `Run 'privacy-pools accounts --chain ${snapshot.chain}' to inspect the account and continue manually if needed.`,
    );
  }

  const approvedActivePoolAccount =
    pickWorkflowPoolAccount(snapshot, poolAccounts) ?? selectedPoolAccount;

  return {
    chainConfig,
    pool,
    accountService,
    publicClient,
    selectedPoolAccount: approvedActivePoolAccount,
    spendableCommitments,
    aspRoot: rootsOnchainMtRoot as unknown as SDKHash,
    aspLabels,
    allCommitmentHashes,
    rootsOnchainMtRoot,
  };
}

async function executeRelayedWithdrawalForFlow(params: {
  snapshot: FlowSnapshot;
  context: WorkflowPoolAccountContext;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<{
  withdrawTxHash: string;
  withdrawBlockNumber: string;
  withdrawExplorerUrl: string | null;
}> {
  const { snapshot, context, globalOpts, mode, isVerbose } = params;
  const silent = mode.isQuiet || mode.isJson;
  const { chainConfig, pool, accountService, publicClient, selectedPoolAccount } =
    context;
  const extraGas =
    pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
      ? false
      : true;

  const withdrawalAmount = selectedPoolAccount.value;
  validatePositive(withdrawalAmount, "Flow withdrawal amount");

  stageHeader(2, 3, "Requesting relayer quote", silent);
  const withdrawSpin = spinner("Requesting relayer quote...", silent);
  withdrawSpin.start();

  const details = await getRelayerDetails(chainConfig, pool.asset);
  if (withdrawalAmount < BigInt(details.minWithdrawAmount)) {
    throw new CLIError(
      `Workflow amount is below the relayer minimum of ${formatAmount(BigInt(details.minWithdrawAmount), pool.decimals, pool.symbol)}.`,
      "RELAYER",
      `This workflow only supports relayed private withdrawals. Use '${buildSavedWorkflowRecoveryCommand(snapshot)}' for the public recovery path.`,
    );
  }

  const remainingBelowMinAdvisory = getRelayedWithdrawalRemainderAdvisory({
    remainingBalance: 0n,
    minWithdrawAmount: BigInt(details.minWithdrawAmount),
    poolAccountId: snapshot.poolAccountId ?? `PA-${snapshot.poolAccountNumber ?? "?"}`,
    assetSymbol: pool.symbol,
    decimals: pool.decimals,
  });
  if (remainingBelowMinAdvisory) {
    verbose(remainingBelowMinAdvisory, isVerbose, silent);
  }

  let quote = await requestQuote(chainConfig, {
    amount: withdrawalAmount,
    asset: pool.asset,
    extraGas,
    recipient: snapshot.recipient as Address,
  });

  let { quoteFeeBPS, expirationMs } = validateRelayerQuoteForWithdrawal(
    quote,
    pool.maxRelayFeeBPS,
  );

  const fetchFreshQuote = async (reason: string): Promise<void> => {
    withdrawSpin.text = reason;
    const refreshed = await refreshExpiredRelayerQuoteForWithdrawal({
      fetchQuote: () =>
        requestQuote(chainConfig, {
          amount: withdrawalAmount,
          asset: pool.asset,
          extraGas,
          recipient: snapshot.recipient as Address,
        }),
      maxRelayFeeBPS: pool.maxRelayFeeBPS,
    });
    quote = refreshed.quote;
    quoteFeeBPS = refreshed.quoteFeeBPS;
    expirationMs = refreshed.expirationMs;
  };

  if (Date.now() > expirationMs) {
    await fetchFreshQuote("Quote expired. Refreshing...");
  }

  const stateMerkleProof = generateMerkleProof(
    context.allCommitmentHashes,
    BigInt(selectedPoolAccount.commitment.hash.toString()),
  );
  const aspMerkleProof = generateMerkleProof(
    context.aspLabels,
    BigInt(selectedPoolAccount.label.toString()),
  );

  const { nullifier: newNullifier, secret: newSecret } =
    withSuppressedSdkStdoutSync(() =>
      accountService.createWithdrawalSecrets(selectedPoolAccount.commitment),
    );

  const stateRoot = (await publicClient.readContract({
    address: pool.pool,
    abi: poolCurrentRootAbi,
    functionName: "currentRoot",
  })) as unknown as SDKHash;

  const stateProofRoot = BigInt(
    (stateMerkleProof as { root: bigint | string }).root,
  );
  if (stateProofRoot !== BigInt(stateRoot as unknown as bigint)) {
    throw new CLIError(
      "Pool data is out of date.",
      "ASP",
      "Run 'privacy-pools sync' and retry the workflow watch command.",
    );
  }

  const assertLatestRootUnchanged = async (
    message: string,
    hint: string,
  ): Promise<void> => {
    const latestRoot = await publicClient.readContract({
      address: chainConfig.entrypoint,
      abi: entrypointLatestRootAbi,
      functionName: "latestRoot",
    });

    if (context.rootsOnchainMtRoot !== BigInt(latestRoot as bigint)) {
      throw new CLIError(message, "ASP", hint);
    }
  };

  const relayData = encodeAbiParameters(
    [
      { name: "recipient", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
    [
      snapshot.recipient as Address,
      details.feeReceiverAddress,
      quoteFeeBPS,
    ],
  );

  const withdrawal = {
    processooor: chainConfig.entrypoint as Address,
    data: relayData,
  };

  const contextValue = BigInt(
    calculateContext(withdrawal, pool.scope as unknown as SDKHash),
  );

  stageHeader(3, 3, "Generating proof and submitting withdrawal", silent);
  await assertLatestRootUnchanged(
    "Pool state changed while preparing the workflow proof.",
    "Re-run 'privacy-pools flow watch' to generate a fresh proof.",
  );

  const proof = await withProofProgress(
    withdrawSpin,
    "Generating ZK proof",
    () =>
      proveWithdrawal(selectedPoolAccount.commitment, {
        context: contextValue,
        withdrawalAmount,
        stateMerkleProof,
        aspMerkleProof,
        stateRoot,
        stateTreeDepth: 32n,
        aspRoot: context.aspRoot,
        aspTreeDepth: 32n,
        newNullifier,
        newSecret,
      }),
  );

  await assertLatestRootUnchanged(
    "Pool state changed before submission. Re-run the workflow watch command to generate a fresh proof.",
    "Run 'privacy-pools sync' and retry the workflow watch command.",
  );

  if (Date.now() > expirationMs) {
    const previousFeeBPS = quote.feeBPS;
    await fetchFreshQuote("Quote expired after proof. Refreshing...");
    if (Number(previousFeeBPS) !== Number(quote.feeBPS)) {
      throw new CLIError(
        `Relayer fee changed during proof generation (${previousFeeBPS} -> ${quote.feeBPS} BPS).`,
        "RELAYER",
        "Re-run 'privacy-pools flow watch' to generate a fresh proof with the new fee.",
      );
    }
  }

  withdrawSpin.text = "Submitting to relayer...";
  const relayResult = await submitRelayRequest(chainConfig, {
    scope: pool.scope,
    withdrawal,
    proof: proof.proof,
    publicSignals: proof.publicSignals,
    feeCommitment: quote.feeCommitment,
  });

  await saveWorkflowSnapshotIfChangedWithLock(
    snapshot,
    attachPendingWithdrawalToSnapshot(
      snapshot,
      chainConfig.id,
      relayResult.txHash as Hex,
    ),
  );

  withdrawSpin.text = "Waiting for relay transaction confirmation...";
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: relayResult.txHash as `0x${string}`,
    timeout: getConfirmationTimeoutMs(),
  }).catch(() => {
    throw new CLIError(
      "Timed out waiting for relayed withdrawal confirmation.",
      "RPC",
      "The relayer may still confirm the transaction. Check the explorer and run 'privacy-pools flow watch' again to re-evaluate the saved workflow.",
    );
  });

  if (receipt.status !== "success") {
    throw new CLIError(
      `Relay transaction reverted: ${relayResult.txHash}`,
      "CONTRACT",
      "Check the transaction on a block explorer for details.",
    );
  }

  await withProcessLock(async () => {
    guardCriticalSection();
    try {
      try {
        withSuppressedSdkStdoutSync(() =>
          accountService.addWithdrawalCommitment(
            selectedPoolAccount.commitment,
            selectedPoolAccount.commitment.value - withdrawalAmount,
            newNullifier,
            newSecret,
            receipt.blockNumber,
            relayResult.txHash as Hex,
          ),
        );
        saveAccount(chainConfig.id, accountService.account);
        saveSyncMeta(chainConfig.id);
      } catch (saveError) {
        warn(
          `Withdrawal confirmed onchain but failed to update local account state immediately: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
          silent,
        );
        warn(
          `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' to refresh the local account cache.`,
          silent,
        );
      }
    } finally {
      releaseCriticalSection();
    }
  });

  withdrawSpin.succeed("Relayed withdrawal confirmed.");

  return {
    withdrawTxHash: relayResult.txHash,
    withdrawBlockNumber: receipt.blockNumber.toString(),
    withdrawExplorerUrl: explorerTxUrl(chainConfig.id, relayResult.txHash),
  };
}

async function continueApprovedWorkflowWithdrawal(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<ApprovalInspectionResult> {
  const { snapshot, globalOpts, mode, isVerbose } = params;
  const reconciledPending = await reconcilePendingWithdrawalReceipt({
    snapshot,
    globalOpts,
    mode,
    isVerbose,
  });
  if (reconciledPending) {
    const savedCompleted = await saveWorkflowSnapshotIfChangedWithLock(
      snapshot,
      reconciledPending,
    );
    cleanupTerminalWorkflowSecret(savedCompleted);
    return { snapshot: savedCompleted, continueWatching: false };
  }

  if (snapshot.withdrawTxHash && !snapshot.withdrawBlockNumber) {
    return { snapshot, continueWatching: true };
  }

  const silent = mode.isQuiet || mode.isJson;
  const context = await loadWorkflowPoolAccountContext(
    snapshot,
    globalOpts,
    silent,
  );
  const mutationPhase = classifyFlowMutation(
    snapshot,
    context.selectedPoolAccount,
  );
  if (mutationPhase) {
    const stopped = clearLastError(
      updateSnapshot(snapshot, {
        phase: mutationPhase,
        aspStatus: context.selectedPoolAccount.aspStatus,
      }),
    );
    return {
      snapshot: await saveWorkflowSnapshotIfChangedWithLock(snapshot, stopped),
      continueWatching: false,
    };
  }

  const alignedSnapshot = alignSnapshotToPoolAccount(
    snapshot,
    context.chainConfig.id,
    context.selectedPoolAccount,
  );
  const savedAligned = await saveWorkflowSnapshotIfChangedWithLock(
    snapshot,
    alignedSnapshot,
  );

  const withdrawing = clearLastError(
    updateSnapshot(savedAligned, {
      phase: "withdrawing",
      aspStatus: "approved",
    }),
  );
  const savedWithdrawing = await saveWorkflowSnapshotIfChangedWithLock(
    savedAligned,
    withdrawing,
  );

  const withdrawalResult = await executeRelayedWithdrawalForFlow({
    snapshot: savedWithdrawing,
    context,
    globalOpts,
    mode,
    isVerbose,
  });

  const completed = clearLastError(
    attachWithdrawalResultToSnapshot(savedWithdrawing, {
      chainId: context.chainConfig.id,
      withdrawTxHash: withdrawalResult.withdrawTxHash,
      withdrawBlockNumber: withdrawalResult.withdrawBlockNumber,
      withdrawExplorerUrl: withdrawalResult.withdrawExplorerUrl,
    }),
  );
  const savedCompleted = await saveWorkflowSnapshotIfChangedWithLock(
    savedWithdrawing,
    completed,
  );
  cleanupTerminalWorkflowSecret(savedCompleted);

  return { snapshot: savedCompleted, continueWatching: false };
}

async function executeRagequitForFlow(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<
  {
    aspStatus?: AspApprovalStatus;
    ragequitTxHash: string;
    ragequitBlockNumber: string;
    ragequitExplorerUrl: string | null;
  }
> {
  const { snapshot, globalOpts, mode, isVerbose } = params;
  const silent = mode.isQuiet || mode.isJson;
  const context = await loadWorkflowPoolAccountContext(
    snapshot,
    globalOpts,
    silent,
    false,
  );
  const { chainConfig, pool, accountService, publicClient, selectedPoolAccount } = context;
  const mutationPhase = classifyFlowMutation(snapshot, selectedPoolAccount);
  if (mutationPhase) {
    throw new CLIError(
      `${snapshot.poolAccountId ?? "This workflow"} changed outside the saved flow.`,
      "INPUT",
      "Run 'privacy-pools flow status' to inspect the current saved state.",
    );
  }

  const commitment = selectedPoolAccount.commitment;
  const signerPrivateKey = getFlowSignerPrivateKey(snapshot);
  const signerAddress = privateKeyToAccount(signerPrivateKey).address;

  if (
    snapshot.walletMode === "configured" &&
    snapshot.walletAddress &&
    signerAddress.toLowerCase() !== snapshot.walletAddress.toLowerCase()
  ) {
    throw new CLIError(
      `Configured signer ${signerAddress} does not match the original depositor ${snapshot.walletAddress}.`,
      "INPUT",
      "Restore the original deposit signer via PRIVACY_POOLS_PRIVATE_KEY or your saved signer key file before retrying 'privacy-pools flow ragequit'.",
    );
  }

  await checkHasGas(publicClient, signerAddress);

  try {
    const depositor = (await publicClient.readContract({
      address: pool.pool,
      abi: poolDepositorAbi,
      functionName: "depositors",
      args: [commitment.label],
    })) as Address;
    if (depositor.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new CLIError(
        `Signer ${signerAddress} is not the original depositor (${depositor}).`,
        "INPUT",
        "Only the original depositor can ragequit this Pool Account.",
      );
    }
  } catch (error) {
    if (error instanceof CLIError) throw error;
    verbose(
      `Could not verify original depositor onchain: ${error instanceof Error ? error.message : String(error)}`,
      isVerbose,
      silent,
    );
  }

  stageHeader(1, 2, "Generating commitment proof", silent);
  const ragequitSpin = spinner("Generating commitment proof...", silent);
  ragequitSpin.start();
  const proof = await withProofProgress(
    ragequitSpin,
    "Generating commitment proof",
    () =>
      proveCommitment(
        commitment.value,
        BigInt(commitment.label.toString()),
        commitment.nullifier,
        commitment.secret,
      ),
  );

  stageHeader(2, 2, "Submitting exit", silent);
  ragequitSpin.text = "Submitting exit transaction...";
  const tx = await submitRagequit(
    chainConfig,
    pool.pool,
    toSolidityProof(proof as any),
    globalOpts?.rpcUrl,
    signerPrivateKey,
  );

  await saveWorkflowSnapshotIfChangedWithLock(
    snapshot,
    attachPendingRagequitToSnapshot(snapshot, chainConfig.id, tx.hash as Hex),
  );

  ragequitSpin.text = "Waiting for confirmation...";
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: tx.hash as `0x${string}`,
    timeout: getConfirmationTimeoutMs(),
  }).catch(() => {
    throw new CLIError(
      "Timed out waiting for workflow ragequit confirmation.",
      "RPC",
      `Tx ${tx.hash} may still confirm. Run 'privacy-pools flow status ${snapshot.workflowId}' to inspect the saved workflow and retry later if needed.`,
    );
  });

  if (receipt.status !== "success") {
    throw new CLIError(
      `Workflow ragequit transaction reverted: ${tx.hash}`,
      "CONTRACT",
      "Check the transaction on a block explorer for details.",
    );
  }

  guardCriticalSection();
  try {
    try {
      withSuppressedSdkStdoutSync(() =>
        accountService.addRagequitToAccount(
          commitment.label as unknown as SDKHash,
          {
            ragequitter: signerAddress,
            commitment: commitment.hash,
            label: commitment.label,
            value: commitment.value,
            blockNumber: receipt.blockNumber,
            transactionHash: tx.hash as Hex,
          } as any,
        ),
      );
      saveAccount(chainConfig.id, accountService.account);
      saveSyncMeta(chainConfig.id);
    } catch (saveError) {
      warn(
        `Workflow ragequit confirmed onchain but failed to update local account state immediately: ${saveError instanceof Error ? saveError.message : String(saveError)}`,
        silent,
      );
      warn(
        `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' to refresh the local account cache.`,
        silent,
      );
    }
  } finally {
    releaseCriticalSection();
  }

  ragequitSpin.succeed("Exit confirmed.");

  return {
    aspStatus:
      snapshot.aspStatus && snapshot.aspStatus !== "unknown"
        ? snapshot.aspStatus
        : selectedPoolAccount.aspStatus,
    ragequitTxHash: tx.hash,
    ragequitBlockNumber: receipt.blockNumber.toString(),
    ragequitExplorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
  };
}

async function inspectAndAdvanceFlow(params: {
  snapshot: FlowSnapshot;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
}): Promise<ApprovalInspectionResult> {
  const { snapshot, globalOpts, mode, isVerbose } = params;
  const reconciledRagequit = await reconcilePendingRagequitReceipt({
    snapshot,
    globalOpts,
    mode,
    isVerbose,
  });
  if (reconciledRagequit) {
    const savedCompleted = await saveWorkflowSnapshotIfChangedWithLock(
      snapshot,
      reconciledRagequit,
    );
    cleanupTerminalWorkflowSecret(savedCompleted);
    return {
      snapshot: savedCompleted,
      continueWatching: false,
    };
  }

  if (snapshot.ragequitTxHash && !snapshot.ragequitBlockNumber) {
    return {
      snapshot,
      continueWatching: false,
    };
  }

  const silent = mode.isQuiet || mode.isJson;

  if (snapshot.phase === "awaiting_funding" || snapshot.phase === "depositing_publicly") {
    return inspectFundingAndDeposit({
      snapshot,
      globalOpts,
      mode,
      isVerbose,
    });
  }

  if (
    snapshot.phase === "approved_ready_to_withdraw" ||
    snapshot.phase === "withdrawing"
  ) {
    return continueApprovedWorkflowWithdrawal({
      snapshot,
      globalOpts,
      mode,
      isVerbose,
    });
  }

  const requireAspData = snapshot.phase !== "paused_declined";
  const context = await loadWorkflowPoolAccountContext(
    snapshot,
    globalOpts,
    silent,
    requireAspData,
  );
  const mutatedSnapshot = saveMutatedWorkflowSnapshot(
    snapshot,
    context.selectedPoolAccount,
  );
  if (mutatedSnapshot) {
    return {
      snapshot: mutatedSnapshot,
      continueWatching: false,
    };
  }

  const alignedSnapshot = alignSnapshotToPoolAccount(
    snapshot,
    context.chainConfig.id,
    context.selectedPoolAccount,
  );
  const savedAligned = saveWorkflowSnapshotIfChanged(snapshot, alignedSnapshot);
  if (snapshot.phase === "paused_declined") {
    return {
      snapshot: saveWorkflowSnapshotIfChanged(savedAligned, clearLastError(savedAligned)),
      continueWatching: false,
    };
  }

  const aspStatus = context.selectedPoolAccount.aspStatus;
  if (aspStatus === "declined") {
    const declined = clearLastError(
      updateSnapshot(savedAligned, {
        phase: "paused_declined",
        aspStatus,
      }),
    );
    return {
      snapshot: saveWorkflowSnapshotIfChanged(savedAligned, declined),
      continueWatching: false,
    };
  }

  if (aspStatus === "poi_required") {
    const poiRequired = clearLastError(
      updateSnapshot(savedAligned, {
        phase: "paused_poi_required",
        aspStatus,
      }),
    );
    return {
      snapshot: saveWorkflowSnapshotIfChanged(savedAligned, poiRequired),
      continueWatching: false,
    };
  }

  if (aspStatus !== "approved") {
    const awaitingAsp = clearLastError(
      updateSnapshot(savedAligned, {
        phase: "awaiting_asp",
        aspStatus,
      }),
    );
    return {
      snapshot: saveWorkflowSnapshotIfChanged(savedAligned, awaitingAsp),
      continueWatching: true,
    };
  }

  const ready = clearLastError(
    updateSnapshot(savedAligned, {
      phase: "approved_ready_to_withdraw",
      aspStatus: "approved",
    }),
  );
  return {
    snapshot: saveWorkflowSnapshotIfChanged(savedAligned, ready),
    continueWatching: true,
  };
}

async function setupNewWalletWorkflow(params: {
  workflowId: string;
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  amount: bigint;
  recipient: Address;
  exportNewWallet?: string;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
}): Promise<NewWalletWorkflowSetupResult> {
  const { workflowId, chainConfig, pool, amount, recipient, exportNewWallet, globalOpts, mode } =
    params;
  const silent = mode.isQuiet || mode.isJson;
  const skipPrompts = mode.skipPrompts;
  const fundingRequirements = await getFlowFundingRequirements({
    chainConfig,
    pool,
    amount,
    globalOpts,
  });
  const nextPoolAccount = await getNextFlowPoolAccountRef({
    chainConfig,
    pool,
    globalOpts,
    silent,
  });
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const now = workflowNow();
  let backupPath: string | null = null;
  let backupConfirmedAt: string | undefined;

  const secretRecord: FlowSecretRecord = {
    schemaVersion: JSON_SCHEMA_VERSION,
    workflowId,
    chain: chainConfig.name,
    walletAddress: account.address,
    privateKey,
    createdAt: now,
  };

  if (skipPrompts) {
    backupPath = exportNewWallet!.trim();
    writePrivateTextFile(backupPath, buildWorkflowWalletBackup(secretRecord));
    backupConfirmedAt = workflowNow();
  } else {
    process.stderr.write("\n");
    warn("A dedicated workflow wallet was created for this flow.", silent);
    info(`Workflow wallet: ${account.address}`, silent);

    if (exportNewWallet?.trim()) {
      backupPath = exportNewWallet.trim();
      writePrivateTextFile(backupPath, buildWorkflowWalletBackup(secretRecord));
      info(`Workflow wallet backup saved to ${backupPath}`, silent);
      warn(
        "The recovery key was written to that backup file. Keep it secure; anyone with that key can move workflow funds.",
        silent,
      );
    } else {
      const { input, select } = await import("@inquirer/prompts");
      const saveAction = await select({
        message: "How would you like to back up this workflow wallet?",
        choices: [
          { name: "Save to file (recommended)", value: "file" },
          { name: "I've already copied it", value: "copied" },
        ],
      });

      if (saveAction === "file") {
        backupPath = await input({
          message: "Save location:",
          default: defaultWorkflowWalletBackupPath(workflowId),
        });
        writePrivateTextFile(
          backupPath.trim(),
          buildWorkflowWalletBackup(secretRecord),
        );
        backupPath = backupPath.trim();
        info(`Workflow wallet backup saved to ${backupPath}`, silent);
        warn(
          "The recovery key was written to that backup file. Keep it secure; anyone with that key can move workflow funds.",
          silent,
        );
      } else {
        process.stderr.write(`Private key: ${privateKey}\n`);
        warn(
          "Save this private key now. You will need it to recover funds if the workflow cannot finish privately.",
          silent,
        );
      }
    }

    process.stderr.write("\n");

    const { confirm } = await import("@inquirer/prompts");
    const confirmed = await confirm({
      message: "I have securely backed up this workflow wallet.",
      default: false,
    });
    if (!confirmed) {
      throw new CLIError(
        "You must confirm that the workflow wallet is backed up.",
        "INPUT",
        "Re-run the flow when you are ready to back up the generated wallet.",
      );
    }
    backupConfirmedAt = workflowNow();
    process.stderr.write("\n");
  }

  secretRecord.backupConfirmedAt = backupConfirmedAt;
  secretRecord.exportedBackupPath = backupPath;

  if (!silent) {
    info(`Fund ${account.address} to continue automatically:`, silent);
    if (fundingRequirements.requiredTokenFunding !== null) {
      info(
        `  ${formatAmount(fundingRequirements.requiredTokenFunding, pool.decimals, pool.symbol)} ${pool.symbol} to deposit`,
        silent,
      );
      info(
        `  ${formatAmount(fundingRequirements.requiredNativeFunding, 18, "ETH")} ETH for gas`,
        silent,
      );
      warn(
        "Both balances must arrive at this same wallet address before the flow can continue.",
        silent,
      );
    } else {
      info(
        `  ${formatAmount(fundingRequirements.requiredNativeFunding, 18, "ETH")} ETH total (deposit amount plus gas reserve)`,
        silent,
      );
    }
    process.stderr.write("\n");
  }

  return {
    secretRecord,
    snapshot: createInitialSnapshot({
      workflowId,
      walletMode: "new_wallet",
      walletAddress: account.address,
      requiredNativeFunding: fundingRequirements.requiredNativeFunding,
      requiredTokenFunding: fundingRequirements.requiredTokenFunding,
      backupConfirmed: true,
      phase: "awaiting_funding",
      chain: chainConfig.name,
      asset: pool.symbol,
      assetDecimals: pool.decimals,
      depositAmount: amount,
      recipient,
      poolAccountNumber: nextPoolAccount.poolAccountNumber,
      poolAccountId: nextPoolAccount.poolAccountId,
    }),
  };
}

export async function startWorkflow(
  params: StartFlowParams,
): Promise<FlowSnapshot> {
  const {
    amountInput,
    assetInput,
    recipient,
    newWallet = false,
    exportNewWallet,
    globalOpts,
    mode,
    isVerbose,
    watch,
  } =
    params;
  const silent = mode.isQuiet || mode.isJson;
  const skipPrompts = mode.skipPrompts;
  const validatedRecipient = validateFlowRecipient(recipient);
  const effectiveWatch = newWallet ? true : watch;

  if (newWallet && skipPrompts && !exportNewWallet?.trim()) {
    throw new CLIError(
      "Non-interactive workflow wallets require --export-new-wallet <path>.",
      "INPUT",
      "Re-run with --export-new-wallet <path> so the new wallet key is backed up before the flow starts.",
    );
  }

  const config = loadConfig();
  const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
  const pool = await resolvePool(chainConfig, assetInput, globalOpts?.rpcUrl);
  const amount = parseAmount(amountInput, pool.decimals);
  validatePositive(amount, "Deposit amount");

  if (amount < pool.minimumDepositAmount) {
    throw new CLIError(
      `Deposit amount is below the minimum of ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)} for this pool.`,
      "INPUT",
      `Increase the amount to at least ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)}.`,
    );
  }

  if (!isRoundAmount(amount, pool.decimals, pool.symbol)) {
    const humanAmount = formatAmountDecimal(amount, pool.decimals);
    const suggestions = suggestRoundAmounts(amount, pool.decimals, pool.symbol);
    const suggestionText =
      suggestions.length > 0
        ? ` Consider: ${suggestions.map((value) => `${formatAmountDecimal(value, pool.decimals)} ${pool.symbol}`).join(", ")}.`
        : "";

    if (skipPrompts) {
      throw new CLIError(
        `Non-round amount ${humanAmount} ${pool.symbol} may reduce privacy.`,
        "INPUT",
        `Unique amounts can be linked between deposits and withdrawals.${suggestionText}`,
      );
    }

    process.stderr.write("\n");
    warn(
      `${humanAmount} ${pool.symbol} is a non-round amount that may reduce your privacy in the anonymity set.${suggestionText}`,
      silent,
    );
    const { confirm } = await import("@inquirer/prompts");
    const proceed = await confirm({
      message: "Proceed with this amount anyway?",
      default: false,
        });
        if (!proceed) {
          throw new FlowCancelledError();
        }
      }

  const feeAmount = (amount * pool.vettingFeeBPS) / 10000n;
  const estimatedCommitted = amount - feeAmount;
  const tokenPrice = deriveTokenPrice(pool);
  const amountUsd = usdSuffix(amount, pool.decimals, tokenPrice);
  const feeUsd = usdSuffix(feeAmount, pool.decimals, tokenPrice);
  const committedUsd = usdSuffix(estimatedCommitted, pool.decimals, tokenPrice);

  if (!skipPrompts && !newWallet) {
    const isErc20 =
      pool.asset.toLowerCase() !== NATIVE_ASSET_ADDRESS.toLowerCase();
    info(
      `Recipient: ${formatAddress(validatedRecipient)}`,
      silent,
    );
    info(
      `Vetting fee: ${formatBPS(pool.vettingFeeBPS)} (${formatAmount(feeAmount, pool.decimals, pool.symbol)}${feeUsd})`,
      silent,
    );
    info(
      `Expected committed value: ~${formatAmount(estimatedCommitted, pool.decimals, pool.symbol)}${committedUsd}`,
      silent,
    );
    if (isErc20) {
      info("This will require 2 transactions: token approval + deposit.", silent);
    }
    process.stderr.write("\n");
    const { confirm } = await import("@inquirer/prompts");
    const ok = await confirm({
      message:
        `Start flow by depositing ${formatAmount(amount, pool.decimals, pool.symbol)}${amountUsd} on ${chainConfig.name}, ` +
        `then privately withdraw the approved Pool Account to ${formatAddress(validatedRecipient)}?`,
      default: true,
    });
    if (!ok) {
      throw new FlowCancelledError();
    }
  }

  let snapshot: FlowSnapshot;
  if (newWallet) {
    const workflowId = randomUUID();
    const setup = await setupNewWalletWorkflow({
      workflowId,
      chainConfig,
      pool,
      amount,
      recipient: validatedRecipient,
      exportNewWallet,
      globalOpts,
      mode,
    });
    snapshot = await withProcessLock(async () => {
      try {
        saveWorkflowSecretRecord(setup.secretRecord);
        return saveWorkflowSnapshot(setup.snapshot);
      } catch (error) {
        deleteWorkflowSecretRecord(workflowId);
        throw error;
      }
    });
  } else {
    stageHeader(1, effectiveWatch ? 2 : 1, "Submitting deposit", silent);
    const depositResult = await executeDepositForFlow({
      chainConfig,
      pool,
      amount,
      globalOpts,
      mode,
      isVerbose,
    });

    try {
      snapshot = await withProcessLock(async () =>
        saveWorkflowSnapshot(
          createInitialSnapshot({
            walletMode: "configured",
            walletAddress: privateKeyToAccount(loadPrivateKey()).address,
            chain: depositResult.chain,
            asset: depositResult.asset,
            assetDecimals: pool.decimals,
            depositAmount: depositResult.amount,
            recipient: validatedRecipient,
            poolAccountNumber: depositResult.poolAccountNumber,
            poolAccountId: depositResult.poolAccountId,
            depositTxHash: depositResult.depositTxHash,
            depositBlockNumber: depositResult.depositBlockNumber,
            depositExplorerUrl: depositResult.depositExplorerUrl,
            depositLabel: depositResult.depositLabel,
            committedValue: depositResult.committedValue,
          }),
        ),
      );
    } catch {
      throw new CLIError(
        "Deposit succeeded, but the workflow could not be saved locally.",
        "INPUT",
        `Tx ${depositResult.depositTxHash} is confirmed onchain. Continue manually with 'privacy-pools accounts --chain ${depositResult.chain}', or fix the workflow directory and retry.`,
      );
    }
  }

  if (!effectiveWatch) {
    return snapshot;
  }

  return watchWorkflow({
    workflowId: snapshot.workflowId,
    globalOpts,
    mode,
    isVerbose,
  });
}

export async function watchWorkflow(
  params: WatchFlowParams,
): Promise<FlowSnapshot> {
  const { globalOpts, mode, isVerbose } = params;
  const silent = mode.isQuiet || mode.isJson;
  const workflowId = resolveWorkflowId(params.workflowId);
  let delayMs = initialPollDelayMs(loadWorkflowSnapshot(workflowId).phase);

  while (true) {
    const snapshot = loadWorkflowSnapshot(workflowId);
    if (isTerminalFlowPhase(snapshot.phase)) {
      return snapshot;
    }

    try {
      const result = await withProcessLock(async () =>
        inspectAndAdvanceFlow({
          snapshot,
          globalOpts,
          mode,
          isVerbose,
        }),
      );

      if (!result.continueWatching) {
        return result.snapshot;
      }

      if (result.snapshot.phase === "approved_ready_to_withdraw") {
        info("ASP approval confirmed. Preparing the private withdrawal now.", silent);
        delayMs = initialPollDelayMs(result.snapshot.phase);
        continue;
      }

      if (result.snapshot.phase === "awaiting_funding" && result.snapshot.walletAddress) {
        info(
          `Still waiting for funding at ${result.snapshot.walletAddress}. Checking again in ${humanPollDelayLabel(delayMs)}.`,
          silent,
        );
      } else if (result.snapshot.phase === "depositing_publicly") {
        info(
          "Still reconciling the public deposit step. Checking again shortly.",
          silent,
        );
      } else {
        info(
          `Still waiting for ASP approval for ${result.snapshot.poolAccountId} on ${result.snapshot.chain}. Checking again in ${humanPollDelayLabel(delayMs)}.`,
          silent,
        );
      }
    } catch (error) {
      const latestSnapshot = loadWorkflowSnapshot(workflowId);
      const step =
        latestSnapshot.phase === "awaiting_funding"
          ? "funding"
          : latestSnapshot.phase === "depositing_publicly"
            ? "deposit"
            :
        latestSnapshot.phase === "withdrawing" ||
        latestSnapshot.phase === "approved_ready_to_withdraw"
          ? "withdraw"
          : "inspect_approval";
      const errored = updateSnapshot(latestSnapshot, {
        lastError: buildFlowLastError(step, error),
      });
      await saveWorkflowSnapshotIfChangedWithLock(latestSnapshot, errored);
      throw error;
    }

    await sleep(delayMs);
    delayMs = nextPollDelayMs(delayMs, loadWorkflowSnapshot(workflowId).phase);
  }
}

export function getWorkflowStatus(
  params: StatusFlowParams = {},
): FlowSnapshot {
  return loadWorkflowSnapshot(resolveWorkflowId(params.workflowId));
}

export async function ragequitWorkflow(
  params: RagequitFlowParams,
): Promise<FlowSnapshot> {
  const workflowId = resolveWorkflowId(params.workflowId);
  const releaseLock = acquireProcessLock();
  try {
    const snapshot = loadWorkflowSnapshot(workflowId);
    const silent = params.mode.isQuiet || params.mode.isJson;
    if (!snapshot.depositTxHash || !snapshot.poolAccountId || !snapshot.poolAccountNumber) {
      throw new CLIError(
        "This workflow has not deposited publicly yet.",
        "INPUT",
        "Wait for the funding/deposit step to finish before using 'privacy-pools flow ragequit'.",
      );
    }
    if (
      snapshot.phase === "completed" ||
      snapshot.phase === "completed_public_recovery" ||
      snapshot.phase === "stopped_external"
    ) {
      throw new CLIError(
        "This workflow is already terminal.",
        "INPUT",
        "Run 'privacy-pools flow status' to inspect the saved workflow instead of trying to ragequit it again.",
      );
    }
    if (snapshot.withdrawTxHash && !snapshot.withdrawBlockNumber) {
      throw new CLIError(
        "A relayed withdrawal is already in flight for this workflow.",
        "INPUT",
        "Wait for it to settle, then re-run 'privacy-pools flow watch' or 'privacy-pools flow status' instead of starting a public recovery now.",
      );
    }
    if (snapshot.ragequitTxHash && !snapshot.ragequitBlockNumber) {
      const completed = await awaitPendingRagequitReceipt({
        snapshot,
        globalOpts: params.globalOpts,
        mode: params.mode,
        isVerbose: params.isVerbose,
      });
      const savedCompleted = saveWorkflowSnapshotIfChanged(snapshot, completed);
      cleanupTerminalWorkflowSecret(savedCompleted);
      return savedCompleted;
    }

    const mutationContext = await loadWorkflowPoolAccountContext(
      snapshot,
      params.globalOpts,
      silent,
      false,
    );
    const mutatedSnapshot = saveMutatedWorkflowSnapshot(
      snapshot,
      mutationContext.selectedPoolAccount,
    );
    if (mutatedSnapshot) {
      cleanupTerminalWorkflowSecret(mutatedSnapshot);
      return mutatedSnapshot;
    }

    const ragequitResult = await executeRagequitForFlow({
      snapshot,
      globalOpts: params.globalOpts,
      mode: params.mode,
      isVerbose: params.isVerbose,
    });
    const completed = clearLastError(
      attachRagequitResultToSnapshot(snapshot, {
        chainId: assertWorkflowChain(snapshot).id,
        aspStatus: ragequitResult.aspStatus,
        ragequitTxHash: ragequitResult.ragequitTxHash,
        ragequitBlockNumber: ragequitResult.ragequitBlockNumber,
        ragequitExplorerUrl: ragequitResult.ragequitExplorerUrl,
      }),
    );
    const savedCompleted = saveWorkflowSnapshotIfChanged(snapshot, completed);
    cleanupTerminalWorkflowSecret(savedCompleted);
    return savedCompleted;
  } finally {
    releaseLock();
  }
}
