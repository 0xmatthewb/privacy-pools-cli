import type { Command } from "commander";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AccountService,
  type AccountCommitment,
  type Hash as SDKHash,
  type PrivacyPoolAccount,
  type RagequitEvent,
} from "@0xbow/privacy-pools-core-sdk";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getPublicClient, getDataService } from "../services/sdk.js";
import { proveCommitment } from "../services/proofs.js";
import { ragequit as submitRagequit } from "../services/contracts.js";
import {
  initializeAccountService,
  saveAccount,
  saveSyncMeta,
  withSuppressedSdkStdout,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { resolvePool, listPools } from "../services/pools.js";
import {
  formatIncompleteAspReviewDataMessage,
  loadAspDepositReviewState,
  normalizeDepositReviewStatuses,
} from "../services/asp.js";
import {
  collectLegacyMigrationCandidates,
  loadDeclinedLegacyLabels,
} from "../services/migration.js";
import { explorerTxUrl, POA_PORTAL_URL } from "../config/chains.js";
import {
  spinner,
  info,
  warn,
  verbose,
  formatAmount,
  deriveTokenPrice,
  formatUsdValue,
  usdSuffix,
} from "../utils/format.js";
import { printError, CLIError, promptCancelledError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { resolveOptionalAssetInput } from "../utils/positional.js";
import { createNextAction, createOutputContext } from "../output/common.js";
import {
  formatRagequitReview,
  renderRagequitDryRun,
  renderRagequitSuccess,
} from "../output/ragequit.js";
import { printRawTransactions, toRagequitSolidityProof } from "../utils/unsigned.js";
import { buildUnsignedRagequitOutput } from "../utils/unsigned-flows.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import type { GlobalOptions, PoolStats } from "../types.js";
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  buildAllPoolAccountRefs,
  buildDeclinedLegacyPoolAccountRefs,
  buildPoolAccountRefs,
  collectActiveLabels,
  describeUnavailablePoolAccount,
  getUnknownPoolAccountError,
  parsePoolAccountSelector,
  type PoolAccountRef,
} from "../utils/pool-accounts.js";
import {
  formatPoolAccountStatus,
  type AspApprovalStatus,
} from "../utils/statuses.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import {
  CONFIRMATION_TOKENS,
  confirmPrompt,
  confirmActionWithSeverity,
  formatPoolAccountPromptChoice,
  formatPoolPromptChoice,
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
import { persistWithReconciliation } from "../services/persist-with-reconciliation.js";
import { createSubmissionRecord } from "../services/submissions.js";

const poolDepositorAbi = [
  {
    name: "depositors",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_label", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

interface RagequitAdvisory {
  level: "info" | "warn";
  message: string;
}

interface RagequitCommandOptions {
  poolAccount?: string;
  confirmRagequit?: boolean;
  unsigned?: boolean | string;
  dryRun?: boolean;
  noWait?: boolean;
}

const CONFIRM_RAGEQUIT_DEPRECATION_WARNING = {
  code: "FLAG_DEPRECATED",
  message:
    "--confirm-ragequit is deprecated. Replaced by interactive confirmation. Will be removed in v3.x.",
  replacementCommand:
    "Remove --confirm-ragequit and confirm the public recovery interactively, or use --agent for explicit non-interactive consent.",
};

function withRagequitDeprecationWarning(
  error: unknown,
  warning: typeof CONFIRM_RAGEQUIT_DEPRECATION_WARNING | undefined,
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

const LOCAL_STATE_RECONCILIATION_WARNING_CODE =
  "LOCAL_STATE_RECONCILIATION_REQUIRED";
const RAGEQUIT_PRIVACY_WARNING_COPY =
  "Ragequit returns the full Pool Account balance, including any pending portion still under ASP review, to the original deposit address. You will not gain any privacy: this transaction publicly links your deposit to its withdrawal. This cannot be undone.";

interface RagequitAccountLoadResult {
  accountService: AccountService;
  legacyAccountService: AccountService | null;
  legacyDeclinedLabels: ReadonlySet<string> | null;
}

interface RagequitPoolInfo {
  chainId: number;
  address: Address;
  scope: SDKHash;
  deploymentBlock: bigint;
}

interface RequestedRagequitPoolAccountParams {
  requestedPoolAccounts: readonly PoolAccountRef[];
  allKnownPoolAccounts: readonly PoolAccountRef[];
  fromPaNumber: number;
  chainName: string;
  symbol: string;
}

export { createRagequitCommand } from "../command-shells/ragequit.js";

export function formatRagequitPoolAccountChoice(
  poolAccount: PoolAccountRef,
  decimals: number,
  symbol: string,
): string {
  return `${poolAccount.paId} • ${formatAmount(poolAccount.value, decimals, symbol)} • ${formatPoolAccountStatus(poolAccount.status)}`;
}

export function getRagequitAdvisory(
  poolAccount: PoolAccountRef,
): RagequitAdvisory | null {
  switch (poolAccount.status) {
    case "approved":
      return {
        level: "warn",
        message: `${poolAccount.paId} is approved. ${RAGEQUIT_PRIVACY_WARNING_COPY} Use 'privacy-pools withdraw --pool-account ${poolAccount.paId} ...' for a private withdrawal instead.`,
      };
    case "pending":
      return {
        level: "info",
        message: `${poolAccount.paId} is still pending ASP review. Ragequit is available if you prefer public recovery instead of waiting for approval.`,
      };
    case "poa_required":
      return {
        level: "info",
        message: `${poolAccount.paId} needs Proof of Association before it can use withdraw. Complete the PoA flow at ${POA_PORTAL_URL} for a private withdrawal, or continue with ragequit for public recovery.`,
      };
    case "declined":
      return {
        level: "info",
        message: `${poolAccount.paId} was declined by the ASP. Ragequit is the most common next action and will return funds publicly to the original deposit address. You can also leave funds in the pool if you prefer.`,
      };
    default:
      return null;
  }
}

export function isLegacyRecoveryFallbackError(error: unknown): error is CLIError {
  return (
    error instanceof CLIError &&
    (
      error.code === "ACCOUNT_WEBSITE_RECOVERY_REQUIRED" ||
      error.code === "ACCOUNT_MIGRATION_REQUIRED"
    )
  );
}

export async function loadRagequitAccountServices(
  dataService: Awaited<ReturnType<typeof getDataService>>,
  mnemonic: string,
  poolInfo: RagequitPoolInfo,
  chainId: number,
  suppressWarnings: boolean,
): Promise<RagequitAccountLoadResult> {
  try {
    return {
      accountService: await initializeAccountService(
        dataService,
        mnemonic,
        [poolInfo],
        chainId,
        true,
        suppressWarnings,
        true,
      ),
      legacyAccountService: null,
      legacyDeclinedLabels: null,
    };
  } catch (error) {
    // Mixed legacy wallets can require migration and website recovery at the
    // same time. Ragequit still needs access to declined legacy deposits in
    // that case, so treat both blocking restore codes as eligible fallback.
    if (!isLegacyRecoveryFallbackError(error)) {
      throw error;
    }

    const result = await withSuppressedSdkStdout(async () =>
      AccountService.initializeWithEvents(dataService, { mnemonic }, [poolInfo]),
    );
    if ((result.errors?.length ?? 0) > 0) {
      throw new CLIError(
        `Failed to load legacy website-recovery state: ${result.errors
          ?.slice(0, 3)
          .map((item) => item.reason)
          .join("; ")}`,
        "RPC",
        "Restore RPC access and retry ragequit once the account can be rebuilt cleanly.",
        undefined,
        true,
      );
    }

    const declinedLabels = await loadDeclinedLegacyLabels(
      chainId,
      collectLegacyMigrationCandidates(result.legacyAccount),
    );
    if (!result.legacyAccount || declinedLabels === null || declinedLabels.size === 0) {
      throw error;
    }

    return {
      accountService: result.account,
      legacyAccountService: result.legacyAccount,
      legacyDeclinedLabels: declinedLabels,
    };
  }
}

export function resolveRequestedRagequitPoolAccountOrThrow(
  params: RequestedRagequitPoolAccountParams,
): PoolAccountRef {
  const requestedPoolAccount = params.requestedPoolAccounts.find(
    (poolAccount) => poolAccount.paNumber === params.fromPaNumber,
  );
  if (requestedPoolAccount) {
    return requestedPoolAccount;
  }

  const historicalPoolAccount = params.allKnownPoolAccounts.find(
    (poolAccount) => poolAccount.paNumber === params.fromPaNumber,
  );
  const unavailableReason = historicalPoolAccount
    ? describeUnavailablePoolAccount(historicalPoolAccount, "ragequit")
    : null;
  if (historicalPoolAccount && unavailableReason) {
    throw new CLIError(
      unavailableReason,
      "INPUT",
      `Run 'privacy-pools accounts --chain ${params.chainName}' to inspect ${historicalPoolAccount.paId} and choose a Pool Account with remaining balance.`,
    );
  }

  const unknownPoolAccount = getUnknownPoolAccountError({
    paNumber: params.fromPaNumber,
    symbol: params.symbol,
    chainName: params.chainName,
    knownPoolAccountsCount: params.allKnownPoolAccounts.length,
  });
  throw new CLIError(
    unknownPoolAccount.message,
    "INPUT",
    unknownPoolAccount.hint,
  );
}

export function buildRagequitPoolAccountRefs(
  account: PrivacyPoolAccount | null | undefined,
  scope: bigint,
  spendableCommitments: readonly AccountCommitment[],
  approvedLabels: Set<string> | null,
  rawReviewStatuses: ReadonlyMap<string, string> | null,
): PoolAccountRef[] {
  return buildPoolAccountRefs(
    account,
    scope,
    spendableCommitments,
    approvedLabels,
    normalizeDepositReviewStatuses(rawReviewStatuses),
  );
}

export async function handleRagequitCommand(
  assetArg: string | undefined,
  opts: RagequitCommandOptions,
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
  const confirmRagequitDeprecationWarning =
    opts.confirmRagequit === true ? CONFIRM_RAGEQUIT_DEPRECATION_WARNING : undefined;
  const silent = isQuiet || isJson || isUnsigned || isDryRun;
  const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
  const isVerbose = globalOpts?.verbose ?? false;
  const confirmationTimeoutSeconds = Math.round(
    getConfirmationTimeoutMs() / 1000,
  );
  const isPromptCancelled = (error: unknown): boolean => {
    const normalized = String(error).trim().toLowerCase();
    const name = typeof error === "object" && error !== null && "name" in error &&
      typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : null;
    const message = typeof error === "object" && error !== null && "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message.trim().toLowerCase()
      : null;
    return (
      isPromptCancellationError(error) ||
      name === "AbortPromptError" ||
      name === "CancelPromptError" ||
      name === "ExitPromptError" ||
      message === PROMPT_CANCELLATION_MESSAGE.toLowerCase() ||
      message === "cancelled" ||
      message === "canceled" ||
      normalized === PROMPT_CANCELLATION_MESSAGE.toLowerCase() ||
      normalized === "cancelled" ||
      normalized === "canceled"
    );
  };
  const fromPaRaw = opts.poolAccount;
  const fromPaNumber =
    fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);
  const writeRagequitNarrative = createNarrativeProgressWriter({ silent });
  const writeRagequitProgress = (activeIndex: number, note?: string) => {
    writeRagequitNarrative(
      createNarrativeSteps([
        "Account synced",
        "Generate and verify Pool Account proof",
        "Submit ragequit",
      ], activeIndex, note),
    );
  };

  try {
    const legacyAssetFlag = (opts as { asset?: unknown }).asset;
    if (typeof legacyAssetFlag === "string" && legacyAssetFlag.length > 0) {
      throw new CLIError(
        "--asset has been replaced by a positional argument.",
        "INPUT",
        "Use 'privacy-pools ragequit <asset> --pool-account <PA-#>' instead.",
      );
    }

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

    if (await maybeRenderPreviewScenario("ragequit")) {
      return;
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    verbose(
      `Chain: ${chainConfig.name} (${chainConfig.id})`,
      isVerbose,
      silent,
    );

    const positionalOrFlagAsset = resolveOptionalAssetInput(
      "ragequit",
      assetArg,
    );

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
        message: "Select asset pool to ragequit:",
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
        "Run 'privacy-pools pools' to see available assets, then use a positional asset like 'privacy-pools ragequit ETH'.",
        "INPUT_MISSING_ASSET",
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
      isVerbose,
      silent,
    );

    if (
      await maybeRenderPreviewProgressStep("ragequit.load-account", {
        stage: {
          step: 1,
          total: 3,
          label: "Loading account state",
        },
        spinnerText: "Loading account...",
        doneText: "Account state loaded.",
      })
    ) {
      return;
    }

    if (
      !opts.poolAccount &&
      !skipPrompts &&
      await maybeRenderPreviewScenario("ragequit select", {
        timing: "after-prompts",
      })
    ) {
      return;
    }
    if (
      opts.poolAccount &&
      await maybeRenderPreviewScenario("ragequit confirm", {
        timing: "after-prompts",
      })
    ) {
      return;
    }

    if (
      await maybeRenderPreviewProgressStep("ragequit.generate-proof", {
        stage: {
          step: 2,
          total: 3,
          label: "Generating and verifying Pool Account proof",
        },
        spinnerText: "Generating and verifying Pool Account proof...",
        doneText: "Pool Account proof generated and verified.",
      })
    ) {
      return;
    }

    if (
      await maybeRenderPreviewProgressStep("ragequit.submit", {
        stage: {
          step: 3,
          total: 3,
          label: "Submitting ragequit",
        },
        spinnerText: "Submitting ragequit...",
        doneText: "Ragequit submitted.",
      })
    ) {
      return;
    }

    // Acquire process lock to prevent concurrent account mutations.
    const releaseLock = acquireProcessLock();
    try {
      const mnemonic = loadMnemonic();

      // Private key is only needed for onchain submission, not --unsigned or --dry-run
      let signerAddress: Address | null = null;
      if (!isUnsigned && !isDryRun) {
        const privateKey = loadPrivateKey();
        signerAddress = privateKeyToAccount(privateKey).address;
      }
      // In unsigned/dry-run modes, do NOT touch the key file at all — the signer is optional

      const dataService = await getDataService(
        chainConfig,
        pool.pool,
        globalOpts?.rpcUrl,
      );

      writeRagequitProgress(0, "Refreshing the latest Pool Account state.");
      const spin = spinner("Loading account...", silent);
      spin.start();

    const {
        accountService,
        legacyAccountService,
        legacyDeclinedLabels,
      } = await loadRagequitAccountServices(
        dataService,
        mnemonic,
        {
          chainId: chainConfig.id,
          address: pool.pool,
          scope: pool.scope as unknown as SDKHash,
          deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
        },
        chainConfig.id,
        silent,
      );

      // Get spendable commitments for this pool
      const spendable = withSuppressedSdkStdoutSync(() =>
        accountService.getSpendableCommitments(),
      );
      const poolCommitments = spendable.get(pool.scope) ?? [];
      const allKnownSafePoolAccounts = buildAllPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
      );
      const knownLabels = new Set(
        allKnownSafePoolAccounts.map((poolAccount) => poolAccount.label.toString()),
      );
      const declinedLegacyPoolAccounts = buildDeclinedLegacyPoolAccountRefs(
        legacyAccountService?.account,
        pool.scope,
        legacyDeclinedLabels ?? new Set<string>(),
        allKnownSafePoolAccounts.length + 1,
      ).filter((poolAccount) => !knownLabels.has(poolAccount.label.toString()));
      const declinedLegacyLabels = new Set(
        declinedLegacyPoolAccounts.map((poolAccount) => poolAccount.label.toString()),
      );
      const allKnownPoolAccounts = [
        ...allKnownSafePoolAccounts,
        ...declinedLegacyPoolAccounts,
      ];
      verbose(
        `Spendable commitments for scope: ${poolCommitments.length}`,
        isVerbose,
        silent,
      );

      if (fromPaNumber !== undefined && fromPaNumber !== null) {
        const requestedKnownPoolAccount = allKnownPoolAccounts.find(
          (poolAccount) => poolAccount.paNumber === fromPaNumber,
        );
        if (requestedKnownPoolAccount) {
          const unavailableReason = describeUnavailablePoolAccount(
            requestedKnownPoolAccount,
            "ragequit",
          );
          if (!unavailableReason) {
            // Keep going. A later selection step may still reject it if the
            // account stops being actionable after ASP/public-state filtering.
          } else {
            spin.stop();
            throw new CLIError(
              unavailableReason,
              "INPUT",
              `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect ${requestedKnownPoolAccount.paId} and choose a Pool Account with remaining balance.`,
            );
          }
        } else {
          spin.stop();
          const unknownPoolAccount = getUnknownPoolAccountError({
            paNumber: fromPaNumber,
            symbol: pool.symbol,
            chainName: chainConfig.name,
            knownPoolAccountsCount: allKnownPoolAccounts.length,
          });
          throw new CLIError(
            unknownPoolAccount.message,
            "INPUT",
            unknownPoolAccount.hint,
          );
        }
      }

      const activeLabels = collectActiveLabels(poolCommitments);
      const aspReviewState = !silent
        ? await loadAspDepositReviewState(chainConfig, pool.scope, activeLabels)
        : {
            approvedLabels: new Set<string>(),
            rawReviewStatuses: new Map<string, string>(),
            reviewStatuses: new Map<string, AspApprovalStatus>(),
            hasIncompleteReviewData: false,
          };
      const hasIncompleteAspReviewData = aspReviewState.hasIncompleteReviewData;
      const allPoolAccounts = buildAllPoolAccountRefs(
        accountService.account,
        pool.scope,
        poolCommitments,
        aspReviewState.approvedLabels,
        aspReviewState.reviewStatuses,
      );
      const poolAccounts = [
        ...buildRagequitPoolAccountRefs(
          accountService.account,
          pool.scope,
          poolCommitments,
          aspReviewState.approvedLabels,
          aspReviewState.rawReviewStatuses,
        ),
        ...declinedLegacyPoolAccounts.filter(
          (poolAccount) =>
            poolAccount.value > 0n &&
            describeUnavailablePoolAccount(poolAccount, "ragequit") === null,
        ),
      ];

      if (declinedLegacyPoolAccounts.length > 0 && !silent) {
        info(
          "Declined legacy Pool Accounts are available here for public ragequit recovery.",
          false,
        );
      }

      if (poolAccounts.length === 0) {
        spin.stop();
        throw new CLIError(
          "No available Pool Accounts found for ragequit.",
          "INPUT",
          `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect this wallet, or choose a different chain if the deposit was made elsewhere.`,
        );
      }

      const selectedUsesLegacyRecovery = (poolAccount: PoolAccountRef): boolean =>
        declinedLegacyLabels.has(poolAccount.label.toString());

      spin.stop();

      if (hasIncompleteAspReviewData && !silent) {
        warn(
          formatIncompleteAspReviewDataMessage("ragequit", chainConfig.name),
          false,
        );
      }

      // Select Pool Account
      let selectedPoolAccount: PoolAccountRef;
      if (fromPaNumber !== undefined && fromPaNumber !== null) {
        selectedPoolAccount = resolveRequestedRagequitPoolAccountOrThrow({
          requestedPoolAccounts: poolAccounts,
          allKnownPoolAccounts,
          fromPaNumber,
          chainName: chainConfig.name,
          symbol: pool.symbol,
        });
      } else if (!skipPrompts) {
        const tokenPrice = deriveTokenPrice(pool);
        ensurePromptInteractionAvailable();
        const selected = await selectPrompt<number>({
          message: "Select Pool Account to ragequit:",
          choices: poolAccounts.map((pa) => ({
            name: formatPoolAccountPromptChoice({
              poolAccountId: pa.paId,
              balance: pa.value,
              decimals: pool.decimals,
              symbol: pool.symbol,
              status: formatPoolAccountStatus(pa.status),
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
        selectedPoolAccount = poolAccounts.find(
          (pa) => pa.paNumber === selected,
        )!;
      } else {
        throw new CLIError(
          "Must specify --pool-account in non-interactive mode.",
          "INPUT",
          "Use --pool-account <PA-#> to select which Pool Account to ragequit.",
        );
      }

      const commitment = selectedPoolAccount.commitment;
      const selectedPoolAccountUsesLegacyRecovery =
        selectedUsesLegacyRecovery(selectedPoolAccount);
      verbose(
        `Selected ${selectedPoolAccount.paId}: label=${commitment.label.toString()} value=${commitment.value.toString()}`,
        isVerbose,
        silent,
      );
      const tokenPrice = deriveTokenPrice(pool);
      const recoverUsd = usdSuffix(commitment.value, pool.decimals, tokenPrice);
      const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

      const resolveDepositorAddress = async (): Promise<Address | null> => {
        try {
          return (await publicClient.readContract({
            address: pool.pool,
            abi: poolDepositorAbi,
            functionName: "depositors",
            args: [commitment.label],
          })) as Address;
        } catch (err) {
          verbose(
            `Could not verify depositor onchain: ${err instanceof Error ? err.message : String(err)}`,
            isVerbose,
            silent,
          );
          return null;
        }
      };

      const depositorAddress = await resolveDepositorAddress();

      // Always show the public recovery warning in human mode, even when --yes
      // skips the confirmation prompt.
      const advisory = getRagequitAdvisory(selectedPoolAccount);
      if (!silent) {
        process.stderr.write("\n");
        process.stderr.write(
          formatRagequitReview({
            poolAccountId: selectedPoolAccount.paId,
            amount: commitment.value,
            asset: pool.symbol,
            chain: chainConfig.name,
            decimals: pool.decimals,
            destinationAddress: depositorAddress,
            advisory: advisory?.message ?? null,
            advisoryKind: advisory?.level === "info" ? "read-only" : "warning",
            tokenPrice,
          }),
        );
      }

      // Interactive choice for approved accounts: offer to switch to private withdrawal
      if (selectedPoolAccount.status === "approved" && !skipPrompts) {
        ensurePromptInteractionAvailable();
        const choice = await selectPrompt<"ragequit" | "withdraw">({
          message:
            "This deposit is approved for private withdrawal. Continue with public ragequit anyway?",
          choices: [
            { name: "Yes, ragequit publicly", value: "ragequit" as const },
            { name: "Switch to private withdrawal", value: "withdraw" as const },
          ],
        });
        if (choice === "withdraw") {
          info(
            `Run: privacy-pools withdraw --pool-account ${selectedPoolAccount.paId} --to <recipient>`,
            false,
          );
          return;
        }
      }

      if (!skipPrompts) {
        if (!process.stdin.isTTY || !process.stderr.isTTY) {
          throw new CLIError(
            "Ragequit requires an interactive terminal.",
            "INPUT",
            "Re-run with --confirm-ragequit or --agent to confirm non-interactively.",
            "INPUT_RAGEQUIT_CONFIRMATION_REQUIRED",
          );
        }
        if (
          await maybeRenderPreviewScenario("ragequit confirm", {
            timing: "after-prompts",
          })
        ) {
          return;
        }
        const ok = await confirmActionWithSeverity({
          severity: "high_stakes",
          standardMessage: "Confirm ragequit?",
          highStakesToken: CONFIRMATION_TOKENS.ragequit,
          highStakesWarning:
            "This ragequit sends funds back to the original deposit address. It does not preserve privacy.",
          confirm: confirmPrompt,
        });
        if (!ok) {
          info("Ragequit cancelled.", silent);
          return;
        }
      } else if (
        !isDryRun &&
        selectedPoolAccount.status !== "approved" &&
        opts.confirmRagequit !== true
      ) {
        throw new CLIError(
          "Ragequit requires explicit privacy-loss acknowledgement in non-interactive mode.",
          "INPUT",
          "Re-run with --confirm-ragequit only if you intentionally want the public recovery path.",
          "INPUT_RAGEQUIT_CONFIRMATION_REQUIRED",
          false,
          undefined,
          {
            poolAccountId: selectedPoolAccount.paId,
            destinationAddress: depositorAddress,
          },
          undefined,
          {
            helpTopic: "ragequit",
            nextActions: [
              createNextAction(
                "ragequit",
                "Retry only if you intentionally prefer the public recovery path.",
                "after_dry_run",
                {
                  args: [pool.symbol],
                  options: {
                    agent: true,
                    chain: chainConfig.name,
                    poolAccount: selectedPoolAccount.paId,
                    confirmRagequit: true,
                  },
                },
              ),
            ],
          },
        );
      }

      if (
        selectedPoolAccount.status === "approved" &&
        skipPrompts &&
        !isDryRun &&
        opts.confirmRagequit !== true
      ) {
        throw new CLIError(
          `${selectedPoolAccount.paId} is approved for private withdrawal.`,
          "INPUT",
          `${RAGEQUIT_PRIVACY_WARNING_COPY} Use withdraw instead unless you intentionally prefer ragequit.`,
          "INPUT_APPROVED_POOL_ACCOUNT_RAGEQUIT_REQUIRES_OVERRIDE",
          false,
          undefined,
          {
            poolAccountId: selectedPoolAccount.paId,
            destinationAddress: depositorAddress,
          },
          undefined,
          {
            helpTopic: "ragequit",
            nextActions: [
              createNextAction(
                "withdraw",
                "Use the private withdrawal path first for an approved Pool Account.",
                "after_dry_run",
                {
                  args: [pool.symbol],
                  options: {
                    agent: true,
                    chain: chainConfig.name,
                    poolAccount: selectedPoolAccount.paId,
                  },
                  runnable: false,
                  parameters: [{ name: "to", type: "address", required: true }],
                },
              ),
              createNextAction(
                "ragequit",
                "Retry only if you intentionally prefer the public recovery path.",
                "after_dry_run",
                {
                  args: [pool.symbol],
                  options: {
                    agent: true,
                    chain: chainConfig.name,
                    poolAccount: selectedPoolAccount.paId,
                    confirmRagequit: true,
                  },
                },
              ),
            ],
          },
        );
      }

      // Pre-flight gas check (skip for unsigned - relying on external signer)
      if (!isUnsigned && !isDryRun) {
        if (!depositorAddress) {
          throw new CLIError(
            "Unable to verify the original depositor for ragequit.",
            "RPC",
            "Ragequit transactions must be sent by the original deposit address. Retry when RPC access is available.",
          );
        }

        await checkHasGas(publicClient, signerAddress!);

        // Pre-check: verify signer is the original depositor (avoids wasting proof generation)
        if (depositorAddress.toLowerCase() !== signerAddress!.toLowerCase()) {
          throw new CLIError(
            `Signer ${signerAddress} is not the original depositor (${depositorAddress}).`,
            "INPUT",
            "Only the original depositor can ragequit this Pool Account. Check your signer key.",
          );
        }
      }

      // Generate Pool Account proof
      writeRagequitProgress(
        1,
        "Generating and locally verifying the Pool Account proof required for ragequit.",
      );
      spin.start();

      const proof = await withProofProgress(
        spin,
        "Generating and verifying Pool Account proof",
        (progress) =>
          proveCommitment(
            commitment.value,
            commitment.label,
            commitment.nullifier,
            commitment.secret,
            { progress },
          ),
      );

      if (isDryRun) {
        spin.succeed("Dry-run completed (no transaction submitted).");
        const ctx = createOutputContext(mode);
        renderRagequitDryRun(ctx, {
          chain: chainConfig.name,
          asset: pool.symbol,
          amount: commitment.value,
          decimals: pool.decimals,
          destinationAddress: depositorAddress,
          poolAccountNumber: selectedPoolAccount.paNumber,
          poolAccountId: selectedPoolAccount.paId,
          selectedCommitmentLabel: commitment.label,
          selectedCommitmentValue: commitment.value,
          proofPublicSignals: proof.publicSignals.length,
          advisory: advisory?.message ?? null,
          tokenPrice,
          deprecationWarning: confirmRagequitDeprecationWarning,
        });
        return;
      }

      if (isUnsigned) {
        if (!depositorAddress) {
          throw new CLIError(
            "Unable to determine the original depositor for unsigned ragequit.",
            "RPC",
            "Unsigned ragequit transactions must be signed by the original deposit address. Retry when RPC access is available.",
          );
        }
        const solidityProof = toRagequitSolidityProof(proof);
        const payload = buildUnsignedRagequitOutput({
          chainId: chainConfig.id,
          chainName: chainConfig.name,
          assetSymbol: pool.symbol,
          amount: commitment.value,
          from: depositorAddress,
          poolAddress: pool.pool,
          poolAccountId: selectedPoolAccount.paId,
          selectedCommitmentLabel: commitment.label,
          selectedCommitmentValue: commitment.value,
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
              ...(confirmRagequitDeprecationWarning
                ? { deprecationWarning: confirmRagequitDeprecationWarning }
                : {}),
            },
            false,
          );
        }
        return;
      }

      // Submit ragequit
      writeRagequitProgress(
        2,
        "Simulating and submitting the ragequit transaction.",
      );
      const solidityProof = toRagequitSolidityProof(proof);
      const tx = await submitRagequit(
        chainConfig,
        pool.pool,
        solidityProof,
        globalOpts?.rpcUrl,
        undefined,
        {
          onSimulating: () => {
            spin.text = "Simulating ragequit transaction...";
          },
          onBroadcasting: () => {
            spin.text = "Submitting ragequit transaction...";
          },
        },
      );

      const ragequitExplorerUrl = explorerTxUrl(chainConfig.id, tx.hash);
      if (opts.noWait) {
        spin.succeed("Ragequit submitted.");
        const submission = createSubmissionRecord({
          operation: "ragequit",
          sourceCommand: "ragequit",
          chain: chainConfig.name,
          asset: pool.symbol,
          poolAccountId: selectedPoolAccount.paId,
          poolAccountNumber: selectedPoolAccount.paNumber,
          transactions: [
            {
              description: "Public recovery",
              txHash: tx.hash as Hex,
            },
          ],
        });

        const ctx = createOutputContext(mode);
        renderRagequitSuccess(ctx, {
          status: "submitted",
          submissionId: submission.submissionId,
          txHash: tx.hash,
          amount: commitment.value,
          asset: pool.symbol,
          chain: chainConfig.name,
          decimals: pool.decimals,
          poolAccountNumber: selectedPoolAccount.paNumber,
          poolAccountId: selectedPoolAccount.paId,
          poolAddress: pool.pool,
          scope: pool.scope,
          blockNumber: null,
          explorerUrl: ragequitExplorerUrl,
          destinationAddress: depositorAddress,
          advisory: advisory?.message ?? null,
          reconciliationRequired: false,
          localStateSynced: false,
          warningCode: null,
          tokenPrice,
          deprecationWarning: confirmRagequitDeprecationWarning,
        });
        maybeLaunchBrowser({
          globalOpts,
          mode,
          url: ragequitExplorerUrl,
          label: "ragequit transaction",
          silent,
        });
        return;
      }

      spin.text = "Waiting for confirmation...";
      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash: tx.hash as `0x${string}`,
          timeout: getConfirmationTimeoutMs(),
        });
      } catch {
        throw new CLIError(
          "Timed out waiting for ragequit confirmation.",
          "RPC",
          `Tx ${tx.hash} may still confirm. Wait about ${confirmationTimeoutSeconds}s or re-run with --timeout <seconds>, then run 'privacy-pools sync' to pick up the transaction.`,
        );
      }
      if (receipt.status !== "success") {
        throw new CLIError(
          `Ragequit transaction reverted: ${tx.hash}`,
          "CONTRACT",
          "Check the transaction on a block explorer for details.",
        );
      }

      if (selectedPoolAccountUsesLegacyRecovery) {
        warn(
          "Ragequit confirmed onchain. Legacy recovery state will refresh from chain events the next time the CLI syncs this account.",
          silent,
        );
      }

      let forceReconciliation = false;
      if (!selectedPoolAccountUsesLegacyRecovery) {
        try {
          const ragequitEvent: RagequitEvent = {
            ragequitter: signerAddress!,
            commitment: commitment.hash,
            label: commitment.label,
            value: commitment.value,
            blockNumber: receipt.blockNumber,
            transactionHash: tx.hash as Hex,
          };
          withSuppressedSdkStdoutSync(() =>
            accountService.addRagequitToAccount(
              commitment.label as unknown as SDKHash,
              ragequitEvent,
            ),
          );
        } catch (error) {
          warn(
            `Failed to record ragequit locally: ${error instanceof Error ? error.message : String(error)}. Next sync will pick it up.`,
            silent,
          );
          forceReconciliation = true;
        }
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
        errorLabel: "Ragequit reconciliation",
        reconcileHint: `Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`,
        persistFailureMessage: "Ragequit confirmed onchain but failed to save local state",
        forceReconciliation,
        allowLegacyRecoveryVisibility: true,
        warningCode: LOCAL_STATE_RECONCILIATION_WARNING_CODE,
        persist: selectedPoolAccountUsesLegacyRecovery
          ? undefined
          : () => {
              saveAccount(chainConfig.id, accountService.account);
              saveSyncMeta(chainConfig.id);
            },
      });
      if (reconciliationRequired) {
        spin.warn("Ragequit confirmed onchain; local state needs reconciliation.");
      } else {
        spin.succeed("Ragequit confirmed");
      }

      const ctx = createOutputContext(mode);
      renderRagequitSuccess(ctx, {
        txHash: tx.hash,
        amount: commitment.value,
        asset: pool.symbol,
        chain: chainConfig.name,
        decimals: pool.decimals,
        poolAccountNumber: selectedPoolAccount.paNumber,
        poolAccountId: selectedPoolAccount.paId,
        poolAddress: pool.pool,
        scope: pool.scope,
        blockNumber: receipt.blockNumber,
        explorerUrl: ragequitExplorerUrl,
        destinationAddress: depositorAddress,
        advisory: advisory?.message ?? null,
        reconciliationRequired,
        localStateSynced,
        warningCode,
        tokenPrice,
        deprecationWarning: confirmRagequitDeprecationWarning,
      });
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: ragequitExplorerUrl,
        label: "ragequit transaction",
        silent,
      });
    } finally {
      releaseLock();
    }
  } catch (error) {
    if (isPromptCancelled(error)) {
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
      withRagequitDeprecationWarning(
        normalizeInitRequiredInputError(error),
        confirmRagequitDeprecationWarning,
      ),
      isJson || isUnsigned,
    );
  }
}
