import type { Command } from "commander";
import {
  generateMerkleProof,
  calculateContext,
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import { formatUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  resolveChain,
  lookupEnsNameForAddress,
  parseAmount,
  validatePositive,
} from "../utils/validation.js";
import {
  assertSafeRecipientAddress,
  isKnownRecipient,
  newRecipientWarning,
  resolveSafeRecipientAddressOrEns,
  type RecipientSafetyWarning,
} from "../utils/recipient-safety.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getPublicClient, getDataService } from "../services/sdk.js";
import {
  deriveWithdrawalTreeDepths,
  proveWithdrawal,
} from "../services/proofs.js";
import { withdrawDirect } from "../services/contracts.js";
import {
  initializeAccountService,
  saveAccount,
  saveSyncMeta,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { accountHasDeposits } from "../services/account-storage.js";
import { resolvePool, listPools } from "../services/pools.js";
import {
  loadRecipientHistoryEntries,
  loadKnownRecipientHistory,
  type RecipientHistoryEntry,
} from "../services/recipient-history.js";
import {
  getWorkflowStatus,
  listSavedWorkflowIds,
} from "../services/workflow.js";
import {
  buildLoadedAspDepositReviewState,
  fetchMerkleRoots,
  fetchMerkleLeaves,
  fetchDepositsLargerThan,
  fetchDepositReviewStatuses,
} from "../services/asp.js";
import {
  decodeValidatedRelayerWithdrawalData,
  getRelayerDetails,
  requestQuoteWithExtraGasFallback,
  submitRelayRequest,
} from "../services/relayer.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "../utils/approval-timing.js";
import {
  spinner,
  warnSpinner,
  info,
  warn,
  verbose,
  formatAmount,
  formatAddress,
  formatBPS,
  formatUsdValue,
  deriveTokenPrice,
  usdSuffix,
  displayDecimals,
  formatRemainingTime,
} from "../utils/format.js";
import {
  accountNotApprovedError,
  printError,
  CLIError,
  promptCancelledError,
} from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { emitStreamJsonEvent } from "../utils/stream-json.js";
import { selectBestWithdrawalCommitment } from "../utils/withdrawal.js";
import {
  resolveAmountAndAssetInput,
  isPercentageAmount,
} from "../utils/positional.js";
import { writeWithdrawalPrivacyTip } from "../utils/amount-privacy.js";
import {
  printRawTransactions,
  stringifyBigInts,
  toWithdrawSolidityProof,
} from "../utils/unsigned.js";
import {
  buildUnsignedDirectWithdrawOutput,
  buildUnsignedRelayedWithdrawOutput,
} from "../utils/unsigned-flows.js";
import { explorerTxUrl, isNativePoolAsset, POA_PORTAL_URL } from "../config/chains.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import type {
  ChainConfig,
  GlobalOptions,
  NextAction,
  PoolStats,
  RelayerQuoteResponse,
} from "../types.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import { createNextAction, createOutputContext } from "../output/common.js";
import {
  formatAnonymitySetCallout,
  formatAnonymitySetValue,
  formatDirectWithdrawalReview,
  formatRelayedWithdrawalReview,
  type RelayedWithdrawalRemainderGuidance,
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  renderWithdrawQuote,
  type WithdrawAnonymitySet,
  type WithdrawUiWarning,
} from "../output/withdraw.js";
import {
  CONFIRMATION_TOKENS,
  confirmPrompt,
  confirmActionWithSeverity,
  formatPoolAccountPromptChoice,
  formatPoolPromptChoice,
  inputPrompt,
  isHighStakesWithdrawal,
  selectPrompt,
} from "../utils/prompts.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
import {
  createNarrativeProgressWriter,
  createNarrativeSteps,
} from "../output/progress.js";
import {
  maybeRecoverMissingWalletSetup,
  normalizeInitRequiredInputError,
} from "../utils/setup-recovery.js";
import { maybeLaunchBrowser } from "../utils/web.js";
import {
  assertKnownPoolRoot,
  poolRootCacheScopeKey,
} from "../services/pool-roots.js";
import { acquireProcessLock } from "../utils/lock.js";
import { persistWithReconciliation } from "../services/persist-with-reconciliation.js";
import { createSubmissionRecord } from "../services/submissions.js";
import {
  buildAllPoolAccountRefs,
  buildPoolAccountRefs,
  collectActiveLabels,
  describeUnavailablePoolAccount,
  getUnknownPoolAccountError,
  parsePoolAccountSelector,
  type PoolAccountRef,
} from "../utils/pool-accounts.js";
import { type AspApprovalStatus } from "../utils/statuses.js";
import {
  buildDirectRecipientMismatchNextActions as buildDirectRecipientMismatchNextActionsHelper,
  buildRemainderBelowMinNextActions as buildRemainderBelowMinNextActionsHelper,
  buildWithdrawQuoteWarnings as buildWithdrawQuoteWarningsHelper,
  formatApprovalResolutionHint as formatApprovalResolutionHintHelper,
  formatRelayedWithdrawalRemainderHint as formatRelayedWithdrawalRemainderHintHelper,
  getRelayedWithdrawalRemainderAdvisory as getRelayedWithdrawalRemainderAdvisoryHelper,
  getSuspiciousTestnetMinWithdrawFloor as getSuspiciousTestnetMinWithdrawFloorHelper,
  normalizeRelayerQuoteExpirationMs as normalizeRelayerQuoteExpirationMsHelper,
  refreshExpiredRelayerQuoteForWithdrawal as refreshExpiredRelayerQuoteForWithdrawalHelper,
  relayerHostLabel as relayerHostLabelHelper,
  validateRelayerQuoteForWithdrawal as validateRelayerQuoteForWithdrawalHelper,
} from "./withdraw/quote.js";
import {
  collectKnownWithdrawalRecipients as collectKnownWithdrawalRecipientsHelper,
  collectKnownWorkflowRecipients as collectKnownWorkflowRecipientsHelper,
  confirmRecipientIfNew as confirmRecipientIfNewHelper,
  rememberSuccessfulWithdrawalRecipient as rememberSuccessfulWithdrawalRecipientHelper,
  validateRecipientAddressOrEnsInput as validateRecipientAddressOrEnsInputHelper,
} from "./withdraw/recipients.js";
import {
  getEligibleUnapprovedStatuses as getEligibleUnapprovedStatusesHelper,
  resolveRequestedWithdrawalPoolAccountOrThrow as resolveRequestedWithdrawalPoolAccountOrThrowHelper,
} from "./withdraw/pool-accounts.js";

const entrypointLatestRootAbi = [
  {
    name: "latestRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const RELAYER_PROOF_REFRESH_BUDGET_SECONDS = 12;
const LOCAL_STATE_RECONCILIATION_WARNING_CODE =
  "LOCAL_STATE_RECONCILIATION_REQUIRED";
const CONFIRM_DIRECT_WITHDRAW_DEPRECATION_WARNING = {
  code: "FLAG_DEPRECATED",
  message:
    "--confirm-direct-withdraw is deprecated. Replaced by interactive confirmation. Will be removed in v3.x.",
  replacementCommand: "Remove --confirm-direct-withdraw and confirm the direct withdrawal interactively, or use --agent for explicit non-interactive consent.",
};

function withDirectConfirmDeprecationWarning(
  error: unknown,
  warning: typeof CONFIRM_DIRECT_WITHDRAW_DEPRECATION_WARNING | undefined,
): unknown {
  if (!warning || !(error instanceof CLIError)) return error;
  return new CLIError(
    error.message,
    error.category,
    error.hint,
    error.code,
    error.retryable,
    error.presentation,
    { ...(error.details ?? {}), deprecationWarning: warning },
    error.docsSlug,
    error.extra,
  );
}

type WithdrawReviewStatus = Exclude<AspApprovalStatus, "approved">;

interface WithdrawCommandOptions {
  to?: string;
  poolAccount?: string;
  direct?: boolean;
  confirmDirectWithdraw?: boolean;
  unsigned?: boolean | string;
  dryRun?: boolean;
  noWait?: boolean;
  all?: boolean;
  acceptAllFundsPublic?: boolean;
  extraGas?: boolean;
  streamJson?: boolean;
}

export function relayerHostLabel(relayerUrl: string | undefined): string | null {
  return relayerHostLabelHelper(relayerUrl);
}

export function getSuspiciousTestnetMinWithdrawFloor(decimals: number): bigint {
  return getSuspiciousTestnetMinWithdrawFloorHelper(decimals);
}

export function buildWithdrawQuoteWarnings(params: {
  chainIsTestnet: boolean;
  assetSymbol: string;
  minWithdrawAmount: bigint;
  decimals: number;
}): WithdrawUiWarning[] {
  return buildWithdrawQuoteWarningsHelper(params);
}

export async function fetchWithdrawalAnonymitySet(
  chainConfig: ChainConfig,
  pool: PoolStats,
  amount: bigint,
): Promise<WithdrawAnonymitySet | undefined> {
  try {
    const anonSet = await fetchDepositsLargerThan(
      chainConfig,
      pool.scope,
      amount,
    );
    return {
      eligible: anonSet.eligibleDeposits,
      total: anonSet.totalDeposits,
      percentage: Number(anonSet.percentage.toFixed(1)),
    };
  } catch {
    return undefined;
  }
}

export function writeWithdrawalAnonymitySetHint(
  anonymitySet: WithdrawAnonymitySet | undefined,
  silent: boolean,
): void {
  if (silent || !anonymitySet) {
    return;
  }
  process.stderr.write(formatAnonymitySetCallout(anonymitySet));
}

function createAnonymitySetAmountTransformer(params: {
  chainConfig: ChainConfig;
  pool: PoolStats;
  silent: boolean;
}): (value: string, context: { isFinal: boolean }) => string {
  let timer: NodeJS.Timeout | null = null;
  let requestId = 0;
  let lastRendered = "";
  let hasRenderedHint = false;

  return (value, context) => {
    if (params.silent || context.isFinal) {
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || isPercentageAmount(trimmed)) {
      return value;
    }
    if (timer) {
      clearTimeout(timer);
    }
    const currentRequest = ++requestId;
    timer = setTimeout(() => {
      let parsed: bigint;
      try {
        parsed = parseAmount(trimmed, params.pool.decimals, {
          allowNegative: true,
        });
        validatePositive(parsed, "Withdrawal amount");
      } catch {
        return;
      }
      void fetchWithdrawalAnonymitySet(params.chainConfig, params.pool, parsed)
        .then((anonymitySet) => {
          if (
            currentRequest !== requestId ||
            !anonymitySet ||
            trimmed === lastRendered
          ) {
            return;
          }
          lastRendered = trimmed;
          const line =
            `Estimated anonymity set: ${formatAnonymitySetValue(anonymitySet)}`;
          if (hasRenderedHint && process.stderr.isTTY) {
            process.stderr.write("\x1b[1A\x1b[2K");
          } else {
            process.stderr.write("\n");
          }
          process.stderr.write(`${line}\n`);
          hasRenderedHint = true;
        })
        .catch(() => undefined);
    }, 1500);
    return value;
  };
}

async function promptWithdrawalAmountEdit(params: {
  message: string;
  chainConfig: ChainConfig;
  pool: PoolStats;
  currentAmount?: bigint;
  maxAmount: bigint;
  minAmount?: bigint;
  leaveAtLeast?: bigint;
  poolAccountId: string;
  silent: boolean;
}): Promise<bigint> {
  const input = await inputPrompt({
    message: params.message,
    default: params.currentAmount
      ? formatUnits(params.currentAmount, params.pool.decimals)
      : undefined,
    transformer: createAnonymitySetAmountTransformer({
      chainConfig: params.chainConfig,
      pool: params.pool,
      silent: params.silent,
    }),
    validate: (value) => {
      try {
        const parsed = parseAmount(value.trim(), params.pool.decimals, {
          allowNegative: true,
        });
        validatePositive(parsed, "Withdrawal amount");
        if (params.minAmount !== undefined && parsed < params.minAmount) {
          return `Amount must be at least ${formatAmount(params.minAmount, params.pool.decimals, params.pool.symbol)}.`;
        }
        if (parsed > params.maxAmount) {
          return `Amount exceeds ${params.poolAccountId} balance of ${formatAmount(params.maxAmount, params.pool.decimals, params.pool.symbol)}.`;
        }
        if (
          params.leaveAtLeast !== undefined &&
          params.maxAmount - parsed < params.leaveAtLeast
        ) {
          return `Amount must leave at least ${formatAmount(params.leaveAtLeast, params.pool.decimals, params.pool.symbol)} in ${params.poolAccountId}.`;
        }
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid amount.";
      }
    },
  });
  return parseAmount(input.trim(), params.pool.decimals, {
    allowNegative: true,
  });
}

function writeQuoteCountdown(expirationMs: number, silent: boolean): void {
  if (silent) {
    return;
  }
  const secondsLeft = Math.max(0, Math.floor((expirationMs - Date.now()) / 1000));
  process.stderr.write(
    `Relayer quote expires in ${secondsLeft}s. You can request a new quote from the review prompt.\n`,
  );
}

export function buildDirectRecipientMismatchNextActions(params: {
  amountInput: string;
  assetInput: string | null;
  chainName: string;
  recipientAddress: Address;
  signerAddress: Address;
}): NextAction[] {
  return buildDirectRecipientMismatchNextActionsHelper(params);
}

export function buildRemainderBelowMinNextActions(params: {
  chainName: string;
  asset: string;
  decimals: number;
  recipient: Address;
  poolAccountId: string;
  poolAccountValue: bigint;
  minWithdrawAmount: bigint;
  signerAddress: Address | null;
}): NextAction[] {
  return buildRemainderBelowMinNextActionsHelper(params);
}

interface WithdrawQuoteCommandOptions {
  to?: string;
}

interface ApprovalResolutionHintParams {
  chainName: string;
  assetSymbol: string;
  poolAccountId?: string;
  status?: WithdrawReviewStatus;
}

interface RelayedWithdrawalRemainderAdvisoryParams {
  remainingBalance: bigint;
  minWithdrawAmount: bigint;
  poolAccountId: string;
  assetSymbol: string;
  decimals: number;
  poolAccountValue?: bigint;
  chainName?: string;
  recipient?: Address;
}

interface ValidatedRelayerQuoteForWithdrawal {
  quoteFeeBPS: bigint;
  expirationMs: number;
}

interface RefreshExpiredRelayerQuoteForWithdrawalParams {
  fetchQuote: () => Promise<RelayerQuoteResponse>;
  maxRelayFeeBPS: bigint | string;
  nowMs?: () => number;
  maxAttempts?: number;
  onRetry?: (attempt: number, maxAttempts: number) => void;
}

interface RefreshedRelayerQuoteForWithdrawal
  extends ValidatedRelayerQuoteForWithdrawal {
  quote: RelayerQuoteResponse;
  attempts: number;
}

interface RequestedWithdrawalPoolAccountParams {
  requestedPoolAccounts: readonly PoolAccountRef[];
  allPoolAccounts: readonly PoolAccountRef[];
  fromPaNumber: number;
  chainName: string;
  symbol: string;
}

const MAX_RECIPIENT_PROMPT_ATTEMPTS = 5;
const MAX_WITHDRAW_CONFIRM_REVIEW_ATTEMPTS = 5;

export { createWithdrawCommand } from "../command-shells/withdraw.js";

export function validateRecipientAddressOrEnsInput(value: string): true | string {
  return validateRecipientAddressOrEnsInputHelper(value);
}

function recentRecipientDescription(entry: RecipientHistoryEntry): string {
  return [
    entry.ensName,
    entry.chain,
    entry.useCount > 0 ? `${entry.useCount} use${entry.useCount === 1 ? "" : "s"}` : null,
  ].filter(Boolean).join(" - ");
}

export async function promptRecentRecipientAddressOrEns(): Promise<{
  address: Address;
  ensName?: string;
} | null> {
  const entries = loadRecipientHistoryEntries().slice(0, 5);
  if (entries.length === 0) return null;

  const newRecipientValue = "__privacy_pools_new_recipient__";
  const manageRecipientsValue = "__privacy_pools_manage_recipients__";
  const selected = await selectPrompt<string>({
    message: "Recipient:",
    choices: [
      ...entries.map((entry) => ({
        name: entry.label
          ? `${entry.label} (${formatAddress(entry.address)})`
          : `${entry.source === "manual" ? "Saved" : "Recent"} ${formatAddress(entry.address)}`,
        value: entry.address,
        description: recentRecipientDescription(entry),
      })),
      {
        name: "Enter a new recipient",
        value: newRecipientValue,
        description: "Type an address or ENS name.",
      },
      {
        name: "Manage saved recipients...",
        value: manageRecipientsValue,
        description: "Exit this flow and open the recipients command.",
      },
    ],
  });

  if (selected === newRecipientValue) return null;
  if (selected === manageRecipientsValue) {
    info("Manage saved recipients with 'privacy-pools recipients'.", false);
    throw promptCancelledError();
  }
  const entry = entries.find(
    (candidate) => candidate.address.toLowerCase() === selected.toLowerCase(),
  );
  return {
    address: selected as Address,
    ...(entry?.ensName ? { ensName: entry.ensName } : {}),
  };
}

async function promptRecipientAddressOrEns(
  silent: boolean,
): Promise<{ address: Address; ensName?: string }> {
  const remembered = await promptRecentRecipientAddressOrEns();
  if (remembered) {
    if (remembered.ensName) {
      info(`Using remembered recipient ${remembered.ensName} -> ${remembered.address}`, silent);
    } else {
      info(`Using remembered recipient ${remembered.address}`, silent);
    }
    return remembered;
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RECIPIENT_PROMPT_ATTEMPTS; attempt += 1) {
    const prompted = (await inputPrompt({
      message: "Recipient address or ENS:",
      validate: validateRecipientAddressOrEnsInput,
    })).trim();
    try {
      const resolved = await resolveSafeRecipientAddressOrEns(
        prompted,
        "Recipient",
      );
      let ensName = resolved.ensName;
      if (!ensName) {
        ensName = await lookupEnsNameForAddress(resolved.address);
      }
      if (ensName) {
        if (resolved.ensName) {
          info(`Resolved ${ensName} -> ${resolved.address}`, silent);
        } else {
          info(`Recognized ENS ${ensName} for ${resolved.address}`, silent);
        }
      }
      return { address: resolved.address, ensName };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RECIPIENT_PROMPT_ATTEMPTS) {
        break;
      }
      warn(error instanceof Error ? error.message : "Invalid address or ENS name.", silent);
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new CLIError(
    "Invalid address or ENS name.",
    "INPUT",
    "Re-run with --to <address-or-ens> to skip the interactive recipient prompt.",
    "INPUT_RECIPIENT_RETRY_LIMIT",
  );
}

export async function deriveNativeGasTokenPrice(
  chainConfig: ChainConfig,
  rpcUrl: string | undefined,
  selectedPool: PoolStats,
): Promise<number | null> {
  if (isNativePoolAsset(chainConfig.id, selectedPool.asset)) {
    return deriveTokenPrice(selectedPool);
  }

  try {
    const pools = await listPools(chainConfig, rpcUrl);
    const nativePool = pools.find((pool) =>
      isNativePoolAsset(chainConfig.id, pool.asset)
    );
    return nativePool ? deriveTokenPrice(nativePool) : null;
  } catch {
    return null;
  }
}

export async function confirmRecipientIfNew(params: {
  address: string;
  knownRecipients: readonly string[];
  skipPrompts: boolean;
  silent: boolean;
}): Promise<RecipientSafetyWarning[]> {
  if (!isKnownRecipient(params.address, params.knownRecipients)) {
    const warning = newRecipientWarning(params.address);
    if (!params.skipPrompts) {
      warn(warning.message, params.silent);
    }
  }
  return await confirmRecipientIfNewHelper(params);
}

export function collectKnownWorkflowRecipients(): string[] {
  return collectKnownWorkflowRecipientsHelper();
}

export function collectKnownWithdrawalRecipients(
  signerAddress: Address | null,
): string[] {
  return collectKnownWithdrawalRecipientsHelper(signerAddress);
}

export function rememberSuccessfulWithdrawalRecipient(
  address: string,
  metadata: {
    ensName?: string | null;
    chain?: string | null;
    label?: string | null;
  } = {},
): void {
  rememberSuccessfulWithdrawalRecipientHelper(address, metadata);
}

export async function withSuspendedSpinner<T>(
  spin: ReturnType<typeof spinner>,
  task: () => Promise<T>,
): Promise<T> {
  const wasSpinning = spin.isSpinning;
  if (wasSpinning) {
    spin.stop();
  }
  try {
    return await task();
  } finally {
    if (wasSpinning) {
      spin.start();
    }
  }
}

export function getEligibleUnapprovedStatuses(
  poolAccounts: readonly PoolAccountRef[],
  withdrawalAmount: bigint,
): WithdrawReviewStatus[] {
  return getEligibleUnapprovedStatusesHelper(poolAccounts, withdrawalAmount);
}

export function formatApprovalResolutionHint(
  params: ApprovalResolutionHintParams,
): string {
  return formatApprovalResolutionHintHelper(params);
}

export function getRelayedWithdrawalRemainderAdvisory(
  params: RelayedWithdrawalRemainderAdvisoryParams,
): RelayedWithdrawalRemainderGuidance | null {
  return getRelayedWithdrawalRemainderAdvisoryHelper(params);
}

export function formatRelayedWithdrawalRemainderHint(
  guidance: RelayedWithdrawalRemainderGuidance,
): string {
  return formatRelayedWithdrawalRemainderHintHelper(guidance);
}

export function normalizeRelayerQuoteExpirationMs(expiration: number): number {
  return normalizeRelayerQuoteExpirationMsHelper(expiration);
}

export function validateRelayerQuoteForWithdrawal(
  quote: Pick<RelayerQuoteResponse, "feeBPS" | "feeCommitment">,
  maxRelayFeeBPS: bigint | string,
): ValidatedRelayerQuoteForWithdrawal {
  return validateRelayerQuoteForWithdrawalHelper(quote, maxRelayFeeBPS);
}

export async function refreshExpiredRelayerQuoteForWithdrawal(
  params: RefreshExpiredRelayerQuoteForWithdrawalParams,
): Promise<RefreshedRelayerQuoteForWithdrawal> {
  return await refreshExpiredRelayerQuoteForWithdrawalHelper(params);
}

export function resolveRequestedWithdrawalPoolAccountOrThrow(
  params: RequestedWithdrawalPoolAccountParams,
): PoolAccountRef {
  return resolveRequestedWithdrawalPoolAccountOrThrowHelper(params);
}

export async function handleWithdrawCommand(
  firstArg: string | undefined,
  secondArg: string | undefined,
  opts: WithdrawCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const streamJson = opts.streamJson === true;
  const mode = resolveGlobalMode({
    ...globalOpts,
    ...(streamJson ? { json: true } : {}),
  });
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const unsignedRaw = opts.unsigned;
  const isUnsigned = unsignedRaw === true || typeof unsignedRaw === "string";
  const unsignedFormat =
    typeof unsignedRaw === "string" ? unsignedRaw.toLowerCase() : undefined;
  const wantsTxFormat = unsignedFormat === "tx";
  const isDryRun = opts.dryRun ?? false;
  const silent = isQuiet || isJson || isUnsigned || isDryRun;
  const advisorySilent = isQuiet || isJson || isUnsigned;
  const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
  const isVerbose = globalOpts?.verbose ?? false;
  const isDirect = opts.direct ?? false;
  const directConfirmDeprecationWarning =
    opts.confirmDirectWithdraw === true
      ? CONFIRM_DIRECT_WITHDRAW_DEPRECATION_WARNING
      : undefined;
  const confirmationTimeoutSeconds = Math.round(
    getConfirmationTimeoutMs() / 1000,
  );
  const fromPaRaw = opts.poolAccount;
  const fromPaNumber =
    fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);
  const writeWithdrawNarrative = createNarrativeProgressWriter({ silent });
  const writeWithdrawProgress = (activeIndex: number, note?: string) => {
    const labels = isDirect
      ? [
          "Account & ASP data synced",
          "Generate and verify withdrawal proof",
          "Submit withdrawal",
        ]
      : [
          "Account & ASP data synced",
          "Request relayer quote",
          "Generate and verify withdrawal proof",
          "Submit to relayer",
        ];
    writeWithdrawNarrative(createNarrativeSteps(labels, activeIndex, note));
  };

  try {
    emitStreamJsonEvent(streamJson, {
      mode: "withdraw-progress",
      operation: "withdraw",
      event: "stage",
      stage: "validating_input",
    });
    if (fromPaRaw !== undefined && fromPaNumber === null) {
      throw new CLIError(
        `Invalid --pool-account value: ${fromPaRaw}.`,
        "INPUT",
        "Use a Pool Account identifier like PA-2 (or just 2).",
      );
    }

    if (
      unsignedFormat &&
      unsignedFormat !== "envelope" &&
      unsignedFormat !== "tx"
    ) {
      throw new CLIError(
        `Unsupported unsigned format: "${unsignedFormat}".`,
        "INPUT",
        "Use --unsigned envelope or --unsigned tx.",
      );
    }
    if (opts.noWait && isDryRun) {
      throw new CLIError(
        "--no-wait cannot be combined with --dry-run.",
        "INPUT",
        "Use --dry-run to preview only, or remove --dry-run to submit without waiting for confirmation.",
      );
    }
    if (opts.noWait && isUnsigned) {
      throw new CLIError(
        "--no-wait cannot be combined with --unsigned.",
        "INPUT",
        "Use --unsigned to build an offline envelope, or remove --unsigned to submit and return immediately.",
      );
    }
    if (!isQuiet && !isJson) {
      if (isDryRun) {
        info("Dry-run mode: previewing only; no transaction will be signed or submitted.", false);
      }
    }

    if (await maybeRenderPreviewScenario("withdraw")) {
      return;
    }

    if (!skipPrompts) {
      if (await maybeRenderPreviewScenario("withdraw pa select")) {
        return;
      }
      if (await maybeRenderPreviewScenario("withdraw recipient input")) {
        return;
      }
      if (await maybeRenderPreviewScenario("withdraw confirm")) {
        return;
      }
    }

    if ((opts.all ?? false) && !firstArg && skipPrompts) {
      throw new CLIError(
        "--all requires an asset. Use 'withdraw --all ETH --to <address>'.",
        "INPUT",
        "Run 'privacy-pools pools' to see available assets.",
        "INPUT_MISSING_ASSET",
      );
    }
    if (!(opts.all ?? false) && !firstArg && skipPrompts) {
      throw new CLIError(
        "Missing amount. Specify an amount or use --all.",
        "INPUT",
        "Example: privacy-pools withdraw 0.05 ETH --to 0x... or privacy-pools withdraw --all ETH --to 0x...",
        "INPUT_MISSING_AMOUNT",
      );
    }
    if (!(opts.all ?? false) && firstArg && skipPrompts) {
      const resolvedInput = resolveAmountAndAssetInput(
        "withdraw",
        firstArg,
        secondArg,
      );
      if (!resolvedInput.asset) {
        throw new CLIError(
          "No asset specified.",
          "INPUT",
          "Example: privacy-pools withdraw 0.05 ETH --to 0x... or privacy-pools withdraw --all ETH --to 0x...",
          "INPUT_MISSING_ASSET",
        );
      }
      if (!isDirect && !opts.to?.trim()) {
        throw new CLIError(
          "Missing recipient. Relayed withdrawals require --to <address>.",
          "INPUT",
          "Example: privacy-pools withdraw 0.05 ETH --to 0xRecipient...",
          "INPUT_MISSING_RECIPIENT",
        );
      }
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    const mnemonic = loadMnemonic();
    emitStreamJsonEvent(streamJson, {
      mode: "withdraw-progress",
      operation: "withdraw",
      event: "stage",
      stage: "chain_resolved",
      chain: chainConfig.name,
      withdrawMode: isDirect ? "direct" : "relayed",
    });
    verbose(
      `Chain: ${chainConfig.name} (${chainConfig.id})`,
      isVerbose,
      silent,
    );
    verbose(`Mode: ${isDirect ? "direct" : "relayed"}`, isVerbose, silent);
    if (isDirect) {
      warn(
        "Using direct withdrawal. This will publicly link your deposit and withdrawal addresses onchain and cannot be undone.",
        silent,
      );
    } else {
      info(
        "Using relayed withdrawal (recommended: stronger privacy via relayer routing).",
        silent,
      );
    }

    // Resolve amount + asset. With --all, first arg is the asset (no amount).
    const isAllWithdrawal = opts.all ?? false;
    if (
      isAllWithdrawal &&
      isDirect &&
      skipPrompts &&
      opts.acceptAllFundsPublic !== true
    ) {
      throw new CLIError(
        "--all --direct requires explicit full-balance public-withdrawal acknowledgement in non-interactive mode.",
        "INPUT",
        "Re-run with --accept-all-funds-public only if you intentionally want to publicly link the entire selected Pool Account balance to the signer address.",
        "INPUT_FLAG_CONFLICT",
      );
    }
    let amountStr: string;
    let positionalOrFlagAsset: string | undefined;
    let needsAmountPrompt = false;

    if (isAllWithdrawal) {
      const amountLikeFirstArg =
        typeof firstArg === "string" &&
        /^-?(?:\d+(?:\.\d+)?|\.\d+)%?$/.test(firstArg.trim());
      if (secondArg !== undefined || amountLikeFirstArg) {
        throw new CLIError(
          "Remove the amount when using --all.",
          "INPUT",
          "--all already implies 100% of the selected Pool Account. Use 'privacy-pools withdraw --all <asset> --to <address>'.",
        );
      }
      positionalOrFlagAsset = firstArg;
      if (!positionalOrFlagAsset) {
        throw new CLIError(
          "--all requires an asset. Use 'withdraw --all ETH --to <address>'.",
          "INPUT",
          "Run 'privacy-pools pools' to see available assets.",
          "INPUT_MISSING_ASSET",
        );
      }
      amountStr = "";
    } else {
      if (!firstArg) {
        if (skipPrompts) {
          throw new CLIError(
            "Missing amount. Specify an amount or use --all.",
            "INPUT",
            "Example: privacy-pools withdraw 0.05 ETH --to 0x... or privacy-pools withdraw --all ETH --to 0x...",
            "INPUT_MISSING_AMOUNT",
          );
        }
        amountStr = "";
        positionalOrFlagAsset = secondArg;
        needsAmountPrompt = true;
      } else {
        const resolved = resolveAmountAndAssetInput(
          "withdraw",
          firstArg,
          secondArg,
        );
        amountStr = resolved.amount;
        positionalOrFlagAsset = resolved.asset;
      }
    }

    // Detect percentage amounts (e.g. "50%")
    const isDeferredPercent = !isAllWithdrawal && isPercentageAmount(amountStr);
    let deferredPercent: number | null = null;
    if (isDeferredPercent) {
      deferredPercent = parseFloat(amountStr.replace("%", ""));
      if (deferredPercent <= 0 || deferredPercent > 100) {
        throw new CLIError(
          `Invalid percentage: ${amountStr}.`,
          "INPUT",
          "Use a value between 1% and 100% (e.g., 50%, 100%).",
        );
      }
    }
    const isDeferredAmount = isAllWithdrawal || isDeferredPercent;

    // Private key is only needed for onchain submission, not --unsigned or --dry-run
    let signerAddress: Address | null = null;
    if (!isUnsigned && !isDryRun) {
      const privateKey = loadPrivateKey();
      signerAddress = privateKeyToAccount(privateKey).address;
    }
    // In unsigned/dry-run modes, do NOT touch the key file at all — the signer is optional
    verbose(`Signer: ${signerAddress ?? "(unsigned mode)"}`, isVerbose, silent);

    // Validate --to / --direct constraints. Human relayed mode can prompt later
    // once the asset and Pool Account have been selected.
    let recipientAddress: Address | null = null;
    let recipientEnsName: string | undefined;
    let recipientWarnings: RecipientSafetyWarning[] = [];
    if (opts.to) {
      const resolved = await resolveSafeRecipientAddressOrEns(opts.to, "Recipient");
      recipientAddress = resolved.address;
      recipientEnsName = resolved.ensName;
      if (recipientEnsName) {
        info(`Resolved ${recipientEnsName} -> ${recipientAddress}`, advisorySilent);
      }
    } else if (isDirect && !signerAddress) {
      throw new CLIError(
        "Direct withdrawal requires --to <address> in unsigned mode (no signer key available).",
        "INPUT",
        "Specify a recipient address with --to 0x...",
      );
    } else if (isDirect) {
      recipientAddress = signerAddress!;
      recipientWarnings.push({
        code: "DIRECT_WITHDRAW_AUTO_RECIPIENT",
        category: "recipient",
        message:
          "No --to recipient was provided for --direct, so the signer address was used as the withdrawal recipient.",
      });
      warn(
        "No --to recipient was provided for --direct, so the signer address will receive the withdrawal.",
        advisorySilent,
      );
    } else if (skipPrompts) {
      throw new CLIError(
        "Relayed withdrawals require --to <address>.",
        "INPUT",
        "Specify a recipient with --to. Direct withdrawal is available only if you fully accept that it publicly links your deposit and withdrawal addresses.",
      );
    }

    if (isDirect && recipientAddress && opts.to && signerAddress) {
      if (recipientAddress.toLowerCase() !== signerAddress.toLowerCase()) {
        throw new CLIError(
          "Direct withdrawal --to must match your signer address.",
          "INPUT",
          `Your signer address is ${signerAddress}. Use relayed mode (default) to withdraw to a different address.`,
          "INPUT_DIRECT_WITHDRAW_RECIPIENT_MISMATCH",
          false,
          undefined,
          {
            signerAddress,
            requestedRecipient: recipientAddress,
          },
          undefined,
          {
            helpTopic: "modes",
            nextActions: buildDirectRecipientMismatchNextActions({
              amountInput: amountStr,
              assetInput: positionalOrFlagAsset ?? null,
              chainName: chainConfig.name,
              recipientAddress,
              signerAddress,
            }),
          },
        );
      }
    }

    // Resolve pool
    let pool: PoolStats;
    if (positionalOrFlagAsset) {
      pool = await resolvePool(
        chainConfig,
        positionalOrFlagAsset,
        globalOpts?.rpcUrl,
      );
    } else if (!skipPrompts) {
      const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
      if (pools.length === 0) {
        throw new CLIError(
          `No pools found on ${chainConfig.name}.`,
          "INPUT",
          "Run 'privacy-pools pools --chain <chain>' to see available pools.",
        );
      }
      ensurePromptInteractionAvailable();
      const selected = await selectPrompt<string>({
        message: "Select asset to withdraw:",
        choices: pools.map((p) => ({
          name: formatPoolPromptChoice({
            symbol: p.symbol,
            chain: chainConfig.name,
            minimumDepositAmount: p.minimumDepositAmount,
            decimals: p.decimals,
            totalInPoolValue: p.totalInPoolValue ?? p.acceptedDepositsValue,
            tokenPrice: deriveTokenPrice(p),
          }),
          value: p.asset,
        })),
      });
      pool = await resolvePool(
        chainConfig,
        selected,
        globalOpts?.rpcUrl,
      );
    } else {
      throw new CLIError(
        "No asset specified.",
        "INPUT",
        "Run 'privacy-pools pools' to see available assets, then use a positional asset like 'privacy-pools withdraw 0.05 ETH --to 0x...'.",
        "INPUT_MISSING_ASSET",
      );
    }
    if (
      isDirect &&
      !isDryRun &&
      (mode.skipPrompts || isUnsigned) &&
      opts.confirmDirectWithdraw !== true &&
      !(isAllWithdrawal && opts.acceptAllFundsPublic === true)
    ) {
      throw new CLIError(
        "Direct withdrawal requires explicit privacy-loss acknowledgement in non-interactive mode.",
        "INPUT",
        "Re-run with --confirm-direct-withdraw only if you fully accept that this will publicly link your deposit and withdrawal addresses onchain.",
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
      isVerbose,
      silent,
    );
    emitStreamJsonEvent(streamJson, {
      mode: "withdraw-progress",
      operation: "withdraw",
      event: "stage",
      stage: "pool_resolved",
      chain: chainConfig.name,
      asset: pool.symbol,
      poolAddress: pool.pool,
      withdrawMode: isDirect ? "direct" : "relayed",
    });

    if (needsAmountPrompt) {
      ensurePromptInteractionAvailable();
      amountStr = (
        await inputPrompt({
          message: `Withdrawal amount for ${pool.symbol} (e.g. 0.05, 50%, 100%):`,
          transformer: createAnonymitySetAmountTransformer({
            chainConfig,
            pool,
            silent,
          }),
          validate: (value) => {
            const trimmed = value.trim();
            if (trimmed.length === 0) {
              return "Enter an amount or percentage.";
            }
            if (isPercentageAmount(trimmed)) {
              const percentage = Number.parseFloat(trimmed.replace("%", ""));
              if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
                return "Use a percentage between 1% and 100%.";
              }
              return true;
            }
            try {
              const parsed = parseAmount(trimmed, pool.decimals, {
                allowNegative: true,
              });
              validatePositive(parsed, "Withdrawal amount");
              return true;
            } catch (error) {
              return error instanceof Error ? error.message : "Invalid amount.";
            }
          },
        })
      ).trim();
    }

    // Resolve --extra-gas: default true for ERC20, always false for native asset (ETH)
    const isNativeAsset = isNativePoolAsset(chainConfig.id, pool.asset);
    let effectiveExtraGas = isNativeAsset ? false : (opts.extraGas ?? true);
    if (isNativeAsset && opts.extraGas === true) {
      info(
        "Extra gas is not applicable for native-asset withdrawals because the chain native token already covers gas.",
        advisorySilent,
      );
    }
    if (!isDirect && !isNativeAsset && effectiveExtraGas) {
      verbose("Extra gas: requested (ERC20 withdrawal)", isVerbose, silent);
    }

    // Parse amount — deferred for --all and percentage modes.
    let withdrawalAmount: bigint;
    const tokenPrice = deriveTokenPrice(pool);
    const nativeTokenPrice = effectiveExtraGas
      ? await deriveNativeGasTokenPrice(chainConfig, globalOpts?.rpcUrl, pool)
      : null;
    let withdrawalUsd: string;

    if (!isDeferredAmount) {
      withdrawalAmount = parseAmount(amountStr, pool.decimals, {
        allowNegative: true,
      });
      validatePositive(withdrawalAmount, "Withdrawal amount");
      verbose(
        `Requested withdrawal amount: ${withdrawalAmount.toString()}`,
        isVerbose,
        silent,
      );
      withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
    } else {
      // Use a minimal positive threshold to select any PA with remaining balance.
      // The real withdrawal amount is resolved after PA selection.
      withdrawalAmount = 1n;
      withdrawalUsd = "";
    }

    if (isDryRun && !accountHasDeposits(chainConfig.id)) {
      const nextActionAmount = isDeferredAmount
        ? formatUnits(pool.minimumDepositAmount, pool.decimals)
        : amountStr;
      throw new CLIError(
        "No Pool Accounts are available for withdrawal yet.",
        "INPUT",
        `Deposit into ${pool.symbol} first, then run 'privacy-pools accounts --chain ${chainConfig.name}' after ASP review completes.`,
        "ACCOUNT_NOT_FOUND",
        false,
        undefined,
        {
          chain: chainConfig.name,
          asset: pool.symbol,
        },
        undefined,
        {
          nextActions: [
            createNextAction(
              "flow start",
              "Start with a guided deposit and saved private withdrawal.",
              "after_dry_run",
              {
                args: [nextActionAmount, pool.symbol],
                options: {
                  agent: true,
                  chain: chainConfig.name,
                },
                runnable: false,
                parameters: [{ name: "to", type: "address", required: true }],
              },
            ),
            createNextAction(
              "deposit",
              "Deposit into this pool first.",
              "after_dry_run",
              {
                args: [nextActionAmount, pool.symbol],
                options: {
                  agent: true,
                  chain: chainConfig.name,
                },
              },
            ),
          ],
        },
      );
    }

    if (
      await maybeRenderPreviewProgressStep("withdraw.sync-account-state", {
        stage: {
          step: 1,
          total: isDirect ? 3 : 4,
          label: "Syncing account state",
        },
        spinnerText: "Syncing account state...",
        doneText: "Account & ASP data synced.",
      })
    ) {
      return;
    }

    if (
      isDirect &&
      !skipPrompts &&
      await maybeRenderPreviewScenario("withdraw direct confirm", {
        timing: "after-prompts",
      })
    ) {
      return;
    }

    if (
      !isDirect &&
      await maybeRenderPreviewProgressStep("withdraw.request-quote", {
        stage: {
          step: 2,
          total: 4,
          label: "Requesting relayer quote",
        },
        spinnerText: "Requesting relayer quote...",
        doneText: "Relayer quote ready.",
      })
    ) {
      return;
    }

    if (
      await maybeRenderPreviewProgressStep("withdraw.generate-proof", {
        stage: {
          step: isDirect ? 2 : 3,
          total: isDirect ? 3 : 4,
          label: "Generating and verifying ZK proof",
        },
        spinnerText: "Generating and verifying ZK proof...",
        doneText: "Proof generated and verified.",
      })
    ) {
      return;
    }

    if (
      isDirect &&
      await maybeRenderPreviewProgressStep("withdraw.submit-direct", {
        stage: {
          step: 3,
          total: 3,
          label: "Submitting withdrawal",
        },
        spinnerText: "Submitting withdrawal...",
        doneText: "Withdrawal submitted.",
      })
    ) {
      return;
    }

    if (
      !isDirect &&
      await maybeRenderPreviewProgressStep("withdraw.submit-relayed", {
        stage: {
          step: 4,
          total: 4,
          label: "Submitting to relayer",
        },
        spinnerText: "Submitting to relayer...",
        doneText: "Relayer submission sent.",
      })
    ) {
      return;
    }

    // Acquire process lock to prevent concurrent account mutations.
    const releaseLock = acquireProcessLock();
    try {
      // Load account & sync
      const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

      const dataService = await getDataService(
        chainConfig,
        pool.pool,
        globalOpts?.rpcUrl,
      );

      writeWithdrawProgress(0, "Syncing account state and fetching ASP data.");
      const spin = spinner("Syncing account state...", silent);
      spin.start();

      // Start ASP root/leaf fetches concurrently with account sync
      // (they only need chainConfig + pool.scope, not account data).
      const rootsPromise = fetchMerkleRoots(chainConfig, pool.scope);
      const leavesPromise = fetchMerkleLeaves(chainConfig, pool.scope);

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
        true, // sync to pick up latest onchain state
        silent,
        true,
      );

      // Find Pool Accounts in this scope with remaining balance.
      const spendable = withSuppressedSdkStdoutSync(() =>
        accountService.getSpendableCommitments(),
      );
      const poolCommitments = spendable.get(pool.scope) ?? [];

      const rawPoolAccounts = buildPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
      );
      const allKnownPoolAccounts = buildAllPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
      );
      verbose(
        `Available Pool Accounts in this pool: ${rawPoolAccounts.length}`,
        isVerbose,
        silent,
      );

      if (fromPaNumber !== undefined && fromPaNumber !== null) {
        const requestedKnownPoolAccount = allKnownPoolAccounts.find(
          (pa) => pa.paNumber === fromPaNumber,
        );
        const requestedActivePoolAccount = rawPoolAccounts.find(
          (pa) => pa.paNumber === fromPaNumber,
        );
        const unavailableReason =
          requestedKnownPoolAccount && !requestedActivePoolAccount
            ? describeUnavailablePoolAccount(
                requestedKnownPoolAccount,
                "withdraw",
              )
            : null;
        if (requestedKnownPoolAccount && unavailableReason) {
          spin.stop();
          throw new CLIError(
            unavailableReason,
            "INPUT",
            `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect ${requestedKnownPoolAccount.paId} and choose a Pool Account with remaining balance.`,
          );
        }
        if (!requestedKnownPoolAccount) {
          spin.stop();
          const unknownPoolAccount = getUnknownPoolAccountError({
            paNumber: fromPaNumber,
            symbol: pool.symbol,
            chainName: chainConfig.name,
            knownPoolAccountsCount: allKnownPoolAccounts.length,
            availablePaIds: allKnownPoolAccounts.map((pa) => pa.paId),
          });
          throw new CLIError(
            unknownPoolAccount.message,
            "INPUT",
            unknownPoolAccount.hint,
          );
        }
      }

      const baseSelection = selectBestWithdrawalCommitment(
        rawPoolAccounts,
        withdrawalAmount,
      );

      if (
        baseSelection.kind === "insufficient" &&
        (fromPaNumber === undefined || fromPaNumber === null)
      ) {
        spin.stop();
        throw new CLIError(
          `No Pool Account has enough balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`,
          "INPUT",
          poolCommitments.length > 0
            ? `Largest available: ${formatAmount(baseSelection.largestAvailable, pool.decimals, pool.symbol)}`
            : `No available Pool Accounts found for ${pool.symbol}. Deposit first, then run 'privacy-pools accounts --chain ${chainConfig.name}'.`,
        );
      }

      // Await ASP roots/leaves (started concurrently with sync above),
      // then fetch review statuses which depend on account-derived activeLabels.
      spin.text = "Fetching ASP data...";
      const activeLabels = collectActiveLabels(poolCommitments);
      const [roots, leaves, rawReviewStatuses] = await Promise.all([
        rootsPromise,
        leavesPromise,
        fetchDepositReviewStatuses(chainConfig, pool.scope, activeLabels),
      ]);
      verbose(
        `ASP roots: mtRoot=${roots.mtRoot} onchainMtRoot=${roots.onchainMtRoot}`,
        isVerbose,
        silent,
      );
      verbose(
        `ASP leaves: labels=${leaves.aspLeaves.length} stateLeaves=${leaves.stateTreeLeaves.length}`,
        isVerbose,
        silent,
      );

      const aspRoot = BigInt(roots.onchainMtRoot) as unknown as SDKHash;
      const aspLabels = leaves.aspLeaves.map((s) => BigInt(s));
      const approvedLabelStrings = new Set(
        aspLabels.map((label) => label.toString()),
      );
      const aspReviewState = buildLoadedAspDepositReviewState(
        activeLabels,
        approvedLabelStrings,
        rawReviewStatuses,
      );
      const allCommitmentHashes = leaves.stateTreeLeaves.map((s) => BigInt(s));

      const allPoolAccounts = buildAllPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
        aspReviewState.approvedLabels,
        aspReviewState.reviewStatuses,
      );
      const poolAccounts = buildPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
        aspReviewState.approvedLabels,
        aspReviewState.reviewStatuses,
      );

      // Ensure ASP tree and onchain root are converged before proof generation.
      if (BigInt(roots.mtRoot) !== BigInt(roots.onchainMtRoot)) {
        throw new CLIError(
          "Withdrawal service data is still updating.",
          "ASP",
          "Wait a few seconds and retry.",
        );
      }

      // Verify ASP root parity against onchain latest root.
      const onchainLatestRoot = await publicClient.readContract({
        address: chainConfig.entrypoint,
        abi: entrypointLatestRootAbi,
        functionName: "latestRoot",
      });

      if (BigInt(roots.onchainMtRoot) !== BigInt(onchainLatestRoot as bigint)) {
        throw new CLIError(
          "Withdrawal service data is out of sync with the chain.",
          "ASP",
          "Wait briefly and retry so the service can catch up.",
        );
      }

      // Choose smallest eligible commitment that is currently ASP-approved.
      const approvedLabelSet = new Set(aspLabels);
      const approvedSelection = selectBestWithdrawalCommitment(
        poolAccounts,
        withdrawalAmount,
        approvedLabelSet,
      );

      if (approvedSelection.kind === "unapproved") {
        const statuses = getEligibleUnapprovedStatuses(
          poolAccounts,
          withdrawalAmount,
        );
        const singularStatus = statuses.length === 1 ? statuses[0] : undefined;
        if (singularStatus === "poa_required") {
          maybeLaunchBrowser({
            globalOpts,
            mode,
            url: POA_PORTAL_URL,
            label: "PoA portal",
            silent,
          });
        }
        throw accountNotApprovedError(
          "No eligible Pool Account is currently approved for withdrawal.",
          formatApprovalResolutionHint({
            chainName: chainConfig.name,
            assetSymbol: pool.symbol,
            status: singularStatus,
          }),
        );
      }

      if (approvedSelection.kind === "insufficient") {
        throw new CLIError(
          `No Pool Account has enough balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`,
          "INPUT",
          `No approved Pool Accounts found for ${pool.symbol} yet. Please wait for your deposits to be approved, or deposit first if you have not funded this pool.`,
        );
      }

      const approvedEligiblePoolAccounts = poolAccounts
        .filter(
          (pa) =>
            pa.value >= withdrawalAmount && approvedLabelSet.has(pa.label),
        )
        .sort((a, b) => {
          if (a.value < b.value) return -1;
          if (a.value > b.value) return 1;
          if (a.label < b.label) return -1;
          if (a.label > b.label) return 1;
          return 0;
        });

      let selectedPoolAccount = approvedSelection.commitment;

      if (fromPaNumber !== undefined && fromPaNumber !== null) {
        const requested = resolveRequestedWithdrawalPoolAccountOrThrow({
          requestedPoolAccounts: poolAccounts,
          allPoolAccounts,
          fromPaNumber,
          chainName: chainConfig.name,
          symbol: pool.symbol,
        });

        if (!isDeferredAmount && requested.value < withdrawalAmount) {
          throw new CLIError(
            `${requested.paId} has insufficient balance for this withdrawal.`,
            "INPUT",
            `${requested.paId} balance: ${formatAmount(requested.value, pool.decimals, pool.symbol)}`,
          );
        }

        if (!approvedLabelSet.has(requested.label)) {
          if (requested.status === "poa_required") {
            maybeLaunchBrowser({
              globalOpts,
              mode,
              url: POA_PORTAL_URL,
              label: "PoA portal",
              silent,
            });
          }
          throw accountNotApprovedError(
            `${requested.paId} is not currently approved for withdrawal.`,
            formatApprovalResolutionHint({
              chainName: chainConfig.name,
              assetSymbol: pool.symbol,
              poolAccountId: requested.paId,
              status:
                requested.status === "pending" ||
                requested.status === "poa_required" ||
                requested.status === "declined" ||
                requested.status === "unknown"
                  ? requested.status
                  : undefined,
            }),
          );
        }

        selectedPoolAccount = requested;
      } else if (!skipPrompts && approvedEligiblePoolAccounts.length > 1) {
        spin.stop();
        if (
          await maybeRenderPreviewScenario("withdraw pa select", {
            timing: "after-prompts",
          })
        ) {
          return;
        }
        ensurePromptInteractionAvailable();
        const selectedPA = await selectPrompt<number>({
          message: "Select Pool Account to withdraw from:",
          choices: approvedEligiblePoolAccounts.map((pa) => ({
            name: formatPoolAccountPromptChoice({
              poolAccountId: pa.paId,
              balance: pa.value,
              decimals: pool.decimals,
              symbol: pool.symbol,
              status: "Approved",
              chain: chainConfig.name,
              usdValue: formatUsdValue(
                pa.value,
                pool.decimals,
                tokenPrice ?? null,
              ),
            }),
            value: pa.paNumber,
          })),
        });
        selectedPoolAccount = approvedEligiblePoolAccounts.find(
          (pa) => pa.paNumber === selectedPA,
        )!;
        spin.start();
      } else if (approvedEligiblePoolAccounts.length > 0) {
        // For --all/percentage, pick largest PA; for fixed amounts, pick smallest eligible.
        selectedPoolAccount = isDeferredAmount
          ? approvedEligiblePoolAccounts[
              approvedEligiblePoolAccounts.length - 1
            ]
          : approvedEligiblePoolAccounts[0];
        verbose(
          `Auto-selected ${selectedPoolAccount.paId} (balance: ${selectedPoolAccount.value.toString()})`,
          isVerbose,
          silent,
        );
      }

      // Show selected PA balance
      info(
        `Selected ${selectedPoolAccount.paId}: ${formatAmount(selectedPoolAccount.value, pool.decimals, pool.symbol)} available`,
        silent,
      );

      // Resolve deferred amount (--all or percentage)
      if (isDeferredAmount) {
        if (isAllWithdrawal || deferredPercent === 100) {
          withdrawalAmount = selectedPoolAccount.value;
        } else {
          // Compute percentage with 2 decimal places precision via bigint math
          withdrawalAmount =
            (selectedPoolAccount.value *
              BigInt(Math.round(deferredPercent! * 100))) /
            10000n;
        }
        validatePositive(withdrawalAmount, "Withdrawal amount");
        withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
        if (isAllWithdrawal) {
          info(
            `Withdrawing 100% of ${selectedPoolAccount.paId}: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
            silent,
          );
        } else {
          info(
            `Withdrawing ${deferredPercent}% of ${selectedPoolAccount.paId}: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
            silent,
          );
        }
      }

      // ── Early relayer minimum validation (C3) ────────────────────────────
      // For relayed withdrawals, fetch relayer details early so the user
      // discovers a below-minimum amount before reaching the review stage.
      // The fetched details are reused later to avoid a redundant network call.
      let earlyRelayerDetails: Awaited<ReturnType<typeof getRelayerDetails>> | null = null;
      let remainderGuidanceAcknowledged = false;
      if (!isDirect) {
        spin.text = "Checking relayer requirements...";
        let earlyMinCheckFailed = false;
        try {
          earlyRelayerDetails = await getRelayerDetails(chainConfig, pool.asset);
          const minWithdraw = BigInt(earlyRelayerDetails.minWithdrawAmount);

          // Interactive re-entry loop when amount is below minimum
          while (withdrawalAmount < minWithdraw) {
            earlyMinCheckFailed = true;
            if (skipPrompts) {
              throw new CLIError(
                `Amount below relayer minimum of ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}.`,
                "RELAYER",
                `Increase your withdrawal amount to at least ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}.`,
              );
            }
            spin.stop();
            warn(
              `Withdrawal amount ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)} is below the relayer minimum of ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}.`,
              silent,
            );
            ensurePromptInteractionAvailable();
            withdrawalAmount = await withSuspendedSpinner(spin, async () =>
              promptWithdrawalAmountEdit({
                message: `Enter a new amount (minimum ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}):`,
                chainConfig,
                pool,
                currentAmount: withdrawalAmount,
                maxAmount: selectedPoolAccount.value,
                minAmount: minWithdraw,
                poolAccountId: selectedPoolAccount.paId,
                silent,
              })
            );
            withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
            info(
              `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent,
            );
            earlyMinCheckFailed = false;
          }

          // Early remainder advisory
          const earlyRemainingBalance = selectedPoolAccount.value - withdrawalAmount;
          if (earlyRemainingBalance > 0n && earlyRemainingBalance < minWithdraw) {
            const advisory = getRelayedWithdrawalRemainderAdvisory({
              remainingBalance: earlyRemainingBalance,
              minWithdrawAmount: minWithdraw,
              poolAccountId: selectedPoolAccount.paId,
              assetSymbol: pool.symbol,
              decimals: pool.decimals,
              poolAccountValue: selectedPoolAccount.value,
            });
            if (advisory) {
              warn(advisory.summary, silent);
              if (!skipPrompts) {
                const maxAmountLeavingWithdrawableRemainder =
                  selectedPoolAccount.value - minWithdraw;
                ensurePromptInteractionAvailable();
                const remainderChoice = await withSuspendedSpinner(
                  spin,
                  async () =>
                    selectPrompt<"less" | "max" | "continue">({
                      message: "The remainder would be below the private relayer minimum. What would you like to do?",
                      choices: [
                        {
                          name: "Withdraw less and leave a privately withdrawable remainder",
                          value: "less" as const,
                          disabled:
                            maxAmountLeavingWithdrawableRemainder >= minWithdraw
                              ? false
                              : "Pool Account balance is too small for this option",
                        },
                        {
                          name: `Use max (${formatAmount(selectedPoolAccount.value, pool.decimals, pool.symbol)})`,
                          value: "max" as const,
                        },
                        {
                          name: "Continue and ragequit the remainder later if needed",
                          value: "continue" as const,
                        },
                      ],
                    }),
                );
                remainderGuidanceAcknowledged = true;

                if (remainderChoice === "max") {
                  withdrawalAmount = selectedPoolAccount.value;
                  withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
                  info(
                    `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
                    silent,
                  );
                } else if (remainderChoice === "less") {
                  withdrawalAmount = await withSuspendedSpinner(
                    spin,
                    async () =>
                      promptWithdrawalAmountEdit({
                        message: `Enter amount up to ${formatAmount(maxAmountLeavingWithdrawableRemainder, pool.decimals, pool.symbol)}:`,
                        chainConfig,
                        pool,
                        currentAmount: withdrawalAmount,
                        maxAmount: selectedPoolAccount.value,
                        minAmount: minWithdraw,
                        leaveAtLeast: minWithdraw,
                        poolAccountId: selectedPoolAccount.paId,
                        silent,
                      }),
                  );
                  withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
                  info(
                    `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
                    silent,
                  );
                }
              }
            }
          }
        } catch (e) {
          // Rethrow min-amount validation errors and prompt cancellations.
          // Network failures fetching relayer details are non-fatal here --
          // the late check at the relayed branch entry will catch them.
          if (earlyMinCheckFailed) {
            throw e;
          }
          if (isPromptCancellationError(e)) {
            throw e;
          }
          // Network/relayer fetch failure: fall through, late validation will catch it.
          earlyRelayerDetails = null;
          verbose(
            `Early relayer details fetch failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
            isVerbose,
            silent,
          );
        }
      }

      const commitment = selectedPoolAccount.commitment;
      const commitmentLabel = commitment.label;
      verbose(
        `Selected ${selectedPoolAccount.paId}: label=${commitmentLabel.toString()} value=${commitment.value.toString()}`,
        isVerbose,
        silent,
      );

      writeWithdrawalPrivacyTip(
        {
          amount: withdrawalAmount,
          balance: selectedPoolAccount.value,
          decimals: pool.decimals,
          symbol: pool.symbol,
        },
        { silent },
      );

      let anonymitySet: WithdrawAnonymitySet | undefined;
      if (!isDirect) {
        anonymitySet = await fetchWithdrawalAnonymitySet(
          chainConfig,
          pool,
          withdrawalAmount,
        );
        if (!skipPrompts) {
          writeWithdrawalAnonymitySetHint(anonymitySet, silent);
        }
      }

      if (!isDirect && !recipientAddress) {
        if (
          await maybeRenderPreviewScenario("withdraw recipient input", {
            timing: "after-prompts",
          })
        ) {
          return;
        }
        ensurePromptInteractionAvailable();
        const promptedRecipient = await withSuspendedSpinner(
          spin,
          async () => promptRecipientAddressOrEns(silent),
        );
        recipientAddress = promptedRecipient.address;
        recipientEnsName = promptedRecipient.ensName;
      }

      if (!recipientAddress) {
        throw new CLIError(
          "Relayed withdrawals require --to <address>.",
          "INPUT",
          "Specify a recipient with --to. Direct withdrawal is available only if you fully accept that it publicly links your deposit and withdrawal addresses.",
        );
      }
      const resolvedRecipientAddress = recipientAddress;
      recipientWarnings = await confirmRecipientIfNew({
        address: resolvedRecipientAddress,
        knownRecipients: collectKnownWithdrawalRecipients(signerAddress),
        skipPrompts,
        silent,
      });

      // Build Merkle proofs
      spin.text = "Building proofs...";
      const stateMerkleProof = generateMerkleProof(
        allCommitmentHashes,
        commitment.hash,
      );
      const aspMerkleProof = generateMerkleProof(
        aspLabels,
        commitmentLabel,
      );

      // Generate withdrawal secrets
      const { nullifier: newNullifier, secret: newSecret } =
        withSuppressedSdkStdoutSync(() =>
          accountService.createWithdrawalSecrets(commitment),
        );

      const stateProofRoot = BigInt(
        (stateMerkleProof as { root: bigint | string }).root,
      );
      await assertKnownPoolRoot({
        publicClient,
        cacheScopeKey: poolRootCacheScopeKey(chainConfig.id, globalOpts?.rpcUrl),
        poolAddress: pool.pool,
        proofRoot: stateProofRoot,
        message: "Pool data is out of date.",
        hint: "Run 'privacy-pools sync' and try the withdrawal again.",
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

        if (BigInt(roots.onchainMtRoot) !== BigInt(latestRoot as bigint)) {
          throw new CLIError(message, "ASP", hint);
        }
      };

      if (isDirect) {
        // --- Direct Withdrawal ---
        // Pre-flight gas check (skip for unsigned - relying on external signer)
        if (!isUnsigned && !isDryRun) {
          await checkHasGas(publicClient, signerAddress!);
        }

        const directAddress = resolvedRecipientAddress;
        const withdrawal = {
          processooor: directAddress,
          data: "0x" as Hex,
        };

        const context = BigInt(
          calculateContext(withdrawal, pool.scope as unknown as SDKHash),
        );
        verbose(`Proof context: ${context.toString()}`, isVerbose, silent);

        if (!skipPrompts) {
          while (true) {
            spin.stop();
            process.stderr.write("\n");
            process.stderr.write(
              formatDirectWithdrawalReview({
                poolAccountId: selectedPoolAccount.paId,
                amount: withdrawalAmount,
                asset: pool.symbol,
                chain: chainConfig.name,
                decimals: pool.decimals,
                recipient: directAddress,
                signerAddress,
                recipientEnsName,
                tokenPrice,
              }),
            );
            if (
              await maybeRenderPreviewScenario("withdraw direct confirm", {
                timing: "after-prompts",
              })
            ) {
              return;
            }
            const reviewChoice = await selectPrompt<"confirm" | "back" | "switch" | "cancel">({
              message: "Review direct withdrawal",
              choices: [
                { name: "Continue to confirmation", value: "confirm" as const },
                { name: "Back: edit amount", value: "back" as const },
                {
                  name: "Switch to relayed withdrawal",
                  value: "switch" as const,
                  description: "Exit and rerun without --direct to preserve withdrawal privacy.",
                },
                { name: "Cancel withdrawal", value: "cancel" as const },
              ],
            });
            if (reviewChoice === "cancel") {
              info("Withdrawal cancelled.", silent);
              return;
            }
            if (reviewChoice === "back") {
              withdrawalAmount = await promptWithdrawalAmountEdit({
                message: `Back: enter withdrawal amount for ${selectedPoolAccount.paId}:`,
                chainConfig,
                pool,
                currentAmount: withdrawalAmount,
                maxAmount: selectedPoolAccount.value,
                poolAccountId: selectedPoolAccount.paId,
                silent,
              });
              withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
              info(
                `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
                silent,
              );
              continue;
            }
            if (reviewChoice === "switch") {
              const rerunCommand = [
                "privacy-pools withdraw",
                formatUnits(withdrawalAmount, pool.decimals),
                pool.symbol,
                "--to",
                directAddress,
                "--chain",
                chainConfig.name,
              ].join(" ");
              info(
                `Direct withdrawal cancelled. To use the relayed private path, run: ${rerunCommand}`,
                silent,
              );
              return;
            }
            const ok = await confirmActionWithSeverity({
              severity: "high_stakes",
              standardMessage: "Confirm direct withdrawal?",
              highStakesToken: CONFIRMATION_TOKENS.directWithdrawal,
              highStakesWarning:
                `This direct withdrawal will publicly link your deposit and withdrawal addresses onchain. Recipient: ${directAddress}. This cannot be undone.`,
              confirm: confirmPrompt,
            });
            if (!ok) {
              info("Withdrawal cancelled.", silent);
              return;
            }
            spin.start();
            break;
          }
        }

        // Re-verify parity right before proving
        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "generating_proof",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "direct",
          poolAccountId: selectedPoolAccount.paId,
        });
        writeWithdrawProgress(1, "Generating and locally verifying the direct withdrawal proof.");
        await assertLatestRootUnchanged(
          "Pool state changed while preparing your proof.",
          "Re-run the withdrawal command to generate a fresh proof.",
        );

        const { stateTreeDepth, aspTreeDepth } = deriveWithdrawalTreeDepths({
          stateMerkleProof,
          aspMerkleProof,
        });
        const proof = await withProofProgress(
          spin,
          "Generating and verifying ZK proof",
          (progress) =>
            proveWithdrawal(commitment, {
              context,
              withdrawalAmount,
              stateMerkleProof,
              aspMerkleProof,
              stateRoot: stateProofRoot as unknown as SDKHash,
              stateTreeDepth,
              aspRoot,
              aspTreeDepth,
              newNullifier,
              newSecret,
            }, {
              progress,
            }),
        );
        verbose(
          `Proof generated: publicSignals=${proof.publicSignals.length}`,
          isVerbose,
          silent,
        );
        const solidityProof = toWithdrawSolidityProof(proof);
        await assertLatestRootUnchanged(
          "Pool state changed after proof generation. Re-run withdrawal to generate a fresh proof.",
          "Run 'privacy-pools sync' then retry the withdrawal.",
        );

        if (isUnsigned) {
          const payload = buildUnsignedDirectWithdrawOutput({
            chainId: chainConfig.id,
            chainName: chainConfig.name,
            assetSymbol: pool.symbol,
            amount: withdrawalAmount,
            from: directAddress,
            poolAddress: pool.pool,
            recipient: directAddress,
            poolAccountId: selectedPoolAccount.paId,
            selectedCommitmentLabel: commitmentLabel,
            selectedCommitmentValue: commitment.value,
            withdrawal,
            proof: solidityProof,
          });

          if (wantsTxFormat) {
            printRawTransactions(payload.transactions);
          } else {
            if (!isQuiet && !isJson) {
              info("Unsigned mode: building transaction payloads only; validation is approximate until broadcast.", false);
            }
            printJsonSuccess(
              {
                ...payload,
                poolAccountNumber: selectedPoolAccount.paNumber,
                poolAccountId: selectedPoolAccount.paId,
                rootMatchedAtProofTime: true,
                warnings: [...payload.warnings, ...recipientWarnings],
                ...(directConfirmDeprecationWarning
                  ? { deprecationWarning: directConfirmDeprecationWarning }
                  : {}),
              },
              false,
            );
          }
          return;
        }

        if (isDryRun) {
          spin.succeed("Dry-run completed (no transaction submitted).");
          const ctx = createOutputContext(mode);
          renderWithdrawDryRun(ctx, {
            withdrawMode: "direct",
            amount: withdrawalAmount,
            asset: pool.symbol,
            chain: chainConfig.name,
            decimals: pool.decimals,
            recipient: directAddress,
            poolAccountNumber: selectedPoolAccount.paNumber,
            poolAccountId: selectedPoolAccount.paId,
            selectedCommitmentLabel: commitmentLabel,
            selectedCommitmentValue: commitment.value,
            proofPublicSignals: proof.publicSignals.length,
            rootMatchedAtProofTime: true,
            anonymitySet,
            warnings: recipientWarnings,
            deprecationWarning: directConfirmDeprecationWarning,
          });
          return;
        }

        await assertLatestRootUnchanged(
          "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
          "Run 'privacy-pools sync' then retry the withdrawal.",
        );

        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "submitting_transaction",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "direct",
          poolAccountId: selectedPoolAccount.paId,
        });
        writeWithdrawProgress(2, "Simulating and submitting the direct withdrawal transaction.");
        const tx = await withdrawDirect(
          chainConfig,
          pool.pool,
          withdrawal,
          solidityProof,
          globalOpts?.rpcUrl,
          undefined,
          {
            onSimulating: () => {
              spin.text = "Simulating withdrawal transaction...";
            },
            onBroadcasting: () => {
              spin.text = "Submitting withdrawal transaction...";
            },
          },
        );

        const directExplorerUrl = explorerTxUrl(chainConfig.id, tx.hash);
        if (opts.noWait) {
          emitStreamJsonEvent(streamJson, {
            mode: "withdraw-progress",
            operation: "withdraw",
            event: "stage",
            stage: "submitted",
            chain: chainConfig.name,
            asset: pool.symbol,
            withdrawMode: "direct",
            txHash: tx.hash,
          });
          spin.succeed("Direct withdrawal submitted.");
          const submission = createSubmissionRecord({
            operation: "withdraw",
            sourceCommand: "withdraw",
            chain: chainConfig.name,
            asset: pool.symbol,
            poolAccountId: selectedPoolAccount.paId,
            poolAccountNumber: selectedPoolAccount.paNumber,
            recipient: resolvedRecipientAddress,
            transactions: [
              {
                description: "Direct withdrawal",
                txHash: tx.hash as Hex,
              },
            ],
          });
          rememberSuccessfulWithdrawalRecipient(resolvedRecipientAddress, {
            ensName: recipientEnsName,
            chain: chainConfig.name,
          });

          const ctx = createOutputContext(mode);
          renderWithdrawSuccess(ctx, {
            status: "submitted",
            submissionId: submission.submissionId,
            withdrawMode: "direct",
            txHash: tx.hash,
            blockNumber: null,
            amount: withdrawalAmount,
            recipient: resolvedRecipientAddress,
            asset: pool.symbol,
            chain: chainConfig.name,
            decimals: pool.decimals,
            poolAccountNumber: selectedPoolAccount.paNumber,
            poolAccountId: selectedPoolAccount.paId,
            poolAddress: pool.pool,
            scope: pool.scope,
            explorerUrl: directExplorerUrl,
            remainingBalance: selectedPoolAccount.value - withdrawalAmount,
            tokenPrice,
            rootMatchedAtProofTime: true,
            reconciliationRequired: false,
            localStateSynced: false,
            warningCode: null,
            anonymitySet,
            warnings: recipientWarnings,
            deprecationWarning: directConfirmDeprecationWarning,
          });
          maybeLaunchBrowser({
            globalOpts,
            mode,
            url: directExplorerUrl,
            label: "withdrawal transaction",
            silent,
          });
          return;
        }

        spin.text = "Waiting for confirmation...";
        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "waiting_confirmation",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "direct",
          txHash: tx.hash,
        });
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({
            hash: tx.hash as `0x${string}`,
            timeout: getConfirmationTimeoutMs(),
          });
        } catch {
          throw new CLIError(
            "Timed out waiting for withdrawal confirmation.",
            "RPC",
            `Tx ${tx.hash} may still confirm. Wait about ${confirmationTimeoutSeconds}s or re-run with --timeout <seconds>, then run 'privacy-pools sync' to pick up the transaction.`,
            "RPC_NETWORK_ERROR",
            true,
            undefined,
            {
              txHash: tx.hash,
              explorerUrl: directExplorerUrl,
            },
          );
        }
        if (receipt.status !== "success") {
          throw new CLIError(
            `Withdrawal transaction reverted: ${tx.hash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }

        const {
          reconciliationRequired,
          localStateSynced,
          warningCode,
        } = await persistWithReconciliation({
          accountService,
          chainConfig,
          dataService,
          mnemonic,
          pool,
          silent,
          isJson,
          isVerbose,
          errorLabel: "Withdrawal reconciliation",
          reconcileHint: `Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`,
          persistFailureMessage: "Withdrawal confirmed onchain but failed to save locally",
          warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
          persist: () => {
            withSuppressedSdkStdoutSync(() =>
              accountService.addWithdrawalCommitment(
                commitment,
                commitment.value - withdrawalAmount,
                newNullifier,
                newSecret,
                receipt.blockNumber,
                tx.hash as Hex,
              ),
            );
            saveAccount(chainConfig.id, accountService.account);
            saveSyncMeta(chainConfig.id);
          },
        });
        if (reconciliationRequired) {
          warnSpinner(
            spin,
            "Withdrawal confirmed onchain; local state needs reconciliation.",
            silent,
          );
        } else {
          spin.succeed("Direct withdrawal confirmed");
        }
        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "confirmed",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "direct",
          txHash: tx.hash,
          blockNumber: receipt.blockNumber.toString(),
        });
        rememberSuccessfulWithdrawalRecipient(resolvedRecipientAddress, {
          ensName: recipientEnsName,
          chain: chainConfig.name,
        });

        const ctx = createOutputContext(mode);
        renderWithdrawSuccess(ctx, {
          withdrawMode: "direct",
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          amount: withdrawalAmount,
          recipient: resolvedRecipientAddress,
          asset: pool.symbol,
          chain: chainConfig.name,
          decimals: pool.decimals,
          poolAccountNumber: selectedPoolAccount.paNumber,
          poolAccountId: selectedPoolAccount.paId,
          poolAddress: pool.pool,
          scope: pool.scope,
          explorerUrl: directExplorerUrl,
          remainingBalance: selectedPoolAccount.value - withdrawalAmount,
          tokenPrice,
          rootMatchedAtProofTime: true,
          reconciliationRequired,
          localStateSynced,
          warningCode,
          anonymitySet,
          warnings: recipientWarnings,
          deprecationWarning: directConfirmDeprecationWarning,
        });
        maybeLaunchBrowser({
          globalOpts,
          mode,
          url: directExplorerUrl,
          label: "withdrawal transaction",
          silent,
        });
      } else {
        // --- Relayed Withdrawal ---
        // Get relayer details + quote.
        // Reuse early-fetched details when available (C3) to avoid a redundant call.
        writeWithdrawProgress(1, "Fetching a fresh relayer quote.");
        spin.text = "Requesting relayer quote...";
        const details = earlyRelayerDetails ?? await getRelayerDetails(chainConfig, pool.asset);
        const relayerUrl = details.relayerUrl;
        verbose(
          `Relayer details: minWithdraw=${details.minWithdrawAmount} feeReceiver=${details.feeReceiverAddress}`,
          isVerbose,
          silent,
        );
        const minWithdrawAmount = BigInt(details.minWithdrawAmount);

        if (withdrawalAmount < minWithdrawAmount) {
          throw new CLIError(
            `Amount below relayer minimum of ${formatAmount(minWithdrawAmount, pool.decimals, pool.symbol)}.`,
            "RELAYER",
            `Increase your withdrawal amount to at least ${formatAmount(minWithdrawAmount, pool.decimals, pool.symbol)}.`,
          );
        }

        let remainingBelowMinGuidance = getRelayedWithdrawalRemainderAdvisory(
          {
            remainingBalance: selectedPoolAccount.value - withdrawalAmount,
            minWithdrawAmount,
            poolAccountId: selectedPoolAccount.paId,
            assetSymbol: pool.symbol,
            decimals: pool.decimals,
            poolAccountValue: selectedPoolAccount.value,
            chainName: chainConfig.name,
            recipient: resolvedRecipientAddress,
          },
        );

        if (remainingBelowMinGuidance && !skipPrompts && !remainderGuidanceAcknowledged) {
          // Interactive mode: let the user choose how to handle the low remainder.
          const remainingBalance = selectedPoolAccount.value - withdrawalAmount;
          warn(remainingBelowMinGuidance.summary, silent);
          ensurePromptInteractionAvailable();
          const maxAmountLeavingWithdrawableRemainder =
            selectedPoolAccount.value - minWithdrawAmount;
          const remainderChoice = await withSuspendedSpinner(
            spin,
            async () =>
              selectPrompt<"less" | "full" | "continue">({
                message: "How would you like to proceed?",
                choices: [
                  {
                    name: "Withdraw less and leave a privately withdrawable remainder",
                    value: "less" as const,
                    disabled:
                      maxAmountLeavingWithdrawableRemainder >= minWithdrawAmount
                        ? false
                        : "Pool Account balance is too small for this option",
                  },
                  {
                    name: "Use max (withdraw the full Pool Account balance)",
                    value: "full" as const,
                  },
                  {
                    name: "Continue and ragequit the remainder later if needed",
                    value: "continue" as const,
                  },
                ],
              }),
          );
          if (remainderChoice === "full") {
            withdrawalAmount = selectedPoolAccount.value;
            withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
            info(
              `Adjusted to full balance: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent,
            );
            // Recalculate advisory (should be null now since remainder is 0)
            remainingBelowMinGuidance = getRelayedWithdrawalRemainderAdvisory({
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              minWithdrawAmount,
              poolAccountId: selectedPoolAccount.paId,
              assetSymbol: pool.symbol,
              decimals: pool.decimals,
              poolAccountValue: selectedPoolAccount.value,
              chainName: chainConfig.name,
              recipient: resolvedRecipientAddress,
            });
            anonymitySet = await fetchWithdrawalAnonymitySet(
              chainConfig,
              pool,
              withdrawalAmount,
            );
            writeWithdrawalAnonymitySetHint(anonymitySet, silent);
          } else if (remainderChoice === "less") {
            withdrawalAmount = await withSuspendedSpinner(
              spin,
              async () =>
                promptWithdrawalAmountEdit({
                  message: `Enter amount up to ${formatAmount(maxAmountLeavingWithdrawableRemainder, pool.decimals, pool.symbol)}:`,
                  chainConfig,
                  pool,
                  currentAmount: withdrawalAmount,
                  maxAmount: selectedPoolAccount.value,
                  minAmount: minWithdrawAmount,
                  leaveAtLeast: minWithdrawAmount,
                  poolAccountId: selectedPoolAccount.paId,
                  silent,
                }),
            );
            withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
            info(
              `Adjusted withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent,
            );
            remainingBelowMinGuidance = getRelayedWithdrawalRemainderAdvisory({
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              minWithdrawAmount,
              poolAccountId: selectedPoolAccount.paId,
              assetSymbol: pool.symbol,
              decimals: pool.decimals,
              poolAccountValue: selectedPoolAccount.value,
              chainName: chainConfig.name,
              recipient: resolvedRecipientAddress,
            });
            anonymitySet = await fetchWithdrawalAnonymitySet(
              chainConfig,
              pool,
              withdrawalAmount,
            );
            writeWithdrawalAnonymitySetHint(anonymitySet, silent);
          }
        } else if (skipPrompts && remainingBelowMinGuidance) {
          throw new CLIError(
            "This relayed withdrawal would leave a remainder below the relayer minimum.",
            "INPUT",
            formatRelayedWithdrawalRemainderHint(remainingBelowMinGuidance),
            "INPUT_REMAINDER_BELOW_RELAYER_MINIMUM",
            false,
            undefined,
            {
              poolAccountId: selectedPoolAccount.paId,
              remainingBalance: (selectedPoolAccount.value - withdrawalAmount).toString(),
              minWithdrawAmount: details.minWithdrawAmount,
              recipient: resolvedRecipientAddress,
            },
            undefined,
            {
              helpTopic: "ragequit",
              nextActions: buildRemainderBelowMinNextActions({
                chainName: chainConfig.name,
                asset: pool.symbol,
                decimals: pool.decimals,
                recipient: resolvedRecipientAddress,
                poolAccountId: selectedPoolAccount.paId,
                poolAccountValue: selectedPoolAccount.value,
                minWithdrawAmount,
                signerAddress,
              }),
            },
          );
        }

        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "requesting_quote",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "relayed",
          poolAccountId: selectedPoolAccount.paId,
        });
        const initialQuoteResult = await requestQuoteWithExtraGasFallback(
          chainConfig,
          {
            amount: withdrawalAmount,
            asset: pool.asset,
            extraGas: effectiveExtraGas,
            recipient: resolvedRecipientAddress,
            relayerUrl,
          },
        );
        let quote = initialQuoteResult.quote;
        let quoteRefreshCount = 0;
        if (initialQuoteResult.downgradedExtraGas) {
          effectiveExtraGas = initialQuoteResult.extraGas;
          warn(
            "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
            silent,
          );
        }
        verbose(
          `Relayer quote: feeBPS=${quote.feeBPS} baseFeeBPS=${quote.baseFeeBPS}`,
          isVerbose,
          silent,
        );

        if (!quote.feeCommitment) {
          throw new CLIError(
            "Relayer quote is missing required fee details.",
            "RELAYER",
            "The relayer may not support this asset/chain combination.",
          );
        }

        let quoteFeeBPS: bigint;
        let expirationMs: number;

        const fetchFreshQuote = async (reason: string): Promise<void> => {
          spin.text = reason;
          const refreshed = await refreshExpiredRelayerQuoteForWithdrawal({
            fetchQuote: async () => {
              const quoteResult = await requestQuoteWithExtraGasFallback(
                chainConfig,
                {
                  amount: withdrawalAmount,
                  asset: pool.asset,
                  extraGas: effectiveExtraGas,
                  recipient: resolvedRecipientAddress,
                  relayerUrl,
                },
              );
              if (quoteResult.downgradedExtraGas) {
                effectiveExtraGas = quoteResult.extraGas;
                warn(
                  "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
                  advisorySilent,
                );
              }
              return quoteResult.quote;
            },
            maxRelayFeeBPS: pool.maxRelayFeeBPS,
            onRetry: (attempt, max) => {
              warn(
                `Quote expired, refreshing... (attempt ${attempt}/${max})`,
                advisorySilent,
              );
            },
          });
          quote = refreshed.quote;
          quoteFeeBPS = refreshed.quoteFeeBPS;
          expirationMs = refreshed.expirationMs;
          quoteRefreshCount += 1;
          verbose(
            `Relayer quote refreshed: feeBPS=${quote.feeBPS} expiresAt=${new Date(expirationMs).toISOString()}`,
            isVerbose,
            silent,
          );
        };

        ({ quoteFeeBPS, expirationMs } = validateRelayerQuoteForWithdrawal(
          quote,
          pool.maxRelayFeeBPS,
        ));
        verbose(
          `Quote expiration: ${new Date(expirationMs).toISOString()} (${expirationMs})`,
          isVerbose,
          silent,
        );

        // Keep human flow quote-aware before proving, matching frontend review semantics.
        const renderWithdrawalReview = (): void => {
          process.stderr.write("\n");
          process.stderr.write(
            formatRelayedWithdrawalReview({
              poolAccountId: selectedPoolAccount.paId,
              poolAccountBalance: selectedPoolAccount.value,
              amount: withdrawalAmount,
              asset: pool.symbol,
              chain: chainConfig.name,
              decimals: pool.decimals,
              recipient: resolvedRecipientAddress,
              recipientEnsName,
              baseFeeBPS: BigInt(quote.baseFeeBPS),
              quoteFeeBPS,
              expirationMs,
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              extraGasRequested: effectiveExtraGas,
              extraGasFundAmount: quote.detail.extraGasFundAmount
                ? BigInt(quote.detail.extraGasFundAmount.eth)
                : null,
              relayTxCost: quote.detail.relayTxCost,
              extraGasTxCost: quote.detail.extraGasTxCost,
              tokenPrice,
              nativeTokenPrice,
              remainingBelowMinGuidance,
              anonymitySet,
            }),
          );
        };

        if (!skipPrompts) {
          let confirmedWithFreshQuote = false;
          const refreshReviewStateForAmount = async (reason: string): Promise<void> => {
            remainingBelowMinGuidance = getRelayedWithdrawalRemainderAdvisory({
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              minWithdrawAmount,
              poolAccountId: selectedPoolAccount.paId,
              assetSymbol: pool.symbol,
              decimals: pool.decimals,
              poolAccountValue: selectedPoolAccount.value,
              chainName: chainConfig.name,
              recipient: resolvedRecipientAddress,
            });
            anonymitySet = await fetchWithdrawalAnonymitySet(
              chainConfig,
              pool,
              withdrawalAmount,
            );
            writeWithdrawalAnonymitySetHint(anonymitySet, silent);
            await fetchFreshQuote(reason);
          };
          for (
            let reviewAttempt = 1;
            reviewAttempt <= MAX_WITHDRAW_CONFIRM_REVIEW_ATTEMPTS;
            reviewAttempt += 1
          ) {
            const secondsLeft = Math.max(
              0,
              Math.floor((expirationMs - Date.now()) / 1000),
            );
            if (secondsLeft <= 0) {
              if (reviewAttempt >= MAX_WITHDRAW_CONFIRM_REVIEW_ATTEMPTS) {
                throw new CLIError(
                  "Relayer quote expired repeatedly before confirmation completed.",
                  "RELAYER",
                  "Re-run the withdrawal to fetch a fresh quote, then confirm promptly.",
                  "RELAYER_CONFIRMATION_RETRY_LIMIT",
                );
              }
              spin.stop();
              const expiryChoice = await selectPrompt<"refresh" | "cancel">({
                message: "Relayer quote expired before confirmation. What would you like to do?",
                choices: [
                  { name: "Request new quote", value: "refresh" as const },
                  { name: "Cancel withdrawal", value: "cancel" as const },
                ],
              });
              if (expiryChoice === "cancel") {
                info("Withdrawal cancelled.", silent);
                return;
              }
              spin.start();
              await fetchFreshQuote(
                "Requesting a new relayer quote before continuing...",
              );
              continue;
            }

            spin.stop();
            writeQuoteCountdown(expirationMs, silent);
            renderWithdrawalReview();
            if (
              await maybeRenderPreviewScenario("withdraw confirm", {
                timing: "after-prompts",
              })
            ) {
              return;
            }
            const reviewChoice = await selectPrompt<"confirm" | "back" | "refresh" | "cancel">({
              message: "Review withdrawal",
              choices: [
                { name: "Continue to confirmation", value: "confirm" as const },
                { name: "Back: edit amount", value: "back" as const },
                { name: "Request new quote", value: "refresh" as const },
                { name: "Cancel withdrawal", value: "cancel" as const },
              ],
            });
            if (reviewChoice === "cancel") {
              info("Withdrawal cancelled.", silent);
              return;
            }
            if (reviewChoice === "refresh") {
              spin.start();
              await fetchFreshQuote("Requesting a new relayer quote...");
              continue;
            }
            if (reviewChoice === "back") {
              withdrawalAmount = await promptWithdrawalAmountEdit({
                message: `Back: enter withdrawal amount for ${selectedPoolAccount.paId}:`,
                chainConfig,
                pool,
                currentAmount: withdrawalAmount,
                maxAmount: selectedPoolAccount.value,
                minAmount: minWithdrawAmount,
                poolAccountId: selectedPoolAccount.paId,
                silent,
              });
              withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
              info(
                `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
                silent,
              );
              spin.start();
              await refreshReviewStateForAmount("Requesting a quote for the updated amount...");
              continue;
            }

            const withdrawalAmountLabel = formatAmount(
              withdrawalAmount,
              pool.decimals,
              pool.symbol,
            );
            const ok = await confirmActionWithSeverity({
              severity: isHighStakesWithdrawal({
                amount: withdrawalAmount,
                decimals: pool.decimals,
                balance: selectedPoolAccount.value,
                tokenPrice,
                fullBalance: withdrawalAmount === selectedPoolAccount.value,
              })
                ? "high_stakes"
                : "standard",
              standardMessage: "Confirm withdrawal?",
              highStakesToken: CONFIRMATION_TOKENS.withdraw,
              highStakesWarning:
                `This withdrawal moves ${withdrawalAmountLabel} to ${resolvedRecipientAddress}.` +
                " Double-check the amount and destination before continuing.",
              confirm: confirmPrompt,
            });
            if (!ok) {
              info("Withdrawal cancelled.", silent);
              return;
            }

            if (Date.now() <= expirationMs) {
              spin.start();
              confirmedWithFreshQuote = true;
              break;
            }

            spin.start();
            if (reviewAttempt >= MAX_WITHDRAW_CONFIRM_REVIEW_ATTEMPTS) {
              throw new CLIError(
                "Relayer quote expired repeatedly while you were confirming the withdrawal.",
                "RELAYER",
                "Re-run the withdrawal to fetch a fresh quote, then confirm promptly.",
                "RELAYER_CONFIRMATION_RETRY_LIMIT",
              );
            }
            warn(
              "Quote expired while you were confirming. Fetching a fresh relayer quote...",
              silent,
            );
            await fetchFreshQuote("Refreshing relayer quote after confirmation delay...");
          }
          if (!confirmedWithFreshQuote) {
            throw new CLIError(
              "Unable to keep a relayer quote fresh through confirmation.",
              "RELAYER",
              "Re-run the withdrawal to fetch a fresh quote, then confirm promptly.",
              "RELAYER_CONFIRMATION_RETRY_LIMIT",
            );
          }
        } else {
          if (Date.now() > expirationMs) {
            await fetchFreshQuote("Quote expired. Refreshing relayer quote before proof generation...");
          }
          if (!silent) {
            spin.stop();
            renderWithdrawalReview();
            spin.start();
          }
        }

        const validatedWithdrawalData = decodeValidatedRelayerWithdrawalData({
          quote,
          requestedRecipient: resolvedRecipientAddress,
          quoteFeeBPS,
        });

        const withdrawal = {
          processooor: chainConfig.entrypoint as Address,
          data: validatedWithdrawalData.withdrawalData,
        };

        const context = BigInt(
          calculateContext(withdrawal, pool.scope as unknown as SDKHash),
        );
        verbose(`Proof context: ${context.toString()}`, isVerbose, silent);

        // Pre-proof quote freshness check: refresh proactively when the
        // remaining validity window is tighter than our proof-time budget.
        {
          const preProofSecondsLeft = Math.max(
            0,
            Math.floor((expirationMs - Date.now()) / 1000),
          );
          if (preProofSecondsLeft < RELAYER_PROOF_REFRESH_BUDGET_SECONDS) {
            verbose(
              `Quote has only ${preProofSecondsLeft}s remaining before proof generation, refreshing proactively...`,
              isVerbose,
              silent,
            );
            const previousFeeBPS = quote.feeBPS;
            await fetchFreshQuote(
              "Quote nearly expired before proof. Refreshing so it survives proof generation...",
            );
            if (Number(quote.feeBPS) !== Number(previousFeeBPS)) {
              throw new CLIError(
              `Relayer fee changed during pre-proof refresh (${previousFeeBPS} → ${quote.feeBPS} BPS). Re-run the withdrawal.`,
                "RELAYER",
                "The proof must be bound to a stable fee. Re-run the withdrawal command to start with a fresh quote.",
              );
            }
          }
        }

        // Re-verify parity right before proving
        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "generating_proof",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "relayed",
          poolAccountId: selectedPoolAccount.paId,
        });
        writeWithdrawProgress(2, "Generating and locally verifying the relayed withdrawal proof.");
        await assertLatestRootUnchanged(
          "Pool state changed while preparing your proof.",
          "Re-run the withdrawal command to generate a fresh proof.",
        );

        const { stateTreeDepth, aspTreeDepth } = deriveWithdrawalTreeDepths({
          stateMerkleProof,
          aspMerkleProof,
        });
        const proof = await withProofProgress(
          spin,
          "Generating and verifying ZK proof",
          (progress) =>
            proveWithdrawal(commitment, {
              context,
              withdrawalAmount,
              stateMerkleProof,
              aspMerkleProof,
              stateRoot: stateProofRoot as unknown as SDKHash,
              stateTreeDepth,
              aspRoot,
              aspTreeDepth,
              newNullifier,
              newSecret,
            }, {
              progress,
            }),
          {
            dynamicSuffix: () =>
              `quote valid for ${formatRemainingTime(expirationMs)}`,
          },
        );
        verbose(
          `Proof generated: publicSignals=${proof.publicSignals.length}`,
          isVerbose,
          silent,
        );

        // Re-check parity before submit (in case of delay from user prompt)
        await assertLatestRootUnchanged(
          "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
          "Run 'privacy-pools sync' then retry the withdrawal.",
        );

        // Auto-refresh quote if it expired during proof generation.
        // The proof context is bound to the fee BPS, so a refreshed quote
        // with the same fee is safe; a fee change invalidates the proof.
        if (Date.now() > expirationMs) {
          verbose(
            "Quote expired after proof generation. Auto-refreshing...",
            isVerbose,
            silent,
          );
          const previousFeeBPS = quote.feeBPS;
          const previousWithdrawalData = withdrawal.data;
          await fetchFreshQuote("Quote expired after proof. Refreshing...");
          if (Number(quote.feeBPS) !== Number(previousFeeBPS)) {
            throw new CLIError(
              `Relayer fee changed during proof generation (${previousFeeBPS} → ${quote.feeBPS} BPS). Re-run the withdrawal.`,
              "RELAYER",
              "The proof is bound to the original fee. Re-run the withdrawal command to generate a fresh proof with the new fee.",
            );
          }
          const refreshedWithdrawalData = decodeValidatedRelayerWithdrawalData({
            quote,
            requestedRecipient: resolvedRecipientAddress,
            quoteFeeBPS,
          });
          if (
            refreshedWithdrawalData.withdrawalData.toLowerCase() !==
            previousWithdrawalData.toLowerCase()
          ) {
            throw new CLIError(
              "Relayer withdrawal data changed during proof generation. Re-run the withdrawal.",
              "RELAYER",
              "The proof is bound to the relayer-signed withdrawal data. Re-run the withdrawal command to generate a fresh proof.",
            );
          }
          verbose(
            `Quote refreshed with same fee (${quote.feeBPS} BPS), expires ${new Date(expirationMs).toISOString()}`,
            isVerbose,
            silent,
          );
        }

        if (isUnsigned) {
          const solidityProof = toWithdrawSolidityProof(proof);
          const unsignedRelayerHost =
            relayerHostLabel(quote.relayerUrl ?? relayerUrl)
            ?? "unknown-relayer";
          const payload = buildUnsignedRelayedWithdrawOutput({
            chainId: chainConfig.id,
            chainName: chainConfig.name,
            assetSymbol: pool.symbol,
            amount: withdrawalAmount,
            from: signerAddress,
            entrypoint: chainConfig.entrypoint,
            scope: pool.scope,
            recipient: resolvedRecipientAddress,
            selectedCommitmentLabel: commitmentLabel,
            selectedCommitmentValue: commitment.value,
            feeBPS: quote.feeBPS,
            quoteExpiresAt: new Date(expirationMs).toISOString(),
            quotedAt: new Date().toISOString(),
            baseFeeBPS: quote.baseFeeBPS,
            relayerHost: unsignedRelayerHost,
            extraGas: effectiveExtraGas,
            withdrawal,
            proof: solidityProof,
            relayerRequest: stringifyBigInts({
              scope: pool.scope,
              withdrawal,
              proof: proof.proof,
              publicSignals: proof.publicSignals,
              feeCommitment: quote.feeCommitment,
            }),
          });

          if (wantsTxFormat) {
            printRawTransactions(payload.transactions);
          } else {
            if (!isQuiet && !isJson) {
              info("Unsigned mode: building transaction payloads only; validation is approximate until broadcast.", false);
            }
            printJsonSuccess(
              {
                ...payload,
                poolAccountNumber: selectedPoolAccount.paNumber,
                poolAccountId: selectedPoolAccount.paId,
                relayerHost: relayerHostLabel(quote.relayerUrl ?? relayerUrl),
                quoteRefreshCount,
                rootMatchedAtProofTime: true,
                warnings: [...payload.warnings, ...recipientWarnings],
              },
              false,
            );
          }
          return;
        }

        if (isDryRun) {
          spin.succeed("Dry-run completed (no transaction submitted).");
          const ctx = createOutputContext(mode);
          renderWithdrawDryRun(ctx, {
            withdrawMode: "relayed",
            amount: withdrawalAmount,
            asset: pool.symbol,
            chain: chainConfig.name,
            decimals: pool.decimals,
            recipient: resolvedRecipientAddress,
            poolAccountNumber: selectedPoolAccount.paNumber,
            poolAccountId: selectedPoolAccount.paId,
            selectedCommitmentLabel: commitmentLabel,
            selectedCommitmentValue: commitment.value,
            proofPublicSignals: proof.publicSignals.length,
            feeBPS: quote.feeBPS,
            quoteExpiresAt: new Date(expirationMs).toISOString(),
            relayerHost: relayerHostLabel(quote.relayerUrl ?? relayerUrl),
            quoteRefreshCount,
            extraGas: effectiveExtraGas,
            rootMatchedAtProofTime: true,
            anonymitySet,
            remainingBelowMinGuidance,
            warnings: recipientWarnings,
          });
          return;
        }

        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "submitting_relay_request",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "relayed",
          poolAccountId: selectedPoolAccount.paId,
        });
        writeWithdrawProgress(3, "Submitting the signed and verified request to the relayer.");
        spin.text = "Submitting to relayer...";
        const result = await submitRelayRequest(chainConfig, {
          scope: pool.scope,
          withdrawal,
          proof: proof.proof,
          publicSignals: proof.publicSignals,
          feeCommitment: quote.feeCommitment,
          relayerUrl: quote.relayerUrl,
        });

        const relayExplorerUrl = explorerTxUrl(chainConfig.id, result.txHash);
        if (opts.noWait) {
          emitStreamJsonEvent(streamJson, {
            mode: "withdraw-progress",
            operation: "withdraw",
            event: "stage",
            stage: "submitted",
            chain: chainConfig.name,
            asset: pool.symbol,
            withdrawMode: "relayed",
            txHash: result.txHash,
          });
          spin.succeed("Relayed withdrawal submitted.");
          const submission = createSubmissionRecord({
            operation: "withdraw",
            sourceCommand: "withdraw",
            chain: chainConfig.name,
            asset: pool.symbol,
            poolAccountId: selectedPoolAccount.paId,
            poolAccountNumber: selectedPoolAccount.paNumber,
            recipient: resolvedRecipientAddress,
            transactions: [
              {
                description: "Relayed withdrawal",
                txHash: result.txHash as Hex,
              },
            ],
          });
          rememberSuccessfulWithdrawalRecipient(resolvedRecipientAddress, {
            ensName: recipientEnsName,
            chain: chainConfig.name,
          });

          const ctx = createOutputContext(mode);
          renderWithdrawSuccess(ctx, {
            status: "submitted",
            submissionId: submission.submissionId,
            withdrawMode: "relayed",
            txHash: result.txHash,
            blockNumber: null,
            amount: withdrawalAmount,
            recipient: resolvedRecipientAddress,
            asset: pool.symbol,
            chain: chainConfig.name,
            decimals: pool.decimals,
            poolAccountNumber: selectedPoolAccount.paNumber,
            poolAccountId: selectedPoolAccount.paId,
            poolAddress: pool.pool,
            scope: pool.scope,
            explorerUrl: relayExplorerUrl,
            feeBPS: quote.feeBPS,
            relayerHost: relayerHostLabel(quote.relayerUrl ?? relayerUrl),
            quoteRefreshCount,
            extraGas: effectiveExtraGas,
            extraGasFundAmount: quote.detail.extraGasFundAmount
              ? BigInt(quote.detail.extraGasFundAmount.eth)
              : null,
            nativeTokenPrice,
            remainingBalance: selectedPoolAccount.value - withdrawalAmount,
            tokenPrice,
            rootMatchedAtProofTime: true,
            reconciliationRequired: false,
            localStateSynced: false,
            warningCode: null,
            anonymitySet,
            warnings: recipientWarnings,
          });
          maybeLaunchBrowser({
            globalOpts,
            mode,
            url: relayExplorerUrl,
            label: "withdrawal transaction",
            silent,
          });
          return;
        }

        // Wait for onchain confirmation before updating state
        spin.text = "Waiting for relay transaction confirmation...";
        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "waiting_confirmation",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "relayed",
          txHash: result.txHash,
        });
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({
            hash: result.txHash as `0x${string}`,
            timeout: getConfirmationTimeoutMs(),
          });
        } catch {
          throw new CLIError(
            "Timed out waiting for relayed withdrawal confirmation.",
            "RPC",
            `The relayer may have replaced or delayed the transaction. Wait about ${confirmationTimeoutSeconds}s or re-run with --timeout <seconds>, then check the explorer and run 'privacy-pools sync' to update local state.`,
            "RPC_NETWORK_ERROR",
            true,
            undefined,
            {
              txHash: result.txHash,
              explorerUrl: relayExplorerUrl,
            },
          );
        }

        if (receipt.status !== "success") {
          throw new CLIError(
            `Relay transaction reverted: ${result.txHash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }
        const {
          reconciliationRequired,
          localStateSynced,
          warningCode,
        } = await persistWithReconciliation({
          accountService,
          chainConfig,
          dataService,
          mnemonic,
          pool,
          silent,
          isJson,
          isVerbose,
          errorLabel: "Withdrawal reconciliation",
          reconcileHint: `Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`,
          persistFailureMessage: "Relayed withdrawal confirmed onchain but failed to save locally",
          warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
          persist: () => {
            withSuppressedSdkStdoutSync(() =>
              accountService.addWithdrawalCommitment(
                commitment,
                commitment.value - withdrawalAmount,
                newNullifier,
                newSecret,
                receipt.blockNumber,
                result.txHash as Hex,
              ),
            );
            saveAccount(chainConfig.id, accountService.account);
            saveSyncMeta(chainConfig.id);
          },
        });
        if (reconciliationRequired) {
          warnSpinner(
            spin,
            "Withdrawal confirmed onchain; local state needs reconciliation.",
            silent,
          );
        } else {
          spin.succeed("Relayed withdrawal confirmed");
        }
        emitStreamJsonEvent(streamJson, {
          mode: "withdraw-progress",
          operation: "withdraw",
          event: "stage",
          stage: "confirmed",
          chain: chainConfig.name,
          asset: pool.symbol,
          withdrawMode: "relayed",
          txHash: result.txHash,
          blockNumber: receipt.blockNumber.toString(),
        });
        rememberSuccessfulWithdrawalRecipient(resolvedRecipientAddress, {
          ensName: recipientEnsName,
          chain: chainConfig.name,
        });

        const ctx = createOutputContext(mode);
        renderWithdrawSuccess(ctx, {
          withdrawMode: "relayed",
          txHash: result.txHash,
          blockNumber: receipt.blockNumber,
          amount: withdrawalAmount,
          recipient: resolvedRecipientAddress,
          asset: pool.symbol,
          chain: chainConfig.name,
          decimals: pool.decimals,
          poolAccountNumber: selectedPoolAccount.paNumber,
          poolAccountId: selectedPoolAccount.paId,
          poolAddress: pool.pool,
          scope: pool.scope,
          explorerUrl: relayExplorerUrl,
          feeBPS: quote.feeBPS,
          relayerHost: relayerHostLabel(quote.relayerUrl ?? relayerUrl),
          quoteRefreshCount,
          extraGas: effectiveExtraGas,
          extraGasFundAmount: quote.detail.extraGasFundAmount
            ? BigInt(quote.detail.extraGasFundAmount.eth)
            : null,
          nativeTokenPrice,
          remainingBalance: selectedPoolAccount.value - withdrawalAmount,
          tokenPrice,
          rootMatchedAtProofTime: true,
          reconciliationRequired,
          localStateSynced,
          warningCode,
          anonymitySet,
          warnings: recipientWarnings,
        });
        maybeLaunchBrowser({
          globalOpts,
          mode,
          url: relayExplorerUrl,
          label: "withdrawal transaction",
          silent,
        });
      }
    } finally {
      releaseLock();
    }
  } catch (error) {
    if (isPromptCancellationError(error)) {
      if (isJson || isUnsigned) {
        printError(promptCancelledError(), true);
      } else {
        info(PROMPT_CANCELLATION_MESSAGE, silent);
        process.exitCode = 0;
      }
      return;
    }
    if (await maybeRecoverMissingWalletSetup(error, cmd)) {
      return;
    }
    printError(
      withDirectConfirmDeprecationWarning(
        normalizeInitRequiredInputError(error),
        directConfirmDeprecationWarning,
      ),
      isJson || isUnsigned,
    );
  }
}

export async function handleWithdrawQuoteCommand(
  firstArg: string,
  secondArg: string | undefined,
  opts: WithdrawQuoteCommandOptions,
  subCmd: Command,
): Promise<void> {
  const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const silent = isQuiet || isJson;
  const isVerbose = globalOpts?.verbose ?? false;

  // Commander.js keeps shared flags like --to / --extra-gas on the parent
  // `withdraw` command, so read them from the parent opts for quote mode.
  const withdrawOpts = subCmd.parent?.opts() as
    | Record<string, unknown>
    | undefined;
  const effectiveTo = (opts.to ?? withdrawOpts?.to) as string | undefined;

  try {
    if (await maybeRenderPreviewScenario("withdraw quote")) {
      return;
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    verbose(
      `Chain: ${chainConfig.name} (${chainConfig.id})`,
      isVerbose,
      silent,
    );

    const { amount: amountStr, asset: positionalOrFlagAsset } =
      resolveAmountAndAssetInput(
        "withdraw quote",
        firstArg,
        secondArg,
      );

    let pool;
    if (positionalOrFlagAsset) {
      pool = await resolvePool(
        chainConfig,
        positionalOrFlagAsset,
        globalOpts?.rpcUrl,
      );
    } else {
      throw new CLIError(
        "No asset specified.",
        "INPUT",
        "Example: privacy-pools withdraw quote 0.1 ETH",
        "INPUT_MISSING_ASSET",
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool}`,
      isVerbose,
      silent,
    );

    // Resolve --extra-gas from the parent withdraw command.
    // Default true for ERC20, always false for native asset (ETH).
    const quoteIsNativeAsset = isNativePoolAsset(chainConfig.id, pool.asset);
    const parentExtraGas = withdrawOpts?.extraGas as boolean | undefined;
    const quoteExtraGas = quoteIsNativeAsset ? false : (parentExtraGas ?? true);
    if (quoteIsNativeAsset && parentExtraGas === true) {
      info(
        "Extra gas is not applicable for native-asset withdrawals because the chain native token already covers gas.",
        silent,
      );
    }

    const amount = parseAmount(amountStr, pool.decimals, {
      allowNegative: true,
    });
    validatePositive(amount, "Quote amount");

    const anonymitySet = await fetchWithdrawalAnonymitySet(
      chainConfig,
      pool,
      amount,
    );

    const recipient = effectiveTo
      ? assertSafeRecipientAddress(effectiveTo as `0x${string}`, "Recipient")
      : undefined;

    const spin = spinner("Requesting relayer quote...", silent);
    spin.start();
    const details = await getRelayerDetails(chainConfig, pool.asset);
    const relayerUrl = details.relayerUrl;
    const quoteResult = await requestQuoteWithExtraGasFallback(chainConfig, {
      amount,
      asset: pool.asset,
      extraGas: quoteExtraGas,
      ...(recipient ? { recipient } : {}),
      relayerUrl,
    });
    const resolvedQuoteExtraGas = quoteResult.extraGas;
    if (quoteResult.downgradedExtraGas) {
      warn(
        "Extra gas is not available for this relayer on the selected chain. Continuing without it.",
        silent,
      );
    }
    const quote = quoteResult.quote;
    spin.succeed("Quote received.");

    const expirationMs = quote.feeCommitment
      ? quote.feeCommitment.expiration < 1e12
        ? quote.feeCommitment.expiration * 1000
        : quote.feeCommitment.expiration
      : null;

    const ctx = createOutputContext(mode);
    const quoteTokenPrice = deriveTokenPrice(pool);
    const nativeTokenPrice = quote.detail.extraGasFundAmount
      ? await deriveNativeGasTokenPrice(chainConfig, globalOpts?.rpcUrl, pool)
      : null;
    const warnings = buildWithdrawQuoteWarnings({
      chainIsTestnet: chainConfig.isTestnet,
      assetSymbol: pool.symbol,
      minWithdrawAmount: BigInt(details.minWithdrawAmount),
      decimals: pool.decimals,
    });
    renderWithdrawQuote(ctx, {
      chain: chainConfig.name,
      asset: pool.symbol,
      amount,
      decimals: pool.decimals,
      recipient: recipient ?? null,
      minWithdrawAmount: details.minWithdrawAmount,
      quoteFeeBPS: quote.feeBPS,
      baseFeeBPS: quote.baseFeeBPS,
      feeCommitmentPresent: !!quote.feeCommitment,
      quoteExpiresAt: expirationMs
        ? new Date(expirationMs).toISOString()
        : null,
      relayerHost: relayerHostLabel(quote.relayerUrl ?? relayerUrl),
      quoteRefreshCount: 0,
      tokenPrice: quoteTokenPrice,
      nativeTokenPrice,
      extraGas: resolvedQuoteExtraGas,
      relayTxCost: quote.detail.relayTxCost,
      extraGasFundAmount: quote.detail.extraGasFundAmount,
      extraGasTxCost: quote.detail.extraGasTxCost,
      isTestnet: chainConfig.isTestnet,
      anonymitySet,
      warnings,
      chainOverridden: !!globalOpts?.chain,
    });
  } catch (error) {
    printError(normalizeInitRequiredInputError(error), isJson);
  }
}
