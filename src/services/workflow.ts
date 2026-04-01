import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  calculateContext,
  generateMerkleProof,
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import type { Address, Hex } from "viem";
import {
  decodeEventLog,
  erc20Abi,
  parseAbi,
  TransactionReceiptNotFoundError,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { explorerTxUrl, isNativePoolAsset } from "../config/chains.js";
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
  writePrivateFileAtomic,
} from "./config.js";
import { resolvePool } from "./pools.js";
import { proveCommitment, proveWithdrawal } from "./proofs.js";
import {
  decodeValidatedRelayerWithdrawalData,
  getRelayerDetails,
  requestQuoteWithExtraGasFallback,
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
import {
  classifyError,
  CLIError,
  sanitizeDiagnosticText,
} from "../utils/errors.js";
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
import {
  describeFlowPrivacyDelayDeadline,
  FLOW_PRIVACY_DELAY_PROFILES,
  type FlowPrivacyDelayProfile,
} from "../utils/flow-privacy-delay.js";
import { validateAddress, parseAmount, resolveChain, validatePositive } from "../utils/validation.js";
import { withProofProgress } from "../utils/proof-progress.js";
import {
  getRelayedWithdrawalRemainderAdvisory,
  refreshExpiredRelayerQuoteForWithdrawal,
  validateRelayerQuoteForWithdrawal,
} from "../commands/withdraw.js";
import { toRagequitSolidityProof } from "../utils/unsigned.js";
import type { GlobalOptions } from "../types.js";
import { assertKnownPoolRoot } from "./pool-roots.js";
import {
  LEGACY_WORKFLOW_SECRET_RECORD_VERSIONS,
  LEGACY_WORKFLOW_SNAPSHOT_VERSIONS,
  WORKFLOW_SECRET_RECORD_VERSION,
  WORKFLOW_SNAPSHOT_VERSION,
} from "./workflow-storage-version.js";

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
const FLOW_PRIVACY_DELAY_BALANCED_MIN_MS = 15 * 60_000;
const FLOW_PRIVACY_DELAY_BALANCED_MAX_MS = 90 * 60_000;
const FLOW_PRIVACY_DELAY_AGGRESSIVE_MIN_MS = 2 * 60 * 60_000;
const FLOW_PRIVACY_DELAY_AGGRESSIVE_MAX_MS = 12 * 60 * 60_000;
const WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_CODE = "WORKFLOW_DEPOSIT_CHECKPOINT_FAILED";
const WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_MESSAGE =
  "Public deposit was submitted, but the workflow could not checkpoint it locally.";
const WORKFLOW_DEPOSIT_CHECKPOINT_AMBIGUOUS_MESSAGE =
  "This workflow may have submitted a public deposit, but the transaction hash was not checkpointed locally.";
const WORKFLOW_WITHDRAW_CHECKPOINT_ERROR_CODE = "WORKFLOW_WITHDRAW_CHECKPOINT_FAILED";
const WORKFLOW_WITHDRAW_CHECKPOINT_AMBIGUOUS_MESSAGE =
  "This workflow may have submitted a relayed withdrawal, but the relay transaction hash was not checkpointed locally.";
const WORKFLOW_RAGEQUIT_CHECKPOINT_ERROR_CODE = "WORKFLOW_RAGEQUIT_CHECKPOINT_FAILED";
const WORKFLOW_RAGEQUIT_CHECKPOINT_AMBIGUOUS_MESSAGE =
  "This workflow may have submitted a public recovery transaction, but the transaction hash was not checkpointed locally.";
const SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS = new Set<string>([
  WORKFLOW_SNAPSHOT_VERSION,
  ...LEGACY_WORKFLOW_SNAPSHOT_VERSIONS,
]);
const SUPPORTED_WORKFLOW_SECRET_RECORD_VERSIONS = new Set<string>([
  WORKFLOW_SECRET_RECORD_VERSION,
  ...LEGACY_WORKFLOW_SECRET_RECORD_VERSIONS,
]);

export type FlowPhase =
  | "awaiting_funding"
  | "depositing_publicly"
  | "awaiting_asp"
  | "approved_waiting_privacy_delay"
  | "approved_ready_to_withdraw"
  | "withdrawing"
  | "completed"
  | "completed_public_recovery"
  | "paused_poi_required"
  | "paused_declined"
  | "stopped_external";

export type FlowWalletMode = "configured" | "new_wallet";
export type FlowPendingSubmission = "withdraw" | "ragequit";
export type { FlowPrivacyDelayProfile } from "../utils/flow-privacy-delay.js";

export interface FlowWarning {
  code: string;
  category: "privacy";
  message: string;
}

const FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE =
  "Privacy delay is disabled for this saved flow. Once approval is observed, flow watch will move toward relayer quote and withdrawal immediately, which may create an off-chain timing signal.";

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
  estimatedCommittedValue?: string | null;
  backupConfirmed?: boolean;
  privacyDelayProfile?: FlowPrivacyDelayProfile;
  privacyDelayConfigured?: boolean;
  approvalObservedAt?: string | null;
  privacyDelayUntil?: string | null;
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
  pendingSubmission?: FlowPendingSubmission | null;
  lastError?: FlowLastError;
}

interface StartFlowParams {
  amountInput: string;
  assetInput: string;
  recipient: string;
  privacyDelayProfile?: string;
  newWallet?: boolean;
  exportNewWallet?: string;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
  watch: boolean;
}

interface WatchFlowParams {
  workflowId?: string;
  privacyDelayProfile?: string;
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

type WorkflowSleepFn = (ms: number) => Promise<void>;
type FlowPrivacyDelaySampler = (
  profile: Exclude<FlowPrivacyDelayProfile, "off">,
) => number;

const DEFAULT_WORKFLOW_SLEEP: WorkflowSleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_WORKFLOW_NOW_MS = () => Date.now();
const DEFAULT_WORKFLOW_PRIVACY_DELAY_SAMPLER: FlowPrivacyDelaySampler = (
  profile,
) => {
  const [minMs, maxMs] =
    profile === "balanced"
      ? [
          FLOW_PRIVACY_DELAY_BALANCED_MIN_MS,
          FLOW_PRIVACY_DELAY_BALANCED_MAX_MS,
        ]
      : [
          FLOW_PRIVACY_DELAY_AGGRESSIVE_MIN_MS,
          FLOW_PRIVACY_DELAY_AGGRESSIVE_MAX_MS,
        ];
  const range = maxMs - minMs;
  return minMs + Math.floor(Math.random() * (range + 1));
};

let workflowSleepFn: WorkflowSleepFn = DEFAULT_WORKFLOW_SLEEP;
let workflowNowMsFn = DEFAULT_WORKFLOW_NOW_MS;
let workflowPrivacyDelaySampler: FlowPrivacyDelaySampler =
  DEFAULT_WORKFLOW_PRIVACY_DELAY_SAMPLER;

export function overrideWorkflowTimingForTests(
  overrides?: {
    sleep?: WorkflowSleepFn;
    nowMs?: () => number;
    samplePrivacyDelayMs?: FlowPrivacyDelaySampler;
  },
): void {
  workflowSleepFn = overrides?.sleep ?? DEFAULT_WORKFLOW_SLEEP;
  workflowNowMsFn = overrides?.nowMs ?? DEFAULT_WORKFLOW_NOW_MS;
  workflowPrivacyDelaySampler =
    overrides?.samplePrivacyDelayMs ?? DEFAULT_WORKFLOW_PRIVACY_DELAY_SAMPLER;
}

function workflowNowMs(): number {
  return workflowNowMsFn();
}

export function pickWorkflowPoolAccount(
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

export function alignSnapshotToPoolAccount(
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
  writePrivateFileAtomic(filePath, JSON.stringify(payload, null, 2));
}

export function writePrivateTextFile(filePath: string, content: string): void {
  try {
    writePrivateFileAtomic(filePath, content);
  } catch (error) {
    throw new CLIError(
      `Could not write workflow wallet backup to ${filePath}.`,
      "INPUT",
      error instanceof Error
        ? `Check that the parent directory exists, the target file does not already exist, and the location is writable. Original error: ${error.message}`
        : "Check that the parent directory exists, the target file does not already exist, and the location is writable.",
    );
  }
}

export function validateWorkflowWalletBackupPath(filePath: string): string {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new CLIError(
      "Workflow wallet backup path cannot be empty.",
      "INPUT",
      "Provide a non-empty file path with --export-new-wallet <path>.",
    );
  }

  const parentDir = dirname(normalizedPath);
  if (!existsSync(parentDir)) {
    throw new CLIError(
      `Workflow wallet backup directory does not exist: ${parentDir}`,
      "INPUT",
      "Create the parent directory first or choose an existing location for --export-new-wallet.",
    );
  }

  let parentStats;
  try {
    parentStats = statSync(parentDir);
  } catch (error) {
    throw new CLIError(
      `Could not inspect workflow wallet backup directory: ${parentDir}`,
      "INPUT",
      error instanceof Error
        ? `Check that ${parentDir} is accessible, then retry. Original error: ${error.message}`
        : `Check that ${parentDir} is accessible, then retry.`,
    );
  }

  if (!parentStats.isDirectory()) {
    throw new CLIError(
      `Workflow wallet backup parent is not a directory: ${parentDir}`,
      "INPUT",
      "Choose a file path whose parent directory already exists.",
    );
  }

  if (!existsSync(normalizedPath)) {
    return normalizedPath;
  }

  let targetStats;
  try {
    targetStats = lstatSync(normalizedPath);
  } catch (error) {
    throw new CLIError(
      `Could not inspect workflow wallet backup target: ${normalizedPath}`,
      "INPUT",
      error instanceof Error
        ? `Check that ${normalizedPath} is accessible, then retry. Original error: ${error.message}`
        : `Check that ${normalizedPath} is accessible, then retry.`,
    );
  }

  if (targetStats.isDirectory()) {
    throw new CLIError(
      `Workflow wallet backup path must point to a file, not a directory: ${normalizedPath}`,
      "INPUT",
      "Choose a file path for --export-new-wallet instead of an existing directory.",
    );
  }

  throw new CLIError(
    `Workflow wallet backup file already exists: ${normalizedPath}`,
    "INPUT",
    "Choose a new --export-new-wallet path or remove the existing file before retrying.",
  );
}

function persistWorkflowSnapshot(snapshot: FlowSnapshot): void {
  ensureWorkflowDir();
  writePrivateJsonFile(getWorkflowFilePath(snapshot.workflowId), snapshot);
}

export function saveWorkflowSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  guardCriticalSection();
  try {
    persistWorkflowSnapshot(snapshot);
  } finally {
    releaseCriticalSection();
  }
  return snapshot;
}

export function saveWorkflowSecretRecord(
  record: FlowSecretRecord,
): FlowSecretRecord {
  guardCriticalSection();
  try {
    ensureWorkflowDir();
    writePrivateJsonFile(getWorkflowSecretFilePath(record.workflowId), record);
  } finally {
    releaseCriticalSection();
  }
  return record;
}

export function deleteWorkflowSecretRecord(workflowId: string): void {
  const filePath = getWorkflowSecretFilePath(workflowId);
  if (!existsSync(filePath)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // Best effort cleanup only.
  }
}

export function loadWorkflowSecretRecord(workflowId: string): FlowSecretRecord {
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

  const schemaVersion = (parsed as FlowSecretRecord).schemaVersion;
  if (
    typeof schemaVersion === "string" &&
    schemaVersion.trim().length > 0 &&
    !SUPPORTED_WORKFLOW_SECRET_RECORD_VERSIONS.has(schemaVersion)
  ) {
    throw new CLIError(
      `Workflow wallet secret uses an unsupported schema version: ${schemaVersion}`,
      "INPUT",
      "Upgrade the CLI to a compatible version, or restore the workflow wallet from a newer backup format.",
    );
  }

  const record = parsed as FlowSecretRecord;
  if (record.workflowId !== workflowId) {
    throw new CLIError(
      `Workflow wallet secret does not match ${workflowId}.`,
      "INPUT",
      "Restore the matching workflow wallet backup, or remove the mismatched secret file and start a new workflow.",
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(record.privateKey)) {
    throw new CLIError(
      `Workflow wallet secret contains an invalid private key: ${filePath}`,
      "INPUT",
      "Restore the workflow wallet backup or remove the broken secret file and start a new workflow.",
    );
  }

  let derivedAddress: Address;
  try {
    derivedAddress = privateKeyToAccount(record.privateKey).address;
  } catch {
    throw new CLIError(
      `Workflow wallet secret contains an unreadable private key: ${filePath}`,
      "INPUT",
      "Restore the workflow wallet backup or remove the broken secret file and start a new workflow.",
    );
  }

  if (derivedAddress.toLowerCase() !== record.walletAddress.toLowerCase()) {
    throw new CLIError(
      `Workflow wallet secret address does not match the stored workflow wallet: ${filePath}`,
      "INPUT",
      "Restore the workflow wallet backup or remove the broken secret file and start a new workflow.",
    );
  }

  return record;
}

export function buildWorkflowWalletBackup(record: FlowSecretRecord): string {
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
  return join(getWorkflowSecretsDir(), `${workflowId}.backup.txt`);
}

function isNewWalletFlow(snapshot: FlowSnapshot): boolean {
  return (snapshot.walletMode ?? "configured") === "new_wallet";
}

export function normalizeWorkflowSnapshot(snapshot: FlowSnapshot): FlowSnapshot {
  return {
    ...snapshot,
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    walletMode: snapshot.walletMode ?? "configured",
    walletAddress: snapshot.walletAddress ?? null,
    assetDecimals: snapshot.assetDecimals ?? null,
    requiredNativeFunding: snapshot.requiredNativeFunding ?? null,
    requiredTokenFunding: snapshot.requiredTokenFunding ?? null,
    estimatedCommittedValue: snapshot.estimatedCommittedValue ?? null,
    backupConfirmed: snapshot.backupConfirmed ?? false,
    privacyDelayProfile: snapshot.privacyDelayProfile ?? "off",
    privacyDelayConfigured: snapshot.privacyDelayConfigured ?? false,
    approvalObservedAt: snapshot.approvalObservedAt ?? null,
    privacyDelayUntil: snapshot.privacyDelayUntil ?? null,
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
    pendingSubmission: snapshot.pendingSubmission ?? null,
  };
}

function comparableWorkflowSnapshot(snapshot: FlowSnapshot): Record<string, unknown> {
  const { updatedAt: _updatedAt, ...rest } = normalizeWorkflowSnapshot(snapshot);
  return rest;
}

export function sameWorkflowSnapshotState(
  left: FlowSnapshot,
  right: FlowSnapshot,
): boolean {
  return (
    JSON.stringify(comparableWorkflowSnapshot(left)) ===
    JSON.stringify(comparableWorkflowSnapshot(right))
  );
}

export function saveWorkflowSnapshotIfChanged(
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

export function cleanupTerminalWorkflowSecret(snapshot: FlowSnapshot): void {
  if (
    isNewWalletFlow(snapshot) &&
    (snapshot.phase === "completed" ||
      snapshot.phase === "completed_public_recovery" ||
      snapshot.phase === "stopped_external")
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

const activeWorkflowOperations = new Set<string>();

async function withWorkflowOperationLock<T>(
  workflowId: string,
  action: "watch" | "ragequit",
  fn: () => Promise<T>,
): Promise<T> {
  if (activeWorkflowOperations.has(workflowId)) {
    throw new CLIError(
      "Another saved workflow operation is already in progress for this workflow.",
      "INPUT",
      `Wait for it to finish before retrying 'privacy-pools flow ${action} ${workflowId}'.`,
    );
  }

  activeWorkflowOperations.add(workflowId);
  try {
    return await fn();
  } finally {
    activeWorkflowOperations.delete(workflowId);
  }
}

export function isTerminalFlowPhase(phase: FlowPhase): boolean {
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

  if (
    typeof snapshot.schemaVersion === "string" &&
    snapshot.schemaVersion.trim().length > 0 &&
    !SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS.has(snapshot.schemaVersion)
  ) {
    throw new CLIError(
      `Workflow file uses an unsupported schema version: ${snapshot.schemaVersion}`,
      "INPUT",
      "Upgrade the CLI to a compatible version, or remove the outdated workflow file if you no longer need it.",
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
  snapshots: Array<{
    snapshot: FlowSnapshot;
    filePath: string;
    fileMtimeMs: number;
  }>;
  invalidFiles: Array<{
    filePath: string;
    fileMtimeMs: number;
  }>;
} {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) {
    return {
      snapshots: [],
      invalidFiles: [],
    };
  }

  const snapshots: Array<{
    snapshot: FlowSnapshot;
    filePath: string;
    fileMtimeMs: number;
  }> = [];
  const invalidFiles: Array<{
    filePath: string;
    fileMtimeMs: number;
  }> = [];
  for (const entry of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const filePath = join(dir, entry);
    const fileMtimeMs = (() => {
      try {
        return statSync(filePath).mtimeMs;
      } catch {
        return Number.POSITIVE_INFINITY;
      }
    })();
    try {
      snapshots.push({
        snapshot: parseWorkflowSnapshot(readFileSync(filePath, "utf-8"), filePath),
        filePath,
        fileMtimeMs,
      });
    } catch {
      invalidFiles.push({ filePath, fileMtimeMs });
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
      const leftTime = Date.parse(
        left.snapshot.updatedAt || left.snapshot.createdAt,
      );
      const rightTime = Date.parse(
        right.snapshot.updatedAt || right.snapshot.createdAt,
      );
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

  const hasUnreadablePotentiallyNewerWorkflow = invalidFiles.some(
    ({ fileMtimeMs }) =>
      !Number.isFinite(fileMtimeMs) || fileMtimeMs >= latest.fileMtimeMs,
  );
  if (hasUnreadablePotentiallyNewerWorkflow) {
    throw new CLIError(
      "Cannot resolve 'latest' because one or more saved workflow files are unreadable and could be newer than the latest readable workflow.",
      "INPUT",
      "Fix or remove the unreadable workflow files, or pass an explicit workflow id instead of 'latest'.",
    );
  }

  return latest.snapshot.workflowId;
}

function resolveWorkflowId(input: string | undefined): string {
  if (!input || input === "latest") {
    return resolveLatestWorkflowId();
  }
  return input;
}

function workflowNow(): string {
  return new Date(workflowNowMs()).toISOString();
}

export function updateSnapshot(
  snapshot: FlowSnapshot,
  patch: Partial<FlowSnapshot>,
): FlowSnapshot {
  return {
    ...snapshot,
    ...patch,
    updatedAt: workflowNow(),
  };
}

export function clearLastError(snapshot: FlowSnapshot): FlowSnapshot {
  if (!snapshot.lastError) return snapshot;
  const { lastError: _lastError, ...rest } = snapshot;
  return {
    ...rest,
    updatedAt: workflowNow(),
  };
}

export function isDepositCheckpointFailure(
  lastError: FlowLastError | undefined,
): boolean {
  if (!lastError || lastError.step !== "deposit") {
    return false;
  }
  if (lastError.errorCode === WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_CODE) {
    return true;
  }

  return (
    lastError.errorMessage.includes("could not checkpoint it locally") ||
    lastError.errorMessage.includes("transaction hash was not checkpointed locally")
  );
}

export function nextPollDelayMs(
  currentDelayMs: number,
  phase: FlowPhase,
): number {
  const maxDelay =
    phase === "awaiting_funding" || phase === "depositing_publicly"
      ? FLOW_FUNDING_POLL_MAX_MS
      : FLOW_POLL_MAX_MS;
  return Math.min(currentDelayMs * 2, maxDelay);
}

export function initialPollDelayMs(phase: FlowPhase): number {
  return phase === "awaiting_funding" || phase === "depositing_publicly"
    ? FLOW_FUNDING_POLL_INITIAL_MS
    : FLOW_POLL_INITIAL_MS;
}

export function humanPollDelayLabel(ms: number): string {
  if (ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${Math.round(ms / 1000)} seconds`;
}

function sleep(ms: number): Promise<void> {
  return workflowSleepFn(ms);
}

export function flowPrivacyDelayProfileSummary(
  profile: FlowPrivacyDelayProfile,
  configured: boolean = true,
): string {
  switch (profile) {
    case "off":
      return configured
        ? "Off (no added hold)"
        : "Off (legacy workflow without a saved privacy-delay policy; behaves like no added hold)";
    case "aggressive":
      return "Aggressive (randomized 2 to 12 hours)";
    default:
      return "Balanced (randomized 15 to 90 minutes)";
  }
}

function flowHasPendingPrivateWithdrawalTarget(
  snapshot: FlowSnapshot,
): boolean {
  return (
    snapshot.phase === "awaiting_funding" ||
    snapshot.phase === "depositing_publicly" ||
    snapshot.phase === "awaiting_asp" ||
    snapshot.phase === "approved_waiting_privacy_delay" ||
    snapshot.phase === "approved_ready_to_withdraw" ||
    snapshot.phase === "paused_poi_required"
  );
}

function getFlowWarningAmount(snapshot: FlowSnapshot): {
  amount: bigint;
  estimated: boolean;
} | null {
  const rawAmount = snapshot.committedValue ?? snapshot.estimatedCommittedValue;
  if (!rawAmount || typeof snapshot.assetDecimals !== "number") {
    return null;
  }

  try {
    return {
      amount: BigInt(rawAmount),
      estimated: snapshot.committedValue == null,
    };
  } catch {
    return null;
  }
}

function buildAmountPatternLinkabilityWarning(
  amount: bigint,
  assetDecimals: number,
  asset: string,
  options: {
    estimated?: boolean;
  } = {},
): FlowWarning | null {
  if (isRoundAmount(amount, assetDecimals, asset)) {
    return null;
  }

  const estimated = options.estimated ?? false;
  const humanAmount = formatAmountDecimal(amount, assetDecimals);
  const suggestions = suggestRoundAmounts(
    amount,
    assetDecimals,
    asset,
    2,
  )
    .map((suggestion) => `${formatAmountDecimal(suggestion, assetDecimals)} ${asset}`)
    .join(" or ");
  const suggestionText = suggestions
    ? ` Consider manual round partial withdrawals such as ${suggestions} if you want better amount privacy.`
    : " Consider manual round partial withdrawals if you want better amount privacy.";
  const amountIntro = estimated
    ? `Estimated net deposited amount is about ${humanAmount} ${asset}, and this saved flow will auto-withdraw that full balance.`
    : `This saved flow will auto-withdraw the full ${humanAmount} ${asset}.`;

  return {
    code: "amount_pattern_linkability",
    category: "privacy",
    message:
      `${amountIntro} That pattern can make the withdrawal more identifiable even though the protocol breaks the direct onchain link.` +
      suggestionText,
  };
}

function buildFlowAmountPrivacyWarning(
  snapshot: FlowSnapshot,
): FlowWarning | null {
  if (!flowHasPendingPrivateWithdrawalTarget(snapshot)) {
    return null;
  }

  const amountInfo = getFlowWarningAmount(snapshot);
  if (!amountInfo) {
    return null;
  }

  const { amount, estimated } = amountInfo;
  return buildAmountPatternLinkabilityWarning(
    amount,
    snapshot.assetDecimals!,
    snapshot.asset,
    { estimated },
  );
}

function buildFlowPrivacyDelayWarning(
  snapshot: FlowSnapshot,
  options: {
    forceConfiguredPrivacyDelayWarning?: boolean;
  } = {},
): FlowWarning | null {
  if (
    (!options.forceConfiguredPrivacyDelayWarning &&
      !flowHasPendingPrivateWithdrawalTarget(snapshot)) ||
    snapshot.privacyDelayProfile !== "off" ||
    snapshot.privacyDelayConfigured !== true
  ) {
    return null;
  }

  return {
    code: "timing_delay_disabled",
    category: "privacy",
    message: FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE,
  };
}

export function buildFlowWarnings(
  snapshot: FlowSnapshot,
  options: {
    forceConfiguredPrivacyDelayWarning?: boolean;
  } = {},
): FlowWarning[] {
  return [
    buildFlowPrivacyDelayWarning(snapshot, options),
    buildFlowAmountPrivacyWarning(snapshot),
  ].filter((warning): warning is FlowWarning => warning !== null);
}

async function confirmHumanFlowStartReview(params: {
  chainName: string;
  pool: WorkflowPool;
  amount: bigint;
  recipient: Address;
  privacyDelayProfile: FlowPrivacyDelayProfile;
  silent: boolean;
  newWallet: boolean;
}): Promise<void> {
  const { chainName, pool, amount, recipient, privacyDelayProfile, silent, newWallet } = params;
  const feeAmount = (amount * pool.vettingFeeBPS) / 10000n;
  const estimatedCommitted = amount - feeAmount;
  const estimatedAmountPatternWarning = buildAmountPatternLinkabilityWarning(
    estimatedCommitted,
    pool.decimals,
    pool.symbol,
    { estimated: true },
  );
  const tokenPrice = deriveTokenPrice(pool);
  const amountUsd = usdSuffix(amount, pool.decimals, tokenPrice);
  const feeUsd = usdSuffix(feeAmount, pool.decimals, tokenPrice);
  const committedUsd = usdSuffix(estimatedCommitted, pool.decimals, tokenPrice);
  const isErc20 = !isNativePoolAsset(resolveChain(chainName).id, pool.asset);

  info(`Recipient: ${formatAddress(recipient)}`, silent);
  info(
    `Vetting fee: ${formatBPS(pool.vettingFeeBPS)} (${formatAmount(feeAmount, pool.decimals, pool.symbol)}${feeUsd})`,
    silent,
  );
  info(
    `Expected net deposited: ~${formatAmount(estimatedCommitted, pool.decimals, pool.symbol)}${committedUsd}`,
    silent,
  );
  info(
    `Auto-withdrawal: This saved flow will privately withdraw the full approved balance of that Pool Account to ${formatAddress(recipient)}. The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.`,
    silent,
  );
  info(
    `Privacy delay: ${flowPrivacyDelayProfileSummary(privacyDelayProfile)}. After approval, flow watch will wait through that window before requesting the private withdrawal.`,
    silent,
  );
  if (privacyDelayProfile === "off") {
    warn(FLOW_PRIVACY_DELAY_DISABLED_WARNING_MESSAGE, silent);
  }
  if (newWallet) {
    info(
      "Wallet setup: This flow will create a dedicated workflow wallet, and you must confirm a backup before funding it.",
      silent,
    );
    if (isErc20) {
      info(
        "Once funded, the workflow wallet will automatically submit the token approval and deposit for you.",
        silent,
      );
    }
  } else if (isErc20) {
    info("This will require 2 transactions: token approval + deposit.", silent);
  }
  if (estimatedAmountPatternWarning) {
    warn(estimatedAmountPatternWarning.message, silent);
    info(
      "A round deposit input can still become a non-round committed balance after the vetting fee is deducted.",
      silent,
    );
  }

  process.stderr.write("\n");
  const { confirm } = await import("@inquirer/prompts");
  const ok = await confirm({
    message:
      `${newWallet ? "Create a dedicated workflow wallet, then " : ""}start flow by depositing ${formatAmount(amount, pool.decimals, pool.symbol)}${amountUsd} on ${chainName}, ` +
      `then privately auto-withdraw the full approved balance to ${formatAddress(recipient)} after approval and the selected privacy delay? The recipient receives the net amount after relayer fees and any ERC20 extra-gas funding.`,
    default: true,
  });
  if (!ok) {
    throw new FlowCancelledError();
  }
}

export function resolveFlowPrivacyDelayProfile(
  input: string | undefined,
  fallback: FlowPrivacyDelayProfile,
): FlowPrivacyDelayProfile {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (
    (FLOW_PRIVACY_DELAY_PROFILES as readonly string[]).includes(normalized)
  ) {
    return normalized as FlowPrivacyDelayProfile;
  }

  throw new CLIError(
    `Unknown flow privacy delay profile: ${input}`,
    "INPUT",
    "Use one of: off, balanced, aggressive.",
  );
}

export function resolveOptionalFlowPrivacyDelayProfile(
  input: string | undefined,
): FlowPrivacyDelayProfile | undefined {
  const normalized = input?.trim();
  if (!normalized) {
    return undefined;
  }
  return resolveFlowPrivacyDelayProfile(normalized, "balanced");
}

export function sampleFlowPrivacyDelayMs(
  profile: Exclude<FlowPrivacyDelayProfile, "off">,
): number {
  return workflowPrivacyDelaySampler(profile);
}

function applyFlowPrivacyDelayPolicy(
  snapshot: FlowSnapshot,
  profile: FlowPrivacyDelayProfile,
  options: {
    configured?: boolean;
    rescheduleApproved?: boolean;
    startAtMs?: number;
  } = {},
): FlowSnapshot {
  const configured = options.configured ?? snapshot.privacyDelayConfigured ?? false;
  const startAtMs = options.startAtMs ?? workflowNowMs();
  const basePatch: Partial<FlowSnapshot> = {
    privacyDelayProfile: profile,
    privacyDelayConfigured: configured,
  };

  if (
    snapshot.phase === "withdrawing" ||
    snapshot.phase === "completed" ||
    snapshot.phase === "completed_public_recovery" ||
    snapshot.phase === "stopped_external"
  ) {
    return snapshot;
  }

  if (
    options.rescheduleApproved &&
    (snapshot.phase === "approved_waiting_privacy_delay" ||
      snapshot.phase === "approved_ready_to_withdraw")
  ) {
    if (profile === "off") {
      return normalizeWorkflowSnapshot(
        clearLastError(
          updateSnapshot(snapshot, {
            ...basePatch,
            phase: "approved_ready_to_withdraw",
            aspStatus: "approved",
            approvalObservedAt: null,
            privacyDelayUntil: null,
          }),
        ),
      );
    }

    const delayMs = sampleFlowPrivacyDelayMs(profile);
    return normalizeWorkflowSnapshot(
      clearLastError(
        updateSnapshot(snapshot, {
          ...basePatch,
          phase: "approved_waiting_privacy_delay",
          aspStatus: "approved",
          approvalObservedAt: new Date(startAtMs).toISOString(),
          privacyDelayUntil: new Date(startAtMs + delayMs).toISOString(),
        }),
      ),
    );
  }

  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        ...basePatch,
        approvalObservedAt: null,
        privacyDelayUntil: null,
      }),
    ),
  );
}

function scheduleApprovedWorkflowPrivacyDelay(
  snapshot: FlowSnapshot,
  startAtMs: number = workflowNowMs(),
): FlowSnapshot {
  if (snapshot.privacyDelayProfile === "off") {
    return normalizeWorkflowSnapshot(
      clearLastError(
        updateSnapshot(snapshot, {
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
          approvalObservedAt: null,
          privacyDelayUntil: null,
        }),
      ),
    );
  }

  const delayMs = sampleFlowPrivacyDelayMs(
    snapshot.privacyDelayProfile as Exclude<FlowPrivacyDelayProfile, "off">,
  );
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        phase: "approved_waiting_privacy_delay",
        aspStatus: "approved",
        approvalObservedAt: new Date(startAtMs).toISOString(),
        privacyDelayUntil: new Date(startAtMs + delayMs).toISOString(),
      }),
    ),
  );
}

export function computeFlowWatchDelayMs(
  snapshot: FlowSnapshot,
  fallbackDelayMs: number,
  nowMs: number = workflowNowMs(),
): number {
  if (
    snapshot.phase !== "approved_waiting_privacy_delay" ||
    !snapshot.privacyDelayUntil
  ) {
    return fallbackDelayMs;
  }

  const deadlineMs = Date.parse(snapshot.privacyDelayUntil);
  if (!Number.isFinite(deadlineMs)) {
    return fallbackDelayMs;
  }

  return Math.max(0, Math.min(deadlineMs - nowMs, FLOW_POLL_MAX_MS));
}

function formatWorkflowFundingSummary(snapshot: FlowSnapshot): string | null {
  const parts: string[] = [];

  if (
    snapshot.requiredTokenFunding &&
    typeof snapshot.assetDecimals === "number"
  ) {
    try {
      parts.push(
        formatAmount(
          BigInt(snapshot.requiredTokenFunding),
          snapshot.assetDecimals,
          snapshot.asset,
        ),
      );
    } catch {
      parts.push(`${snapshot.requiredTokenFunding} ${snapshot.asset}`);
    }
  }

  if (snapshot.requiredNativeFunding) {
    try {
      parts.push(formatAmount(BigInt(snapshot.requiredNativeFunding), 18, "ETH"));
    } catch {
      parts.push(`${snapshot.requiredNativeFunding} ETH`);
    }
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} and ${parts[1]}`;
}

export function classifyFlowMutation(
  current: FlowSnapshot,
  poolAccount: PoolAccountRef | undefined,
): FlowPhase | null {
  const externallyChanged =
    !poolAccount ||
    poolAccount.status === "spent" ||
    poolAccount.status === "exited" ||
    (current.committedValue && poolAccount.value.toString() !== current.committedValue) ||
    (current.depositLabel && poolAccount.label.toString() !== current.depositLabel);

  return externallyChanged ? "stopped_external" : null;
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

export function buildFlowLastError(
  step: string,
  error: unknown,
): FlowLastError {
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

export function getFlowSignerPrivateKey(snapshot: FlowSnapshot): Hex {
  if (isNewWalletFlow(snapshot)) {
    return loadWorkflowSecretRecord(snapshot.workflowId).privateKey;
  }
  return loadPrivateKey();
}

export function getFlowSignerAddress(snapshot: FlowSnapshot): Address {
  return privateKeyToAccount(getFlowSignerPrivateKey(snapshot)).address;
}

export async function getFlowFundingRequirements(params: {
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
  const isNativeAsset = isNativePoolAsset(params.chainConfig.id, params.pool.asset);
  const gasUnits =
    isNativeAsset
      ? FLOW_GAS_NATIVE_DEPOSIT + FLOW_GAS_RAGEQUIT
      : FLOW_GAS_ERC20_APPROVAL + FLOW_GAS_ERC20_DEPOSIT + FLOW_GAS_RAGEQUIT;
  const reserve = gasUnits * bufferedGasPrice * FLOW_GAS_RESERVE_MULTIPLIER;

  return {
    requiredNativeFunding: isNativeAsset ? params.amount + reserve : reserve,
    requiredTokenFunding: isNativeAsset ? null : params.amount,
  };
}

export async function getNextFlowPoolAccountRef(params: {
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
  onDepositPreparing?: (prepared: {
    poolAccountNumber: number;
    poolAccountId: string;
  }) => Promise<void> | void;
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
    onDepositPreparing,
    onDepositSubmitted,
    globalOpts,
    mode,
    isVerbose,
  } = params;
  const silent = mode.isQuiet || mode.isJson;
  const isNative = isNativePoolAsset(chainConfig.id, pool.asset);

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
            `Tx ${approveTx.hash} may still confirm. Re-run the saved workflow to check allowance before depositing again.`,
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
    await onDepositPreparing?.({
      poolAccountNumber: nextPANumber,
      poolAccountId: nextPAId,
    });
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

export function createInitialSnapshot(params: {
  workflowId?: string;
  walletMode?: FlowWalletMode;
  walletAddress?: Address | null;
  assetDecimals?: number | null;
  requiredNativeFunding?: bigint | null;
  requiredTokenFunding?: bigint | null;
  estimatedCommittedValue?: bigint | null;
  backupConfirmed?: boolean;
  privacyDelayProfile?: FlowPrivacyDelayProfile;
  privacyDelayConfigured?: boolean;
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
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId: params.workflowId ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
    phase: params.phase ?? "awaiting_asp",
    walletMode: params.walletMode ?? "configured",
    walletAddress: params.walletAddress ?? null,
    assetDecimals: params.assetDecimals ?? null,
    requiredNativeFunding: params.requiredNativeFunding?.toString() ?? null,
    requiredTokenFunding: params.requiredTokenFunding?.toString() ?? null,
    estimatedCommittedValue: params.estimatedCommittedValue?.toString() ?? null,
    backupConfirmed: params.backupConfirmed ?? false,
    privacyDelayProfile: params.privacyDelayProfile ?? "balanced",
    privacyDelayConfigured: params.privacyDelayConfigured ?? true,
    approvalObservedAt: null,
    privacyDelayUntil: null,
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

export function attachDepositResultToSnapshot(
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
        estimatedCommittedValue: null,
        aspStatus: "pending",
      }),
    ),
  );
}

export function attachPendingDepositToSnapshot(
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

export function attachPendingWithdrawalToSnapshot(
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
        pendingSubmission: null,
      }),
    ),
  );
}

export function attachWithdrawalResultToSnapshot(
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
        pendingSubmission: null,
      }),
    ),
  );
}

export function attachPendingRagequitToSnapshot(
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
        pendingSubmission: null,
      }),
    ),
  );
}

export function attachRagequitResultToSnapshot(
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
        pendingSubmission: null,
      }),
    ),
  );
}

function markPendingSubmission(
  snapshot: FlowSnapshot,
  pendingSubmission: FlowPendingSubmission,
): FlowSnapshot {
  return normalizeWorkflowSnapshot(
    clearLastError(
      updateSnapshot(snapshot, {
        pendingSubmission,
      }),
    ),
  );
}

function clearPendingSubmission(snapshot: FlowSnapshot): FlowSnapshot {
  if (!snapshot.pendingSubmission) {
    return snapshot;
  }

  return normalizeWorkflowSnapshot(
    updateSnapshot(snapshot, {
      pendingSubmission: null,
    }),
  );
}

export async function readFlowFundingState(params: {
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
    isNativePoolAsset(resolveChain(params.snapshot.chain).id, params.pool.asset)
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

async function refreshWorkflowFundingRequirements(params: {
  snapshot: FlowSnapshot;
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  globalOpts?: GlobalOptions;
}): Promise<FlowSnapshot> {
  const { snapshot, chainConfig, pool, globalOpts } = params;
  if (!isNewWalletFlow(snapshot) || snapshot.depositTxHash) {
    return snapshot;
  }

  const refreshedRequirements = await getFlowFundingRequirements({
    chainConfig,
    pool,
    amount: BigInt(snapshot.depositAmount),
    globalOpts,
  });

  return saveWorkflowSnapshotIfChanged(
    snapshot,
    normalizeWorkflowSnapshot(
      updateSnapshot(snapshot, {
        requiredNativeFunding:
          refreshedRequirements.requiredNativeFunding.toString(),
        requiredTokenFunding:
          refreshedRequirements.requiredTokenFunding?.toString() ?? null,
      }),
    ),
  );
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

export async function reconcilePendingDepositReceipt(params: {
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
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return null;
    }
    throw classifyError(error);
  }

  if (!receipt) {
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

export function buildSavedWorkflowRecoveryCommand(snapshot: FlowSnapshot): string {
  return `privacy-pools flow ragequit ${snapshot.workflowId}`;
}

export async function refreshWorkflowAccountStateFromChain(params: {
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
      `Workflow transaction confirmed onchain but local account reconciliation needs a manual refresh: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}`,
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

export async function reconcilePendingWithdrawalReceipt(params: {
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
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return null;
    }
    throw classifyError(error);
  }

  if (!receipt) {
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

export async function reconcilePendingRagequitReceipt(params: {
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
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      try {
        const context = await loadWorkflowPoolAccountContext(
          snapshot,
          globalOpts,
          silent,
          false,
        );
        const mutationPhase = classifyFlowMutation(
          snapshot,
          context.selectedPoolAccount,
        );
        if (mutationPhase) {
          return clearLastError(
            updateSnapshot(snapshot, {
              phase: mutationPhase,
              aspStatus: context.selectedPoolAccount.aspStatus,
            }),
          );
        }
      } catch {
        // If the account cannot be reconciled yet, fall through and keep waiting
        // on the saved transaction hash.
      }
      return null;
    }
    throw classifyError(error);
  }

  if (!receipt) {
    return null;
  }

  if (receipt.status !== "success") {
    throw new CLIError(
      `Previously submitted workflow ragequit reverted: ${snapshot.ragequitTxHash}`,
      "CONTRACT",
      "Inspect the ragequit transaction on a block explorer before retrying 'privacy-pools flow ragequit'.",
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

export async function inspectFundingAndDeposit(params: {
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
        !isDepositCheckpointFailure(currentSnapshot.lastError);
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
          WORKFLOW_DEPOSIT_CHECKPOINT_AMBIGUOUS_MESSAGE,
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

  currentSnapshot = await refreshWorkflowFundingRequirements({
    snapshot: currentSnapshot,
    chainConfig,
    pool,
    globalOpts,
  });

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
          WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_MESSAGE,
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

export async function loadWorkflowPoolAccountContext(
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

export async function executeRelayedWithdrawalForFlow(params: {
  snapshot: FlowSnapshot;
  context: WorkflowPoolAccountContext;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  isVerbose: boolean;
  relayerDetails?: Awaited<ReturnType<typeof getRelayerDetails>>;
}): Promise<{
  withdrawTxHash: string;
  withdrawBlockNumber: string;
  withdrawExplorerUrl: string | null;
}> {
  const { snapshot, context, globalOpts, mode, isVerbose, relayerDetails } = params;
  const silent = mode.isQuiet || mode.isJson;
  const { chainConfig, pool, accountService, publicClient, selectedPoolAccount } =
    context;
  let extraGas = isNativePoolAsset(chainConfig.id, pool.asset) ? false : true;

  const withdrawalAmount = selectedPoolAccount.value;
  validatePositive(withdrawalAmount, "Flow withdrawal amount");

  stageHeader(2, 3, "Requesting relayer quote", silent);
  const withdrawSpin = spinner("Requesting relayer quote...", silent);
  withdrawSpin.start();

  const details =
    relayerDetails ?? (await getRelayerDetails(chainConfig, pool.asset));
  const relayerUrl = details.relayerUrl;
  if (withdrawalAmount < BigInt(details.minWithdrawAmount)) {
    throw new CLIError(
      `Workflow amount is below the relayer minimum of ${formatAmount(BigInt(details.minWithdrawAmount), pool.decimals, pool.symbol)}.`,
      "RELAYER",
      `This workflow only supports relayed private withdrawals. Use '${buildSavedWorkflowRecoveryCommand(snapshot)}' for the public recovery path.`,
      "FLOW_RELAYER_MINIMUM_BLOCKED",
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

  const initialQuoteResult = await requestQuoteWithExtraGasFallback(
    chainConfig,
    {
      amount: withdrawalAmount,
      asset: pool.asset,
      extraGas,
      recipient: snapshot.recipient as Address,
      relayerUrl,
    },
  );
  let quote = initialQuoteResult.quote;
  if (initialQuoteResult.downgradedExtraGas) {
    extraGas = initialQuoteResult.extraGas;
    warn(
      "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
      silent,
    );
  }

  let { quoteFeeBPS, expirationMs } = validateRelayerQuoteForWithdrawal(
    quote,
    pool.maxRelayFeeBPS,
  );

  const fetchFreshQuote = async (reason: string): Promise<void> => {
    withdrawSpin.text = reason;
    const refreshed = await refreshExpiredRelayerQuoteForWithdrawal({
      fetchQuote: async () => {
        const quoteResult = await requestQuoteWithExtraGasFallback(
          chainConfig,
          {
            amount: withdrawalAmount,
            asset: pool.asset,
            extraGas,
            recipient: snapshot.recipient as Address,
            relayerUrl,
          },
        );
        if (quoteResult.downgradedExtraGas) {
          extraGas = quoteResult.extraGas;
          warn(
            "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
            silent,
          );
        }
        return quoteResult.quote;
      },
      maxRelayFeeBPS: pool.maxRelayFeeBPS,
    });
    quote = refreshed.quote;
    quoteFeeBPS = refreshed.quoteFeeBPS;
    expirationMs = refreshed.expirationMs;
  };

  if (workflowNowMs() > expirationMs) {
    await fetchFreshQuote("Quote expired. Refreshing...");
  }

  const stateMerkleProof = generateMerkleProof(
    context.allCommitmentHashes,
    selectedPoolAccount.commitment.hash,
  );
  const aspMerkleProof = generateMerkleProof(
    context.aspLabels,
    selectedPoolAccount.label,
  );

  const { nullifier: newNullifier, secret: newSecret } =
    withSuppressedSdkStdoutSync(() =>
      accountService.createWithdrawalSecrets(selectedPoolAccount.commitment),
    );

  const stateProofRoot = BigInt(
    (stateMerkleProof as { root: bigint | string }).root,
  );
  await assertKnownPoolRoot({
    publicClient,
    poolAddress: pool.pool,
    proofRoot: stateProofRoot,
    message: "Pool data is out of date.",
    hint: "Run 'privacy-pools sync' and retry the workflow watch command.",
  });

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

  const validatedWithdrawalData = decodeValidatedRelayerWithdrawalData({
    quote,
    requestedRecipient: snapshot.recipient as Address,
    quoteFeeBPS,
  });

  const withdrawal = {
    processooor: chainConfig.entrypoint as Address,
    data: validatedWithdrawalData.withdrawalData,
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
        stateRoot: stateProofRoot as unknown as SDKHash,
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

  if (workflowNowMs() > expirationMs) {
    const previousFeeBPS = quote.feeBPS;
    const previousWithdrawalData = withdrawal.data;
    await fetchFreshQuote("Quote expired after proof. Refreshing...");
    if (Number(previousFeeBPS) !== Number(quote.feeBPS)) {
      throw new CLIError(
        `Relayer fee changed during proof generation (${previousFeeBPS} -> ${quote.feeBPS} BPS).`,
        "RELAYER",
        "Re-run 'privacy-pools flow watch' to generate a fresh proof with the new fee.",
      );
    }
    const refreshedWithdrawalData = decodeValidatedRelayerWithdrawalData({
      quote,
      requestedRecipient: snapshot.recipient as Address,
      quoteFeeBPS,
    });
    if (
      refreshedWithdrawalData.withdrawalData.toLowerCase() !==
      previousWithdrawalData.toLowerCase()
    ) {
      throw new CLIError(
        "Relayer withdrawal data changed during proof generation.",
        "RELAYER",
        "Re-run 'privacy-pools flow watch' to generate a fresh proof with the updated relayer data.",
      );
    }
  }

  withdrawSpin.text = "Submitting to relayer...";
  const submissionPendingSnapshot = await saveWorkflowSnapshotIfChangedWithLock(
    snapshot,
    markPendingSubmission(snapshot, "withdraw"),
  );

  let relayResult;
  try {
    relayResult = await submitRelayRequest(chainConfig, {
      scope: pool.scope,
      withdrawal,
      proof: proof.proof,
      publicSignals: proof.publicSignals,
      feeCommitment: quote.feeCommitment,
      relayerUrl: quote.relayerUrl,
    });
  } catch (error) {
    try {
      await saveWorkflowSnapshotIfChangedWithLock(
        submissionPendingSnapshot,
        clearPendingSubmission(submissionPendingSnapshot),
      );
    } catch {
      // Best effort only. The original relay error is more important.
    }
    throw error;
  }

  try {
    await saveWorkflowSnapshotIfChangedWithLock(
      submissionPendingSnapshot,
      attachPendingWithdrawalToSnapshot(
        submissionPendingSnapshot,
        chainConfig.id,
        relayResult.txHash as Hex,
      ),
    );
  } catch {
    throw new CLIError(
      WORKFLOW_WITHDRAW_CHECKPOINT_AMBIGUOUS_MESSAGE,
      "INPUT",
      `Tx ${relayResult.txHash} may still confirm. Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' or inspect 'privacy-pools history --chain ${snapshot.chain}' before retrying 'privacy-pools flow watch'.`,
      WORKFLOW_WITHDRAW_CHECKPOINT_ERROR_CODE,
    );
  }

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
          `Withdrawal confirmed onchain but failed to update local account state immediately: ${sanitizeDiagnosticText(saveError instanceof Error ? saveError.message : String(saveError))}`,
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

export async function continueApprovedWorkflowWithdrawal(params: {
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

  if (snapshot.pendingSubmission === "withdraw" && !snapshot.withdrawTxHash) {
    throw new CLIError(
      WORKFLOW_WITHDRAW_CHECKPOINT_AMBIGUOUS_MESSAGE,
      "INPUT",
      `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' or inspect 'privacy-pools history --chain ${snapshot.chain}' before retrying 'privacy-pools flow watch'.`,
      WORKFLOW_WITHDRAW_CHECKPOINT_ERROR_CODE,
    );
  }

  if (snapshot.withdrawTxHash && !snapshot.withdrawBlockNumber) {
    const silent = mode.isQuiet || mode.isJson;
    try {
      const context = await loadWorkflowPoolAccountContext(
        snapshot,
        globalOpts,
        silent,
        false,
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
        const savedStopped = await saveWorkflowSnapshotIfChangedWithLock(
          snapshot,
          stopped,
        );
        cleanupTerminalWorkflowSecret(savedStopped);
        return {
          snapshot: savedStopped,
          continueWatching: false,
        };
      }
    } catch {
      // Keep waiting on the saved relay hash unless account-state reconciliation
      // positively proves the workflow already mutated externally.
    }
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
    const savedStopped = await saveWorkflowSnapshotIfChangedWithLock(
      snapshot,
      stopped,
    );
    cleanupTerminalWorkflowSecret(savedStopped);
    return {
      snapshot: savedStopped,
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

  const relayerDetails = await getRelayerDetails(
    context.chainConfig,
    context.pool.asset,
  );
  if (
    context.selectedPoolAccount.value < BigInt(relayerDetails.minWithdrawAmount)
  ) {
    throw new CLIError(
      `Workflow amount is below the relayer minimum of ${formatAmount(BigInt(relayerDetails.minWithdrawAmount), context.pool.decimals, context.pool.symbol)}.`,
      "RELAYER",
      `This workflow only supports relayed private withdrawals. Use '${buildSavedWorkflowRecoveryCommand(savedAligned)}' for the public recovery path.`,
      "FLOW_RELAYER_MINIMUM_BLOCKED",
    );
  }

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
    relayerDetails,
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
    throw new CLIError(
      "Unable to verify the original depositor for workflow ragequit.",
      "RPC",
      "Workflow ragequit transactions must be sent by the original deposit address. Retry when RPC access is available.",
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
        commitment.label,
        commitment.nullifier,
        commitment.secret,
      ),
  );

  stageHeader(2, 2, "Submitting ragequit", silent);
  ragequitSpin.text = "Submitting ragequit transaction...";
  const submissionPendingSnapshot = await saveWorkflowSnapshotIfChangedWithLock(
    snapshot,
    markPendingSubmission(snapshot, "ragequit"),
  );

  let tx;
  try {
    tx = await submitRagequit(
      chainConfig,
      pool.pool,
      toRagequitSolidityProof(proof),
      globalOpts?.rpcUrl,
      signerPrivateKey,
    );
  } catch (error) {
    try {
      await saveWorkflowSnapshotIfChangedWithLock(
        submissionPendingSnapshot,
        clearPendingSubmission(submissionPendingSnapshot),
      );
    } catch {
      // Best effort only. Preserve the original ragequit error.
    }
    throw error;
  }

  try {
    await saveWorkflowSnapshotIfChangedWithLock(
      submissionPendingSnapshot,
      attachPendingRagequitToSnapshot(
        submissionPendingSnapshot,
        chainConfig.id,
        tx.hash as Hex,
      ),
    );
  } catch {
    throw new CLIError(
      WORKFLOW_RAGEQUIT_CHECKPOINT_AMBIGUOUS_MESSAGE,
      "INPUT",
      `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' or inspect the deposit wallet before retrying 'privacy-pools flow ragequit'.`,
      WORKFLOW_RAGEQUIT_CHECKPOINT_ERROR_CODE,
    );
  }

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
      type RagequitRecord = Parameters<typeof accountService.addRagequitToAccount>[1];
      const ragequitRecord: RagequitRecord = {
        ragequitter: signerAddress,
        commitment: commitment.hash,
        label: commitment.label,
        value: commitment.value,
        blockNumber: receipt.blockNumber,
        transactionHash: tx.hash as Hex,
      } as unknown as RagequitRecord;
      withSuppressedSdkStdoutSync(() =>
        accountService.addRagequitToAccount(
          commitment.label as unknown as SDKHash,
          ragequitRecord,
        ),
      );
      saveAccount(chainConfig.id, accountService.account);
      saveSyncMeta(chainConfig.id);
    } catch (saveError) {
      warn(
        `Workflow ragequit confirmed onchain but failed to update local account state immediately: ${sanitizeDiagnosticText(saveError instanceof Error ? saveError.message : String(saveError))}`,
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

  ragequitSpin.succeed("Ragequit confirmed.");

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

  const privacyDelayUntilMs =
    snapshot.phase === "approved_waiting_privacy_delay" &&
    snapshot.privacyDelayUntil
      ? Date.parse(snapshot.privacyDelayUntil)
      : Number.NaN;
  const localPrivacyDelayStillActive =
    snapshot.phase === "approved_waiting_privacy_delay" &&
    Number.isFinite(privacyDelayUntilMs) &&
    workflowNowMs() < privacyDelayUntilMs;
  const requireAspData =
    snapshot.phase !== "paused_declined" && !localPrivacyDelayStillActive;
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
    cleanupTerminalWorkflowSecret(mutatedSnapshot);
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

  if (localPrivacyDelayStillActive) {
    const waiting = clearLastError(
      updateSnapshot(savedAligned, {
        phase: "approved_waiting_privacy_delay",
        aspStatus: "approved",
      }),
    );
    return {
      snapshot: saveWorkflowSnapshotIfChanged(savedAligned, waiting),
      continueWatching: true,
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

  if (savedAligned.phase === "approved_waiting_privacy_delay") {
    const privacyDelayUntilMs = savedAligned.privacyDelayUntil
      ? Date.parse(savedAligned.privacyDelayUntil)
      : Number.NaN;
    if (Number.isFinite(privacyDelayUntilMs) && workflowNowMs() < privacyDelayUntilMs) {
      const waiting = clearLastError(
        updateSnapshot(savedAligned, {
          phase: "approved_waiting_privacy_delay",
          aspStatus: "approved",
        }),
      );
      return {
        snapshot: saveWorkflowSnapshotIfChanged(savedAligned, waiting),
        continueWatching: true,
      };
    }
  }

  const ready =
    savedAligned.approvalObservedAt ||
    savedAligned.privacyDelayUntil ||
    savedAligned.phase === "approved_waiting_privacy_delay"
      ? clearLastError(
          updateSnapshot(savedAligned, {
            phase: "approved_ready_to_withdraw",
            aspStatus: "approved",
            approvalObservedAt: savedAligned.approvalObservedAt ?? null,
            privacyDelayUntil: null,
          }),
        )
      : scheduleApprovedWorkflowPrivacyDelay(savedAligned);
  return {
    snapshot: saveWorkflowSnapshotIfChanged(savedAligned, ready),
    continueWatching: true,
  };
}

export async function setupNewWalletWorkflow(params: {
  workflowId: string;
  chainConfig: ReturnType<typeof resolveChain>;
  pool: WorkflowPool;
  amount: bigint;
  recipient: Address;
  privacyDelayProfile: FlowPrivacyDelayProfile;
  exportNewWallet?: string;
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
}): Promise<NewWalletWorkflowSetupResult> {
  const {
    workflowId,
    chainConfig,
    pool,
    amount,
    recipient,
    privacyDelayProfile,
    exportNewWallet,
    globalOpts,
    mode,
  } =
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
  const validatedBackupPath = exportNewWallet?.trim()
    ? validateWorkflowWalletBackupPath(exportNewWallet)
    : null;
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const now = workflowNow();
  let backupPath: string | null = null;
  let backupConfirmedAt: string | undefined;

  const secretRecord: FlowSecretRecord = {
    schemaVersion: WORKFLOW_SECRET_RECORD_VERSION,
    workflowId,
    chain: chainConfig.name,
    walletAddress: account.address,
    privateKey,
    createdAt: now,
  };

  if (skipPrompts) {
    backupPath = validatedBackupPath!;
    writePrivateTextFile(backupPath, buildWorkflowWalletBackup(secretRecord));
    backupConfirmedAt = workflowNow();
  } else {
    process.stderr.write("\n");
    warn("A dedicated workflow wallet was created for this flow.", silent);
    info(`Workflow wallet: ${account.address}`, silent);

    if (validatedBackupPath) {
      backupPath = validatedBackupPath;
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
          { name: "I'll back it up manually", value: "copied" },
        ],
      });

      if (saveAction === "file") {
        backupPath = await input({
          message: "Save location:",
          default: defaultWorkflowWalletBackupPath(workflowId),
        });
        backupPath = validateWorkflowWalletBackupPath(backupPath);
        writePrivateTextFile(
          backupPath,
          buildWorkflowWalletBackup(secretRecord),
        );
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
      privacyDelayProfile,
      privacyDelayConfigured: true,
      chain: chainConfig.name,
      asset: pool.symbol,
      assetDecimals: pool.decimals,
      depositAmount: amount,
      estimatedCommittedValue: amount - (amount * pool.vettingFeeBPS) / 10000n,
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
    privacyDelayProfile,
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
  const resolvedPrivacyDelayProfile = resolveFlowPrivacyDelayProfile(
    privacyDelayProfile,
    "balanced",
  );
  const effectiveWatch = newWallet ? true : watch;

  if (newWallet && skipPrompts && !exportNewWallet?.trim()) {
    throw new CLIError(
      "Non-interactive workflow wallets require --export-new-wallet <path>.",
      "INPUT",
      "Re-run with --export-new-wallet <path> so the new wallet key is backed up before the flow starts.",
    );
  }

  if (!newWallet && exportNewWallet?.trim()) {
    throw new CLIError(
      "--export-new-wallet requires --new-wallet.",
      "INPUT",
      "Re-run with --new-wallet to generate a dedicated workflow wallet, or remove --export-new-wallet.",
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
        `That pattern can make later withdrawals more identifiable even though the protocol breaks the direct onchain link.${suggestionText}`,
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

  if (!skipPrompts) {
    await confirmHumanFlowStartReview({
      chainName: chainConfig.name,
      pool,
      amount,
      recipient: validatedRecipient,
      privacyDelayProfile: resolvedPrivacyDelayProfile,
      silent,
      newWallet,
    });
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
      privacyDelayProfile: resolvedPrivacyDelayProfile,
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
    const configuredWalletAddress = privateKeyToAccount(loadPrivateKey()).address;
    let checkpointedSnapshot: FlowSnapshot | null = null;
    stageHeader(1, effectiveWatch ? 2 : 1, "Submitting deposit", silent);
    try {
      const depositResult = await executeDepositForFlow({
        chainConfig,
        pool,
        amount,
        onDepositPreparing: async (prepared) => {
          if (checkpointedSnapshot) {
            return;
          }

          try {
            checkpointedSnapshot = await withProcessLock(async () =>
              saveWorkflowSnapshot(
                createInitialSnapshot({
                  walletMode: "configured",
                  walletAddress: configuredWalletAddress,
                  chain: chainConfig.name,
                  asset: pool.symbol,
                  assetDecimals: pool.decimals,
                  depositAmount: amount,
                  recipient: validatedRecipient,
                  privacyDelayProfile: resolvedPrivacyDelayProfile,
                  privacyDelayConfigured: true,
                  phase: "depositing_publicly",
                  poolAccountNumber: prepared.poolAccountNumber,
                  poolAccountId: prepared.poolAccountId,
                }),
              ),
            );
          } catch {
            throw new CLIError(
              "Could not save this workflow locally before submitting the public deposit.",
              "INPUT",
              "Fix the workflow directory and retry. No funds were moved.",
            );
          }
        },
        onDepositSubmitted: async (pending) => {
          if (!checkpointedSnapshot) {
            return;
          }
          try {
            checkpointedSnapshot = saveWorkflowSnapshotIfChanged(
              checkpointedSnapshot,
              attachPendingDepositToSnapshot(checkpointedSnapshot, pending),
            );
          } catch {
            throw new CLIError(
              WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_MESSAGE,
              "INPUT",
              `Tx ${pending.depositTxHash} may still confirm. Run 'privacy-pools sync --chain ${chainConfig.name} --asset ${pool.symbol}' or inspect the deposit wallet before retrying 'privacy-pools flow watch'.`,
              WORKFLOW_DEPOSIT_CHECKPOINT_ERROR_CODE,
            );
          }
        },
        globalOpts,
        mode,
        isVerbose,
      });

      if (!checkpointedSnapshot) {
        checkpointedSnapshot = await withProcessLock(async () =>
          saveWorkflowSnapshot(
            createInitialSnapshot({
              walletMode: "configured",
              walletAddress: configuredWalletAddress,
              chain: depositResult.chain,
              asset: depositResult.asset,
              assetDecimals: pool.decimals,
              depositAmount: depositResult.amount,
              recipient: validatedRecipient,
              privacyDelayProfile: resolvedPrivacyDelayProfile,
              privacyDelayConfigured: true,
              phase: "depositing_publicly",
              poolAccountNumber: depositResult.poolAccountNumber,
              poolAccountId: depositResult.poolAccountId,
            }),
          ),
        );
      }

      try {
        snapshot = await withProcessLock(async () =>
          saveWorkflowSnapshotIfChanged(
            checkpointedSnapshot as FlowSnapshot,
            attachDepositResultToSnapshot(
              checkpointedSnapshot as FlowSnapshot,
              depositResult,
            ),
          ),
        );
      } catch {
        throw new CLIError(
          "Deposit succeeded, but the workflow could not finalize its saved state locally.",
          "INPUT",
          `Tx ${depositResult.depositTxHash} is confirmed onchain. Re-run 'privacy-pools flow watch ${(checkpointedSnapshot as FlowSnapshot).workflowId}' after fixing the workflow directory, or continue manually with 'privacy-pools accounts --chain ${depositResult.chain}'.`,
        );
      }
    } catch (error) {
      if (checkpointedSnapshot) {
        try {
          checkpointedSnapshot = await withProcessLock(async () =>
            saveWorkflowSnapshotIfChanged(
              checkpointedSnapshot as FlowSnapshot,
              normalizeWorkflowSnapshot(
                updateSnapshot(checkpointedSnapshot as FlowSnapshot, {
                  lastError: buildFlowLastError("deposit", error),
                }),
              ),
            ),
          );
        } catch {
          // Best effort only. Surface the original error below.
        }
      }
      throw error;
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
  const privacyDelayOverride = resolveOptionalFlowPrivacyDelayProfile(
    params.privacyDelayProfile,
  );

  return withWorkflowOperationLock(workflowId, "watch", async () => {
    let delayMs = initialPollDelayMs(loadWorkflowSnapshot(workflowId).phase);

    while (true) {
      let snapshot = loadWorkflowSnapshot(workflowId);
      let privacyDelayUpdateMessage: string | null = null;
      if (
        privacyDelayOverride &&
        (snapshot.privacyDelayProfile !== privacyDelayOverride ||
          snapshot.privacyDelayConfigured !== true)
      ) {
        const previousProfile = snapshot.privacyDelayProfile ?? "off";
        const previousConfigured = snapshot.privacyDelayConfigured ?? false;
        snapshot = await withProcessLock(async () =>
          saveWorkflowSnapshotIfChanged(
            snapshot,
            applyFlowPrivacyDelayPolicy(snapshot, privacyDelayOverride, {
              configured: true,
              rescheduleApproved: true,
            }),
          ),
        );
        if (
          previousProfile !== snapshot.privacyDelayProfile ||
          previousConfigured !== (snapshot.privacyDelayConfigured ?? false)
        ) {
          if (privacyDelayOverride === "off") {
            privacyDelayUpdateMessage =
              "Saved privacy-delay policy updated to Off (no added hold). Any existing privacy-delay hold was cleared.";
          } else if (snapshot.privacyDelayUntil) {
            const delaySummary =
              describeFlowPrivacyDelayDeadline(snapshot.privacyDelayUntil) ??
              snapshot.privacyDelayUntil;
            privacyDelayUpdateMessage =
              `Saved privacy-delay policy updated from ${flowPrivacyDelayProfileSummary(previousProfile, previousConfigured)} to ${flowPrivacyDelayProfileSummary(snapshot.privacyDelayProfile ?? privacyDelayOverride, snapshot.privacyDelayConfigured ?? true)}. ` +
              `This workflow is now waiting until ${delaySummary}.`;
          } else {
            privacyDelayUpdateMessage =
              `Saved privacy-delay policy updated from ${flowPrivacyDelayProfileSummary(previousProfile, previousConfigured)} to ${flowPrivacyDelayProfileSummary(snapshot.privacyDelayProfile ?? privacyDelayOverride, snapshot.privacyDelayConfigured ?? true)}.`;
          }
        }
      }

      if (privacyDelayUpdateMessage) {
        info(privacyDelayUpdateMessage, silent);
      }

      if (isTerminalFlowPhase(snapshot.phase)) {
        return snapshot;
      }

      let sleepMs = delayMs;
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

        sleepMs = computeFlowWatchDelayMs(result.snapshot, delayMs);

        if (result.snapshot.phase === "awaiting_funding" && result.snapshot.walletAddress) {
          const fundingSummary = formatWorkflowFundingSummary(result.snapshot);
          info(
            fundingSummary
              ? `Still waiting for funding at ${result.snapshot.walletAddress}. Need ${fundingSummary}. Checking again in ${humanPollDelayLabel(sleepMs)}.`
              : `Still waiting for funding at ${result.snapshot.walletAddress}. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
            silent,
          );
        } else if (result.snapshot.phase === "depositing_publicly") {
          info(
            "Still reconciling the public deposit step. Checking again shortly.",
            silent,
          );
        } else if (
          result.snapshot.phase === "approved_waiting_privacy_delay" &&
          result.snapshot.privacyDelayUntil
        ) {
          const delaySummary =
            describeFlowPrivacyDelayDeadline(result.snapshot.privacyDelayUntil) ??
            result.snapshot.privacyDelayUntil;
          info(
            `ASP approval is confirmed, and this workflow is waiting until ${delaySummary} before requesting the private withdrawal. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
            silent,
          );
        } else {
          info(
            `Still waiting for ASP approval for ${result.snapshot.poolAccountId} on ${result.snapshot.chain}. Checking again in ${humanPollDelayLabel(sleepMs)}.`,
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
        const flowLastError = buildFlowLastError(step, error);
        const errored = updateSnapshot(latestSnapshot, {
          lastError: flowLastError,
        });
        try {
          await saveWorkflowSnapshotIfChangedWithLock(latestSnapshot, errored);
        } catch {
          // Best effort only. Preserve the original workflow error when the
          // workflow directory itself is the thing that is failing.
        }
        if (flowLastError.retryable) {
          let retrySnapshot = latestSnapshot;
          try {
            retrySnapshot = loadWorkflowSnapshot(workflowId);
          } catch {
            // Fall back to the in-memory snapshot when the saved workflow cannot
            // be reloaded yet.
          }
          const retrySleepMs = computeFlowWatchDelayMs(
            retrySnapshot,
            nextPollDelayMs(delayMs, retrySnapshot.phase),
          );
          warn(
            `Temporary issue while resuming this workflow: ${flowLastError.errorMessage} Retrying in ${humanPollDelayLabel(retrySleepMs)}.`,
            silent,
          );
          if (retrySleepMs > 0) {
            await sleep(retrySleepMs);
          }
          delayMs = retrySleepMs;
          continue;
        }
        throw error;
      }

      if (sleepMs > 0) {
        await sleep(sleepMs);
      }
      delayMs = nextPollDelayMs(delayMs, loadWorkflowSnapshot(workflowId).phase);
    }
  });
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
  return withWorkflowOperationLock(workflowId, "ragequit", async () => {
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
      if (snapshot.pendingSubmission === "ragequit" && !snapshot.ragequitTxHash) {
        throw new CLIError(
          WORKFLOW_RAGEQUIT_CHECKPOINT_AMBIGUOUS_MESSAGE,
          "INPUT",
          `Run 'privacy-pools sync --chain ${snapshot.chain} --asset ${snapshot.asset}' or inspect the deposit wallet before retrying 'privacy-pools flow ragequit'.`,
          WORKFLOW_RAGEQUIT_CHECKPOINT_ERROR_CODE,
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
  });
}
