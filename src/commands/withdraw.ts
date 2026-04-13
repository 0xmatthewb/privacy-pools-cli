import type { Command } from "commander";
import { confirm, input, select } from "@inquirer/prompts";
import {
  generateMerkleProof,
  calculateContext,
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import type { Hex, Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  resolveChain,
  parseAmount,
  validateAddress,
  validatePositive,
  resolveAddressOrEns,
} from "../utils/validation.js";
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
import { resolvePool, listPools } from "../services/pools.js";
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
import type { GlobalOptions, PoolStats, RelayerQuoteResponse } from "../types.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import {
  formatDirectWithdrawalReview,
  formatRelayedWithdrawalReview,
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  renderWithdrawQuote,
} from "../output/withdraw.js";
import {
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
import { assertKnownPoolRoot } from "../services/pool-roots.js";
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

type WithdrawReviewStatus = Exclude<AspApprovalStatus, "approved">;

interface WithdrawCommandOptions {
  to?: string;
  poolAccount?: string;
  fromPa?: string;
  direct?: boolean;
  unsigned?: boolean | string;
  dryRun?: boolean;
  asset?: string;
  all?: boolean;
  extraGas?: boolean;
}

interface WithdrawQuoteCommandOptions {
  asset?: string;
  to?: string;
}

export { createWithdrawCommand } from "../command-shells/withdraw.js";

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

export function formatApprovalResolutionHint(params: {
  chainName: string;
  assetSymbol: string;
  poolAccountId?: string;
  status?: WithdrawReviewStatus;
}): string {
  const { chainName, assetSymbol, poolAccountId, status } = params;
  const ragequitSelector = poolAccountId ?? "<PA-#>";
  const ragequitCmd = `privacy-pools ragequit --chain ${chainName} --asset ${assetSymbol} --pool-account ${ragequitSelector}`;

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

export function getRelayedWithdrawalRemainderAdvisory(params: {
  remainingBalance: bigint;
  minWithdrawAmount: bigint;
  poolAccountId: string;
  assetSymbol: string;
  decimals: number;
}): string | null {
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
): {
  quoteFeeBPS: bigint;
  expirationMs: number;
} {
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

export async function refreshExpiredRelayerQuoteForWithdrawal(params: {
  fetchQuote: () => Promise<RelayerQuoteResponse>;
  maxRelayFeeBPS: bigint | string;
  nowMs?: () => number;
  maxAttempts?: number;
  onRetry?: (attempt: number, maxAttempts: number) => void;
}): Promise<{
  quote: RelayerQuoteResponse;
  quoteFeeBPS: bigint;
  expirationMs: number;
  attempts: number;
}> {
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

export async function handleWithdrawCommand(
  firstArg: string | undefined,
  secondArg: string | undefined,
  opts: WithdrawCommandOptions,
  cmd: Command,
): Promise<void> {
  // Deprecated --asset flag migration guard.
  if (opts.asset !== undefined) {
    throw new CLIError(
      "--asset has been replaced by a positional argument.",
      "INPUT",
      "Use: privacy-pools withdraw <amount> <asset> --to <address> (e.g. privacy-pools withdraw 0.05 ETH --to 0x...)",
    );
  }

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
  if (opts.fromPa !== undefined) {
    throw new CLIError(
      "--from-pa has been renamed to --pool-account.",
      "INPUT",
      `Use: --pool-account ${opts.fromPa}`,
    );
  }
  const fromPaRaw = opts.poolAccount as string | undefined;
  const fromPaNumber =
    fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);
  const writeWithdrawProgress = (activeIndex: number, note?: string) => {
    if (silent) return;
    const labels = isDirect
      ? [
          "Account & ASP data synced",
          "Generate withdrawal proof",
          "Submit withdrawal",
        ]
      : [
          "Account & ASP data synced",
          "Request relayer quote",
          "Generate withdrawal proof",
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
        "Using direct withdrawal. This is NOT privacy-preserving. Use relayed mode (default) for private withdrawals.",
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

    if (isAllWithdrawal) {
      if (secondArg !== undefined) {
        throw new CLIError(
          "Cannot specify an amount with --all.",
          "INPUT",
          "Use 'withdraw <asset> --all --to <address>' to withdraw the entire Pool Account balance.",
        );
      }
      positionalOrFlagAsset = opts.asset ?? firstArg;
      if (!positionalOrFlagAsset) {
        throw new CLIError(
          "--all requires an asset. Use 'withdraw --all ETH --to <address>' or '--all --asset <symbol>'.",
          "INPUT",
          "Run 'privacy-pools pools' to see available assets.",
        );
      }
      amountStr = "";
    } else {
      if (!firstArg) {
        throw new CLIError(
          "Missing amount. Specify an amount or use --all.",
          "INPUT",
          "Example: privacy-pools withdraw 0.05 ETH --to 0x... or privacy-pools withdraw --all --asset ETH --to 0x...",
        );
      }
      const resolved = resolveAmountAndAssetInput(
        "withdraw",
        firstArg,
        secondArg,
        opts.asset,
      );
      amountStr = resolved.amount;
      positionalOrFlagAsset = resolved.asset;
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

    // Private key is only needed for on-chain submission, not --unsigned or --dry-run
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
    if (opts.to) {
      const resolved = await resolveAddressOrEns(opts.to, "Recipient");
      recipientAddress = resolved.address;
      recipientEnsName = resolved.ensName;
      if (recipientEnsName) {
        info(`Resolved ${recipientEnsName} \u2192 ${recipientAddress}`, silent);
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
        "Specify a recipient with --to. Note: --direct is available but not recommended, as it publicly links your deposit and withdrawal addresses.",
      );
    }

    if (isDirect && recipientAddress && opts.to && signerAddress) {
      if (recipientAddress.toLowerCase() !== signerAddress.toLowerCase()) {
        throw new CLIError(
          "Direct withdrawal --to must match your signer address.",
          "INPUT",
          `Your signer address is ${signerAddress}. Use relayed mode (default) to withdraw to a different address.`,
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
        "No asset specified. Use --asset <symbol|address>.",
        "INPUT",
        "Run 'privacy-pools pools' to see available assets, then use --asset ETH (or the asset symbol).",
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
      isVerbose,
      silent,
    );

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
    let withdrawalUsd: string;

    if (!isDeferredAmount) {
      withdrawalAmount = parseAmount(amountStr, pool.decimals);
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
          label: "Generating ZK proof",
        },
        spinnerText: "Generating ZK proof...",
        doneText: "Proof ready.",
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
        true, // sync to pick up latest on-chain state
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

      // Ensure ASP tree and on-chain root are converged before proof generation.
      if (BigInt(roots.mtRoot) !== BigInt(roots.onchainMtRoot)) {
        throw new CLIError(
          "Withdrawal service data is still updating.",
          "ASP",
          "Wait a few seconds and retry.",
        );
      }

      // Verify ASP root parity against on-chain latest root.
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
        throw new CLIError(
          "No eligible Pool Account is currently approved for withdrawal.",
          "ASP",
          formatApprovalResolutionHint({
            chainName: chainConfig.name,
            assetSymbol: pool.symbol,
            status: singularStatus,
          }),
          "ACCOUNT_NOT_APPROVED",
          true,
        );
      }

      if (approvedSelection.kind === "insufficient") {
        throw new CLIError(
          `No Pool Account has enough balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`,
          "INPUT",
          `No approved Pool Accounts found for ${pool.symbol}. Check 'privacy-pools accounts' for pending approvals or deposit first.`,
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
        const requested = poolAccounts.find(
          (pa) => pa.paNumber === fromPaNumber,
        );
        if (!requested) {
          const historical = allPoolAccounts.find(
            (pa) => pa.paNumber === fromPaNumber,
          );
          const unavailableReason = historical
            ? describeUnavailablePoolAccount(historical, "withdraw")
            : null;
          if (historical && unavailableReason) {
            throw new CLIError(
              unavailableReason,
              "INPUT",
              `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect ${historical.paId} and choose a Pool Account with remaining balance.`,
            );
          }
          const unknownPoolAccount = getUnknownPoolAccountError({
            paNumber: fromPaNumber,
            symbol: pool.symbol,
            chainName: chainConfig.name,
            knownPoolAccountsCount: allPoolAccounts.length,
            availablePaIds: allPoolAccounts.map((pa) => pa.paId),
          });
          throw new CLIError(
            unknownPoolAccount.message,
            "INPUT",
            unknownPoolAccount.hint,
          );
        }

        if (!isDeferredAmount && requested.value < withdrawalAmount) {
          throw new CLIError(
            `${requested.paId} has insufficient balance for this withdrawal.`,
            "INPUT",
            `${requested.paId} balance: ${formatAmount(requested.value, pool.decimals, pool.symbol)}`,
          );
        }

        if (!approvedLabelSet.has(requested.label)) {
          throw new CLIError(
            `${requested.paId} is not currently approved for withdrawal.`,
            "ASP",
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
            true,
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
            const newAmountStr = await input({
              message: `Enter a new amount (minimum ${formatAmount(minWithdraw, pool.decimals, pool.symbol)}):`,
              validate: (val) => {
                try {
                  const parsed = parseAmount(val, pool.decimals);
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
            });
            withdrawalAmount = parseAmount(newAmountStr, pool.decimals);
            withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
            info(
              `Updated withdrawal amount: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent,
            );
            earlyMinCheckFailed = false;
            spin.start();
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
        spin.stop();
        if (
          await maybeRenderPreviewScenario("withdraw recipient input", {
            timing: "after-prompts",
          })
        ) {
          return;
        }
        ensurePromptInteractionAvailable();
        const prompted = await input({
          message: "Recipient address:",
          validate: (val) => {
            try {
              validateAddress(val, "Recipient");
              return true;
            } catch (e) {
              return e instanceof Error ? e.message : "Invalid address.";
            }
          },
        });
        recipientAddress = validateAddress(prompted, "Recipient");
        spin.start();
      }

      if (!recipientAddress) {
        throw new CLIError(
          "Relayed withdrawals require --to <address>.",
          "INPUT",
          "Specify a recipient with --to. Note: --direct is available but not recommended, as it publicly links your deposit and withdrawal addresses.",
        );
      }
      const resolvedRecipientAddress = recipientAddress;

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
            `Anonymity set: ${anonSet.eligibleDeposits} of ${anonSet.totalDeposits} deposits (${anonSet.percentage.toFixed(1)}%)`,
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
            highStakesToken: "WITHDRAW",
            highStakesWarning:
              "This direct withdrawal is public and will link the deposit and withdrawal onchain.",
            confirm,
          });
          if (!ok) {
            info("Withdrawal cancelled.", silent);
            return;
          }
          spin.start();
        }

        // Re-verify parity right before proving
        writeWithdrawProgress(1, "Building the direct withdrawal proof.");
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
          "Generating ZK proof",
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
            selectedCommitmentLabel: commitmentLabel,
            selectedCommitmentValue: commitment.value,
            withdrawal,
            proof: solidityProof,
          });

          if (wantsTxFormat) {
            printRawTransactions(payload.transactions);
          } else {
            printJsonSuccess(
              {
                ...payload,
                poolAccountNumber: selectedPoolAccount.paNumber,
                poolAccountId: selectedPoolAccount.paId,
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
            anonymitySet,
          });
          return;
        }

        await assertLatestRootUnchanged(
          "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
          "Run 'privacy-pools sync' then retry the withdrawal.",
        );

        writeWithdrawProgress(2, "Submitting the direct withdrawal transaction.");
        spin.text = "Submitting withdrawal transaction...";
        const tx = await withdrawDirect(
          chainConfig,
          pool.pool,
          withdrawal,
          solidityProof,
          globalOpts?.rpcUrl,
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
            `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to pick up the transaction.`,
          );
        }
        if (receipt.status !== "success") {
          throw new CLIError(
            `Withdrawal transaction reverted: ${tx.hash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }

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
            warn("Run 'privacy-pools sync' to update your local account state.", silent);
          }
        } finally {
          releaseCriticalSection();
        }
        spin.succeed("Direct withdrawal confirmed!");

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
          anonymitySet,
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
          spin.stop();
          const remainingBalance = selectedPoolAccount.value - withdrawalAmount;
          warn(
            `Remaining balance (${formatAmount(remainingBalance, pool.decimals, pool.symbol)}) would fall below the relayer minimum.`,
            silent,
          );
          ensurePromptInteractionAvailable();
          const remainderChoice = await select({
            message: "How would you like to proceed?",
            choices: [
              {
                name: "Withdraw the full balance instead",
                value: "full" as const,
              },
              {
                name: "Continue with this amount (remainder won't be privately withdrawable)",
                value: "continue" as const,
              },
            ],
          });
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
          }
          spin.start();
        } else if (skipPrompts && !silent && remainingBelowMinAdvisory) {
          warn(remainingBelowMinAdvisory, silent);
          process.stderr.write("\n");
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
              quoteFeeBPS,
              expirationMs,
              remainingBalance: selectedPoolAccount.value - withdrawalAmount,
              extraGasRequested: effectiveExtraGas,
              extraGasFundAmount: quote.detail.extraGasFundAmount
                ? BigInt(quote.detail.extraGasFundAmount.eth)
                : null,
              tokenPrice,
              remainingBelowMinAdvisory,
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
                "Quote expired. Refreshing relayer quote...",
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

            const highStakesToken = formatAmount(
              withdrawalAmount,
              pool.decimals,
              pool.symbol,
              displayDecimals(pool.decimals),
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
              highStakesToken,
              highStakesWarning:
                `This withdrawal moves ${highStakesToken} to ${formatAddress(resolvedRecipientAddress)}.` +
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
              "Quote expired while waiting for confirmation. Fetching a fresh quote...",
              silent,
            );
            await fetchFreshQuote("Refreshing relayer quote...");
          }
        } else {
          if (Date.now() > expirationMs) {
            await fetchFreshQuote("Quote expired. Refreshing relayer quote...");
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

        // Pre-proof quote freshness check: if less than 30 seconds remain,
        // refresh proactively so the quote doesn't expire during proof generation.
        {
          const preProofSecondsLeft = Math.max(
            0,
            Math.floor((expirationMs - Date.now()) / 1000),
          );
          if (preProofSecondsLeft < 30) {
            verbose(
              `Quote has only ${preProofSecondsLeft}s remaining before proof generation, refreshing proactively...`,
              isVerbose,
              silent,
            );
            const previousFeeBPS = quote.feeBPS;
            await fetchFreshQuote("Quote nearly expired before proof. Refreshing...");
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
        writeWithdrawProgress(2, "Building the relayed withdrawal proof.");
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
          `Generating ZK proof (quote valid for ${quoteValidLabel})`,
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
            printJsonSuccess(
              {
                ...payload,
                poolAccountNumber: selectedPoolAccount.paNumber,
                poolAccountId: selectedPoolAccount.paId,
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
            extraGas: effectiveExtraGas,
            anonymitySet,
          });
          return;
        }

        writeWithdrawProgress(3, "Submitting the signed request to the relayer.");
        spin.text = "Submitting to relayer...";
        const result = await submitRelayRequest(chainConfig, {
          scope: pool.scope,
          withdrawal,
          proof: proof.proof,
          publicSignals: proof.publicSignals,
          feeCommitment: quote.feeCommitment,
          relayerUrl: quote.relayerUrl,
        });

        // Wait for on-chain confirmation before updating state
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
            "The relayer may have replaced or delayed the transaction. Check the explorer and run 'privacy-pools sync' to update local state.",
          );
        }

        if (receipt.status !== "success") {
          throw new CLIError(
            `Relay transaction reverted: ${result.txHash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details.",
          );
        }
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
            warn("Run 'privacy-pools sync' to update your local account state.", silent);
          }
        } finally {
          releaseCriticalSection();
        }
        spin.succeed("Relayed withdrawal confirmed!");

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
          extraGas: effectiveExtraGas,
          remainingBalance: selectedPoolAccount.value - withdrawalAmount,
          tokenPrice,
          anonymitySet,
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

  // Commander.js consumes --asset / --to at the parent `withdraw` command
  // before the `quote` subcommand sees them.  Fall back to parent opts so
  // that `withdraw quote 0.1 --asset ETH --to 0x...` still works.
  const withdrawOpts = subCmd.parent?.opts() as
    | Record<string, unknown>
    | undefined;
  const effectiveAsset = (opts.asset ?? withdrawOpts?.asset) as
    | string
    | undefined;
  const effectiveTo = (opts.to ?? withdrawOpts?.to) as string | undefined;

  // Deprecation notice for --asset flag.
  if (effectiveAsset !== undefined) {
    warn("--asset is deprecated for withdraw quote. Use: privacy-pools withdraw quote <amount> <asset>", silent);
  }

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
        effectiveAsset,
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
        "No asset specified. Use --asset <symbol|address>.",
        "INPUT",
        "Example: privacy-pools withdraw quote 0.1 --asset ETH",
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool}`,
      isVerbose,
      silent,
    );

    // Resolve --extra-gas: read from parent withdraw opts (same pattern as --asset/--to).
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

    const amount = parseAmount(amountStr, pool.decimals);
    validatePositive(amount, "Quote amount");

    const recipient = effectiveTo
      ? validateAddress(effectiveTo, "Recipient")
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
      tokenPrice: quoteTokenPrice,
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
