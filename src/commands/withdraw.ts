import type { Command } from "commander";
import { confirm, input, select } from "@inquirer/prompts";
import {
  generateMerkleProof,
  calculateContext,
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import { formatUnits, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  resolveChain,
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
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { accountHasDeposits } from "../services/account-storage.js";
import { resolvePool, listPools } from "../services/pools.js";
import {
  loadKnownRecipientHistory,
  rememberKnownRecipient,
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
  printError,
  CLIError,
  promptCancelledError,
  sanitizeDiagnosticText,
} from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
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
  formatAnonymitySetValue,
  formatDirectWithdrawalReview,
  formatRelayedWithdrawalReview,
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  renderWithdrawQuote,
} from "../output/withdraw.js";
import {
  CONFIRMATION_TOKENS,
  confirmActionWithSeverity,
  formatPoolAccountPromptChoice,
  formatPoolPromptChoice,
  isHighStakesWithdrawal,
} from "../utils/prompts.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
import {
  createNarrativeSteps,
  renderNarrativeSteps,
} from "../output/progress.js";
import { maybeRecoverMissingWalletSetup } from "../utils/setup-recovery.js";
import { maybeLaunchBrowser } from "../utils/web.js";
import {
  assertKnownPoolRoot,
  poolRootCacheScopeKey,
} from "../services/pool-roots.js";
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../utils/critical-section.js";
import { acquireProcessLock } from "../utils/lock.js";
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

type WithdrawReviewStatus = Exclude<AspApprovalStatus, "approved">;

interface WithdrawCommandOptions {
  to?: string;
  poolAccount?: string;
  direct?: boolean;
  confirmDirectWithdraw?: boolean;
  yesIUnderstandPrivacyLoss?: boolean;
  unsigned?: boolean | string;
  dryRun?: boolean;
  all?: boolean;
  extraGas?: boolean;
}

function relayerHostLabel(relayerUrl: string | undefined): string | null {
  if (!relayerUrl) return null;
  try {
    return new URL(relayerUrl).host;
  } catch {
    return relayerUrl;
  }
}

function buildDirectRecipientMismatchNextActions(params: {
  amountInput: string;
  assetInput: string | null;
  chainName: string;
  recipientAddress: Address;
  signerAddress: Address;
}): NextAction[] {
  const actions: NextAction[] = [];
  if (params.assetInput) {
    actions.push(
      createNextAction(
        "withdraw",
        "Use the default relayed mode to withdraw to a different recipient address.",
        "after_dry_run",
        {
          args: [params.amountInput, params.assetInput],
          options: {
            agent: true,
            chain: params.chainName,
            to: params.recipientAddress,
          },
        },
      ),
    );
    actions.push(
      createNextAction(
        "withdraw",
        "Retry direct mode without --to to auto-fill the signer address.",
        "after_dry_run",
        {
          args: [params.amountInput, params.assetInput],
          options: {
            agent: true,
            chain: params.chainName,
            direct: true,
            confirmDirectWithdraw: true,
          },
        },
      ),
    );
    return actions;
  }

  actions.push(
    createNextAction(
      "withdraw",
      "Use the default relayed mode to withdraw to a different recipient address.",
      "after_dry_run",
      {
        options: {
          agent: true,
          chain: params.chainName,
          to: params.recipientAddress,
        },
        runnable: false,
        parameters: [{ name: "asset", type: "asset", required: true }],
      },
    ),
  );
  actions.push(
    createNextAction(
      "withdraw",
      "Retry direct mode without --to to auto-fill the signer address.",
      "after_dry_run",
      {
        options: {
          agent: true,
          chain: params.chainName,
          direct: true,
          confirmDirectWithdraw: true,
        },
        runnable: false,
        parameters: [{ name: "asset", type: "asset", required: true }],
      },
    ),
  );
  return actions;
}

function buildRemainderBelowMinNextActions(params: {
  chainName: string;
  asset: string;
  decimals: number;
  recipient: Address;
  poolAccountId: string;
  poolAccountValue: bigint;
  minWithdrawAmount: bigint;
  signerAddress: Address | null;
}): NextAction[] {
  const actions: NextAction[] = [
    createNextAction(
      "withdraw",
      "Withdraw the full Pool Account balance so no stranded remainder is left behind.",
      "after_quote",
      {
        args: [params.asset],
        options: {
          agent: true,
          chain: params.chainName,
          all: true,
          to: params.recipient,
          poolAccount: params.poolAccountId,
        },
      },
    ),
    createNextAction(
      "ragequit",
      "Use the public recovery path instead of leaving a remainder below the relayer minimum.",
      "after_quote",
      {
        args: [params.asset],
        options: {
          agent: true,
          chain: params.chainName,
          poolAccount: params.poolAccountId,
          confirmRagequit: true,
        },
      },
    ),
  ];

  const maxSafeRelayedAmount = params.poolAccountValue - params.minWithdrawAmount;
  if (maxSafeRelayedAmount >= params.minWithdrawAmount) {
    actions.splice(
      1,
      0,
      createNextAction(
        "withdraw",
        "Withdraw less so the remaining balance stays privately withdrawable.",
        "after_quote",
        {
          args: [formatUnits(maxSafeRelayedAmount, params.decimals), params.asset],
          options: {
            agent: true,
            chain: params.chainName,
            to: params.recipient,
            poolAccount: params.poolAccountId,
          },
        },
      ),
    );
  }

  if (
    params.signerAddress &&
    params.recipient.toLowerCase() === params.signerAddress.toLowerCase()
  ) {
    actions.push(
      createNextAction(
        "withdraw",
        "Direct mode is also valid here because the recipient already matches the signer address.",
        "after_quote",
        {
          args: [formatUnits(params.poolAccountValue, params.decimals), params.asset],
          options: {
            agent: true,
            chain: params.chainName,
            direct: true,
            confirmDirectWithdraw: true,
          },
        },
      ),
    );
  }

  return actions;
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

export { createWithdrawCommand } from "../command-shells/withdraw.js";

function validateRecipientAddressOrEnsInput(value: string): true | string {
  const trimmed = value.trim();
  try {
    assertSafeRecipientAddress(trimmed as `0x${string}`, "Recipient");
    return true;
  } catch (error) {
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(trimmed)) {
      return true;
    }
    return error instanceof Error ? error.message : "Invalid address or ENS name.";
  }
}

async function promptRecipientAddressOrEns(
  silent: boolean,
): Promise<{ address: Address; ensName?: string }> {
  while (true) {
    const prompted = (await input({
      message: "Recipient address or ENS:",
      validate: validateRecipientAddressOrEnsInput,
    })).trim();
    try {
      const resolved = await resolveSafeRecipientAddressOrEns(
        prompted,
        "Recipient",
      );
      if (resolved.ensName) {
        info(`Resolved ${resolved.ensName} -> ${resolved.address}`, silent);
      }
      return { address: resolved.address, ensName: resolved.ensName };
    } catch (error) {
      warn(error instanceof Error ? error.message : "Invalid address or ENS name.", silent);
    }
  }
}

async function deriveNativeGasTokenPrice(
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

async function confirmRecipientIfNew(params: {
  address: string;
  knownRecipients: readonly string[];
  skipPrompts: boolean;
  silent: boolean;
}): Promise<RecipientSafetyWarning[]> {
  if (isKnownRecipient(params.address, params.knownRecipients)) {
    return [];
  }

  const warning = newRecipientWarning(params.address);
  if (params.skipPrompts) {
    return [warning];
  }

  warn(warning.message, params.silent);
  ensurePromptInteractionAvailable();
  const ok = await confirmActionWithSeverity({
    severity: "standard",
    standardMessage: "Use this new recipient?",
    highStakesToken: CONFIRMATION_TOKENS.recipient,
    highStakesWarning: "Recipient review changed while waiting for confirmation.",
    confirm,
  });
  if (!ok) {
    throw promptCancelledError();
  }
  return [];
}

function collectKnownWorkflowRecipients(): string[] {
  const recipients: string[] = [];
  for (const workflowId of listSavedWorkflowIds()) {
    try {
      const snapshot = getWorkflowStatus({ workflowId });
      if (snapshot.recipient) recipients.push(snapshot.recipient);
      if (snapshot.walletAddress) recipients.push(snapshot.walletAddress);
    } catch {
      // Ignore unreadable workflow files during transaction preflight. The
      // dedicated flow commands report workflow state strictly when requested.
    }
  }
  return recipients;
}

function collectKnownWithdrawalRecipients(
  signerAddress: Address | null,
): string[] {
  return [
    ...(signerAddress ? [signerAddress] : []),
    ...loadKnownRecipientHistory(),
    ...collectKnownWorkflowRecipients(),
  ];
}

function rememberSuccessfulWithdrawalRecipient(address: string): void {
  try {
    rememberKnownRecipient(address);
  } catch {
    // Best effort only. The withdrawal result should not fail because the
    // advisory recipient-history cache could not be updated.
  }
}

async function withSuspendedSpinner<T>(
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
  const statuses = new Set<WithdrawReviewStatus>();

  for (const poolAccount of poolAccounts) {
    if (poolAccount.value < withdrawalAmount) continue;
    if (poolAccount.status === "approved") continue;
    if (
      poolAccount.status === "pending" ||
      poolAccount.status === "poa_required" ||
      poolAccount.status === "declined" ||
      poolAccount.status === "unknown"
    ) {
      statuses.add(poolAccount.status);
    }
  }

  return Array.from(statuses);
}

export function formatApprovalResolutionHint(
  params: ApprovalResolutionHintParams,
): string {
  const { chainName, assetSymbol, poolAccountId, status } = params;
  const ragequitSelector = poolAccountId ?? "<PA-#>";
  const ragequitCmd = `privacy-pools ragequit ${assetSymbol} --chain ${chainName} --pool-account ${ragequitSelector}`;

  switch (status) {
    case "pending":
      return `ASP approval is required for both relayed and direct withdrawals. Run 'privacy-pools accounts --chain ${chainName}' to check aspStatus. ${DEPOSIT_APPROVAL_TIMELINE_COPY}`;
    case "poa_required":
      return `This Pool Account needs Proof of Association before it can use withdraw. Complete the PoA flow at ${POA_PORTAL_URL}, then re-run 'privacy-pools accounts --chain ${chainName}' to confirm aspStatus. If you prefer a public recovery path instead, use '${ragequitCmd}'.`;
    case "declined":
      return `This Pool Account was declined by the ASP. Private withdraw, including --direct, is unavailable. Ragequit is available to publicly recover funds to the original deposit address: '${ragequitCmd}'.`;
    default:
      return `Run 'privacy-pools accounts --chain ${chainName}' to inspect aspStatus. Pending deposits need more time, POA-needed deposits need Proof of Association at ${POA_PORTAL_URL}, and declined deposits can be recovered publicly via ragequit: '${ragequitCmd}'.`;
  }
}

export function getRelayedWithdrawalRemainderAdvisory(
  params: RelayedWithdrawalRemainderAdvisoryParams,
): string | null {
  const {
    remainingBalance,
    minWithdrawAmount,
    poolAccountId,
    assetSymbol,
    decimals,
  } = params;
  if (remainingBalance <= 0n || remainingBalance >= minWithdrawAmount) {
    return null;
  }

  return (
    `${poolAccountId} would keep ${formatAmount(remainingBalance, decimals, assetSymbol)}, ` +
    `which is below the relayer minimum (${formatAmount(minWithdrawAmount, decimals, assetSymbol)}). ` +
    "Options: withdraw a smaller amount to keep a privately withdrawable remainder, " +
    "use --all/100% to withdraw the entire balance, " +
    "or proceed and ragequit the remainder later (compromises privacy for the remainder)."
  );
}

export function normalizeRelayerQuoteExpirationMs(expiration: number): number {
  return expiration < 1e12 ? expiration * 1000 : expiration;
}

export function validateRelayerQuoteForWithdrawal(
  quote: Pick<RelayerQuoteResponse, "feeBPS" | "feeCommitment">,
  maxRelayFeeBPS: bigint | string,
): ValidatedRelayerQuoteForWithdrawal {
  if (!quote.feeCommitment) {
    throw new CLIError(
      "Relayer quote is missing required fee details.",
      "RELAYER",
      "The relayer may not support this asset/chain combination.",
    );
  }

  let quoteFeeBPS: bigint;
  try {
    quoteFeeBPS = BigInt(quote.feeBPS);
  } catch {
    throw new CLIError(
      "Relayer returned malformed feeBPS (expected integer string).",
      "RELAYER",
      "Request a fresh quote and retry.",
    );
  }

  const maxFeeBPS = typeof maxRelayFeeBPS === "bigint"
    ? maxRelayFeeBPS
    : BigInt(maxRelayFeeBPS);
  if (quoteFeeBPS > maxFeeBPS) {
    throw new CLIError(
      `Quoted relay fee (${formatBPS(quote.feeBPS)}) exceeds onchain maximum (${formatBPS(maxFeeBPS.toString())}).`,
      "RELAYER",
      "Try again later when fees are lower. If privacy is not a concern, --direct withdraws without a relayer but publicly links your deposit and withdrawal addresses.",
    );
  }

  return {
    quoteFeeBPS,
    expirationMs: normalizeRelayerQuoteExpirationMs(
      quote.feeCommitment.expiration,
    ),
  };
}

export async function refreshExpiredRelayerQuoteForWithdrawal(
  params: RefreshExpiredRelayerQuoteForWithdrawalParams,
): Promise<RefreshedRelayerQuoteForWithdrawal> {
  const nowMs = params.nowMs ?? Date.now;
  const maxAttempts = params.maxAttempts ?? 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1 && params.onRetry) {
      params.onRetry(attempt, maxAttempts);
    }
    const quote = await params.fetchQuote();
    const { quoteFeeBPS, expirationMs } = validateRelayerQuoteForWithdrawal(
      quote,
      params.maxRelayFeeBPS,
    );
    if (nowMs() <= expirationMs) {
      return {
        quote,
        quoteFeeBPS,
        expirationMs,
        attempts: attempt,
      };
    }
  }

  throw new CLIError(
    "Relayer returned stale/expired quotes repeatedly.",
    "RELAYER",
    "Wait a moment and retry, or switch to another relayer.",
  );
}

export function resolveRequestedWithdrawalPoolAccountOrThrow(
  params: RequestedWithdrawalPoolAccountParams,
): PoolAccountRef {
  const requested = params.requestedPoolAccounts.find(
    (poolAccount) => poolAccount.paNumber === params.fromPaNumber,
  );
  if (requested) {
    return requested;
  }

  const historical = params.allPoolAccounts.find(
    (poolAccount) => poolAccount.paNumber === params.fromPaNumber,
  );
  const unavailableReason = historical
    ? describeUnavailablePoolAccount(historical, "withdraw")
    : null;
  if (historical && unavailableReason) {
    throw new CLIError(
      unavailableReason,
      "INPUT",
      `Run 'privacy-pools accounts --chain ${params.chainName}' to inspect ${historical.paId} and choose a Pool Account with remaining balance.`,
    );
  }

  const unknownPoolAccount = getUnknownPoolAccountError({
    paNumber: params.fromPaNumber,
    symbol: params.symbol,
    chainName: params.chainName,
    knownPoolAccountsCount: params.allPoolAccounts.length,
    availablePaIds: params.allPoolAccounts.map((poolAccount) => poolAccount.paId),
  });
  throw new CLIError(
    unknownPoolAccount.message,
    "INPUT",
    unknownPoolAccount.hint,
  );
}

export async function handleWithdrawCommand(
  firstArg: string | undefined,
  secondArg: string | undefined,
  opts: WithdrawCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const unsignedRaw = opts.unsigned;
  const isUnsigned = unsignedRaw === true || typeof unsignedRaw === "string";
  const unsignedFormat =
    typeof unsignedRaw === "string" ? unsignedRaw.toLowerCase() : undefined;
  const wantsTxFormat = unsignedFormat === "tx";
  const isDryRun = opts.dryRun ?? false;
  const silent = isQuiet || isJson || isUnsigned;
  const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
  const isVerbose = globalOpts?.verbose ?? false;
  const isDirect = opts.direct ?? false;
  const confirmationTimeoutSeconds = Math.round(
    getConfirmationTimeoutMs() / 1000,
  );
  const fromPaRaw = opts.poolAccount;
  const fromPaNumber =
    fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);
  const writeWithdrawProgress = (activeIndex: number, note?: string) => {
    if (silent) return;
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
    process.stderr.write(
      `\n${renderNarrativeSteps(createNarrativeSteps(labels, activeIndex, note))}`,
    );
  };

  try {
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

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
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
        info(`Resolved ${recipientEnsName} -> ${recipientAddress}`, silent);
      }
    } else if (isDirect && !signerAddress) {
      throw new CLIError(
        "Direct withdrawal requires --to <address> in unsigned mode (no signer key available).",
        "INPUT",
        "Specify a recipient address with --to 0x...",
      );
    } else if (isDirect) {
      recipientAddress = signerAddress!;
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
      const selected = await select({
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
      );
    }
    if (
      isDirect &&
      !isDryRun &&
      (mode.skipPrompts || isUnsigned) &&
      opts.confirmDirectWithdraw !== true &&
      opts.yesIUnderstandPrivacyLoss !== true
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

    if (needsAmountPrompt) {
      ensurePromptInteractionAvailable();
      amountStr = (
        await input({
          message: `Withdrawal amount for ${pool.symbol} (e.g. 0.05, 50%, 100%):`,
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
        silent,
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
      const mnemonic = loadMnemonic();
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
        throw new CLIError(
          "No eligible Pool Account is currently approved for withdrawal.",
          "INPUT",
          formatApprovalResolutionHint({
            chainName: chainConfig.name,
            assetSymbol: pool.symbol,
            status: singularStatus,
          }),
          "ACCOUNT_NOT_APPROVED",
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
          throw new CLIError(
            `${requested.paId} is not currently approved for withdrawal.`,
            "INPUT",
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
            "ACCOUNT_NOT_APPROVED",
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
        const selectedPA = await select({
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
            const newAmountStr = await withSuspendedSpinner(spin, async () =>
              input({
                message: `Enter a new amount (minimum ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}):`,
                validate: (val) => {
                  try {
                    const parsed = parseAmount(val, pool.decimals, {
                      allowNegative: true,
                    });
                    validatePositive(parsed, "Withdrawal amount");
                    if (parsed > selectedPoolAccount.value) {
                      return `Amount exceeds ${selectedPoolAccount.paId} balance of ${formatAmount(selectedPoolAccount.value, pool.decimals, pool.symbol)}.`;
                    }
                    if (parsed < minWithdraw) {
                      return `Amount must be at least ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}.`;
                    }
                    return true;
                  } catch (e) {
                    return e instanceof Error ? e.message : "Invalid amount.";
                  }
                },
              })
            );
            withdrawalAmount = parseAmount(newAmountStr, pool.decimals, {
              allowNegative: true,
            });
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
            });
            if (advisory) {
              warn(advisory, silent);
              if (!skipPrompts) {
                const maxAmountLeavingWithdrawableRemainder =
                  selectedPoolAccount.value - minWithdraw;
                ensurePromptInteractionAvailable();
                const remainderChoice = await withSuspendedSpinner(
                  spin,
                  async () =>
                    select({
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
                          name: "Continue and exit the remainder later if needed",
                          value: "continue" as const,
                        },
                      ],
                    }),
                );

                if (remainderChoice === "max") {
                  withdrawalAmount = selectedPoolAccount.value;
                  withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
                  info(
                    `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
                    silent,
                  );
                } else if (remainderChoice === "less") {
                  const newAmountStr = await withSuspendedSpinner(
                    spin,
                    async () =>
                      input({
                        message: `Enter amount up to ${formatAmount(maxAmountLeavingWithdrawableRemainder, pool.decimals, pool.symbol)}:`,
                        validate: (val) => {
                          try {
                            const parsed = parseAmount(val, pool.decimals, {
                              allowNegative: true,
                            });
                            validatePositive(parsed, "Withdrawal amount");
                            if (parsed < minWithdraw) {
                              return `Amount must be at least ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}.`;
                            }
                            if (parsed > maxAmountLeavingWithdrawableRemainder) {
                              return `Amount must leave at least ${formatAmount(minWithdraw, pool.decimals, pool.symbol)} in ${selectedPoolAccount.paId}.`;
                            }
                            return true;
                          } catch (e) {
                            return e instanceof Error ? e.message : "Invalid amount.";
                          }
                        },
                      }),
                  );
                  withdrawalAmount = parseAmount(newAmountStr, pool.decimals, {
                    allowNegative: true,
                  });
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

      // Anonymity set info (non-fatal)
      let anonymitySet:
        | { eligible: number; total: number; percentage: number }
        | undefined;
      try {
        const anonSet = await fetchDepositsLargerThan(
          chainConfig,
          pool.scope,
          withdrawalAmount,
        );
        anonymitySet = {
          eligible: anonSet.eligibleDeposits,
          total: anonSet.totalDeposits,
          percentage: Number(anonSet.percentage.toFixed(1)),
        };
        if (!silent) {
          info(
            `Anonymity set: ${formatAnonymitySetValue(anonymitySet)}`,
            silent,
          );
        }
      } catch {
        /* non-fatal */
      }

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
          const ok = await confirmActionWithSeverity({
            severity: "high_stakes",
            standardMessage: "Confirm direct withdrawal?",
            highStakesToken: CONFIRMATION_TOKENS.directWithdrawal,
            highStakesWarning:
              `This direct withdrawal will publicly link your deposit and withdrawal addresses onchain. Recipient: ${directAddress}. This cannot be undone.`,
            confirm,
          });
          if (!ok) {
            info("Withdrawal cancelled.", silent);
            return;
          }
          spin.start();
        }

        // Re-verify parity right before proving
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
          });
          return;
        }

        await assertLatestRootUnchanged(
          "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
          "Run 'privacy-pools sync' then retry the withdrawal.",
        );

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

        spin.text = "Waiting for confirmation...";
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
          );
        }
        if (receipt.status !== "success") {
          throw new CLIError(
            `Withdrawal transaction reverted: ${tx.hash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }

        let needsReconciliation = false;
        let localStateSynced = true;
        let warningCode: string | null = null;
        guardCriticalSection();
        try {
          // Record the withdrawal in account state
          try {
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
          } catch (saveErr) {
            warn(
              `Withdrawal confirmed onchain but failed to save locally: ${sanitizeDiagnosticText(saveErr instanceof Error ? saveErr.message : String(saveErr))}`,
              silent,
            );
            needsReconciliation = true;
            localStateSynced = false;
          }
          if (needsReconciliation) {
            try {
              await syncAccountEvents(
                accountService,
                [{
                  chainId: chainConfig.id,
                  address: pool.pool,
                  scope: pool.scope,
                  deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
                }],
                [{ pool: pool.pool, symbol: pool.symbol }],
                chainConfig.id,
                {
                  skip: false,
                  force: true,
                  silent,
                  isJson,
                  isVerbose,
                  errorLabel: "Withdrawal reconciliation",
                  dataService,
                  mnemonic,
                },
              );
              info("Local account state reconciled from chain events.", silent);
              needsReconciliation = false;
              localStateSynced = true;
            } catch (syncErr) {
              warn(
                `Automatic reconciliation failed: ${sanitizeDiagnosticText(syncErr instanceof Error ? syncErr.message : String(syncErr))}`,
                silent,
              );
              warn(`Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`, silent);
              localStateSynced = false;
              warningCode = LOCAL_STATE_RECONCILIATION_WARNING_CODE;
            }
          }
        } finally {
          releaseCriticalSection();
        }
        if (needsReconciliation || !localStateSynced) {
          spin.warn("Withdrawal confirmed onchain; local state needs reconciliation.");
        } else {
          spin.succeed("Direct withdrawal confirmed!");
        }
        rememberSuccessfulWithdrawalRecipient(resolvedRecipientAddress);

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
          explorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
          remainingBalance: selectedPoolAccount.value - withdrawalAmount,
          tokenPrice,
          rootMatchedAtProofTime: true,
          reconciliationRequired: needsReconciliation || !localStateSynced,
          localStateSynced,
          warningCode,
          anonymitySet,
          warnings: recipientWarnings,
        });
        maybeLaunchBrowser({
          globalOpts,
          mode,
          url: explorerTxUrl(chainConfig.id, tx.hash),
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

        if (withdrawalAmount < BigInt(details.minWithdrawAmount)) {
          throw new CLIError(
            `Amount below relayer minimum of ${formatAmount(BigInt(details.minWithdrawAmount), pool.decimals, pool.symbol)}.`,
            "RELAYER",
            `Increase your withdrawal amount to at least ${formatAmount(BigInt(details.minWithdrawAmount), pool.decimals, pool.symbol)}.`,
          );
        }

        let remainingBelowMinAdvisory = getRelayedWithdrawalRemainderAdvisory(
          {
            remainingBalance: selectedPoolAccount.value - withdrawalAmount,
            minWithdrawAmount: BigInt(details.minWithdrawAmount),
            poolAccountId: selectedPoolAccount.paId,
            assetSymbol: pool.symbol,
            decimals: pool.decimals,
          },
        );

        if (remainingBelowMinAdvisory && !skipPrompts) {
          // Interactive mode: let the user choose how to handle the low remainder.
          const remainingBalance = selectedPoolAccount.value - withdrawalAmount;
          warn(
            `Remaining balance (${formatAmount(remainingBalance, pool.decimals, pool.symbol)}) would fall below the relayer minimum.`,
            silent,
          );
          ensurePromptInteractionAvailable();
          const minWithdrawAmount = BigInt(details.minWithdrawAmount);
          const maxAmountLeavingWithdrawableRemainder =
            selectedPoolAccount.value - minWithdrawAmount;
          const remainderChoice = await withSuspendedSpinner(
            spin,
            async () =>
              select({
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
                    name: "Continue and exit the remainder later if needed",
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
            remainingBelowMinAdvisory = getRelayedWithdrawalRemainderAdvisory({
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              minWithdrawAmount: BigInt(details.minWithdrawAmount),
              poolAccountId: selectedPoolAccount.paId,
              assetSymbol: pool.symbol,
              decimals: pool.decimals,
            });
          } else if (remainderChoice === "less") {
            const newAmountStr = await withSuspendedSpinner(
              spin,
              async () =>
                input({
                  message: `Enter amount up to ${formatAmount(maxAmountLeavingWithdrawableRemainder, pool.decimals, pool.symbol)}:`,
                  validate: (val) => {
                    try {
                      const parsed = parseAmount(val, pool.decimals, {
                        allowNegative: true,
                      });
                      validatePositive(parsed, "Withdrawal amount");
                      if (parsed < minWithdrawAmount) {
                        return `Amount must be at least ${formatAmount(minWithdrawAmount, pool.decimals, pool.symbol)}.`;
                      }
                      if (parsed > maxAmountLeavingWithdrawableRemainder) {
                        return `Amount must leave at least ${formatAmount(minWithdrawAmount, pool.decimals, pool.symbol)} in ${selectedPoolAccount.paId}.`;
                      }
                      return true;
                    } catch (e) {
                      return e instanceof Error ? e.message : "Invalid amount.";
                    }
                  },
                }),
            );
            withdrawalAmount = parseAmount(newAmountStr, pool.decimals, {
              allowNegative: true,
            });
            withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
            info(
              `Adjusted withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent,
            );
            remainingBelowMinAdvisory = getRelayedWithdrawalRemainderAdvisory({
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              minWithdrawAmount,
              poolAccountId: selectedPoolAccount.paId,
              assetSymbol: pool.symbol,
              decimals: pool.decimals,
            });
          }
        } else if (skipPrompts && remainingBelowMinAdvisory) {
          throw new CLIError(
            "This relayed withdrawal would leave a remainder below the relayer minimum.",
            "INPUT",
            remainingBelowMinAdvisory,
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
                minWithdrawAmount: BigInt(details.minWithdrawAmount),
                signerAddress,
              }),
            },
          );
        }

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
                  silent,
                );
              }
              return quoteResult.quote;
            },
            maxRelayFeeBPS: pool.maxRelayFeeBPS,
            onRetry: (attempt, max) => {
              warn(`Quote expired, refreshing... (attempt ${attempt}/${max})`, silent);
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
              remainingBelowMinAdvisory,
              anonymitySet,
            }),
          );
        };

        if (!skipPrompts) {
          while (true) {
            const secondsLeft = Math.max(
              0,
              Math.floor((expirationMs - Date.now()) / 1000),
            );
            if (secondsLeft <= 0) {
              await fetchFreshQuote(
                "Quote expired. Refreshing relayer quote before continuing...",
              );
              continue;
            }

            spin.stop();
            renderWithdrawalReview();
            if (
              await maybeRenderPreviewScenario("withdraw confirm", {
                timing: "after-prompts",
              })
            ) {
              return;
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
              confirm,
            });
            if (!ok) {
              info("Withdrawal cancelled.", silent);
              return;
            }

            if (Date.now() <= expirationMs) {
              spin.start();
              break;
            }

            spin.start();
            warn(
              "Quote expired while you were confirming. Fetching a fresh relayer quote...",
              silent,
            );
            await fetchFreshQuote("Refreshing relayer quote after confirmation delay...");
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
        writeWithdrawProgress(2, "Generating and locally verifying the relayed withdrawal proof.");
        await assertLatestRootUnchanged(
          "Pool state changed while preparing your proof.",
          "Re-run the withdrawal command to generate a fresh proof.",
        );

        const quoteValidLabel = formatRemainingTime(expirationMs);
        const { stateTreeDepth, aspTreeDepth } = deriveWithdrawalTreeDepths({
          stateMerkleProof,
          aspMerkleProof,
        });
        const proof = await withProofProgress(
          spin,
          `Generating and verifying ZK proof (quote valid for ${quoteValidLabel})`,
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
            warnings: recipientWarnings,
          });
          return;
        }

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

        // Wait for onchain confirmation before updating state
        spin.text = "Waiting for relay transaction confirmation...";
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
          );
        }

        if (receipt.status !== "success") {
          throw new CLIError(
            `Relay transaction reverted: ${result.txHash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }
        let needsReconciliation = false;
        let localStateSynced = true;
        let warningCode: string | null = null;
        guardCriticalSection();
        try {
          // Record the withdrawal in account state
          try {
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
          } catch (saveErr) {
            warn(
              `Relayed withdrawal confirmed onchain but failed to save locally: ${sanitizeDiagnosticText(saveErr instanceof Error ? saveErr.message : String(saveErr))}`,
              silent,
            );
            needsReconciliation = true;
            localStateSynced = false;
          }
          if (needsReconciliation) {
            try {
              await syncAccountEvents(
                accountService,
                [{
                  chainId: chainConfig.id,
                  address: pool.pool,
                  scope: pool.scope,
                  deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
                }],
                [{ pool: pool.pool, symbol: pool.symbol }],
                chainConfig.id,
                {
                  skip: false,
                  force: true,
                  silent,
                  isJson,
                  isVerbose,
                  errorLabel: "Withdrawal reconciliation",
                  dataService,
                  mnemonic,
                },
              );
              info("Local account state reconciled from chain events.", silent);
              needsReconciliation = false;
              localStateSynced = true;
            } catch (syncErr) {
              warn(
                `Automatic reconciliation failed: ${sanitizeDiagnosticText(syncErr instanceof Error ? syncErr.message : String(syncErr))}`,
                silent,
              );
              warn(`Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`, silent);
              localStateSynced = false;
              warningCode = LOCAL_STATE_RECONCILIATION_WARNING_CODE;
            }
          }
        } finally {
          releaseCriticalSection();
        }
        if (needsReconciliation || !localStateSynced) {
          spin.warn("Withdrawal confirmed onchain; local state needs reconciliation.");
        } else {
          spin.succeed("Relayed withdrawal confirmed!");
        }
        rememberSuccessfulWithdrawalRecipient(resolvedRecipientAddress);

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
          explorerUrl: explorerTxUrl(chainConfig.id, result.txHash),
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
          reconciliationRequired: needsReconciliation || !localStateSynced,
          localStateSynced,
          warningCode,
          anonymitySet,
          warnings: recipientWarnings,
        });
        maybeLaunchBrowser({
          globalOpts,
          mode,
          url: explorerTxUrl(chainConfig.id, result.txHash),
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
    printError(error, isJson || isUnsigned);
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
      chainOverridden: !!globalOpts?.chain,
    });
  } catch (error) {
    printError(error, isJson);
  }
}
