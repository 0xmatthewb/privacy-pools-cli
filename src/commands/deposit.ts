import type { Command } from "commander";
import { type Hash as SDKHash } from "@0xbow/privacy-pools-core-sdk";
import type { Hex, Address } from "viem";
import {
  resolveChain,
  parseAmount,
  validatePositive,
} from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getPublicClient, getDataService } from "../services/sdk.js";
import { resolvePool, listPools } from "../services/pools.js";
import {
  initializeAccountService,
  saveAccount,
  saveSyncMeta,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { explorerTxUrl, isNativePoolAsset } from "../config/chains.js";
import {
  spinner,
  warnSpinner,
  info,
  verbose,
  formatAmount,
  deriveTokenPrice,
} from "../utils/format.js";
import {
  printError,
  CLIError,
  promptCancelledError,
} from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { emitStreamJsonEvent } from "../utils/stream-json.js";
import { normalizeDryRunMode, type DryRunMode } from "../utils/dry-run-mode.js";
import type { GlobalOptions } from "../types.js";
import { resolveAmountAndAssetInput } from "../utils/positional.js";
import {
  buildPrivacyNonRoundAmountWarning,
  isRoundAmount,
  suggestRoundAmounts,
  formatAmountDecimal,
} from "../utils/amount-privacy.js";
import { createOutputContext } from "../output/common.js";
import {
  formatDepositReview,
  formatUniqueAmountReview,
  renderDepositDryRun,
  renderDepositSuccess,
} from "../output/deposit.js";
import { buildUnsignedDepositOutput } from "../utils/unsigned-flows.js";
import {
  checkNativeBalance,
  checkErc20Balance,
  checkHasGas,
} from "../utils/preflight.js";
import { printRawTransactions } from "../utils/unsigned.js";
import { privateKeyToAccount } from "viem/accounts";
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  approveERC20,
  depositERC20,
  depositETH,
  hasSufficientErc20Allowance,
} from "../services/contracts.js";
import { decodeDepositReceiptLog } from "../services/deposit-events.js";
import {
  getNextPoolAccountNumber,
  poolAccountId,
} from "../utils/pool-accounts.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import {
  CONFIRMATION_TOKENS,
  confirmPrompt,
  confirmActionWithSeverity,
  formatPoolPromptChoice,
  isHighStakesUsdAmount,
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
import {
  createInitialSnapshot,
  saveWorkflowSnapshot,
} from "../services/workflow.js";
import { createSubmissionRecord } from "../services/submissions.js";
import { parseGasFeeOverrides } from "../utils/gas-fees.js";

interface DepositCommandOptions {
  unsigned?: boolean | string;
  dryRun?: boolean | string;
  wait?: boolean;
  noWait?: boolean;
  allowNonRoundAmounts?: boolean;
  streamJson?: boolean;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export { createDepositCommand } from "../command-shells/deposit.js";

const DEPOSIT_GAS_ESTIMATE_NATIVE = 250_000n;
const DEPOSIT_GAS_ESTIMATE_ERC20 = 375_000n;

function isHighStakesDeposit(params: {
  amount: bigint;
  decimals: number;
  chainIsTestnet: boolean;
  tokenPrice?: number | null;
}): boolean {
  return isHighStakesUsdAmount(params);
}

function depositPoolFundsMetric(pool: {
  totalInPoolValue?: bigint;
  acceptedDepositsValue?: bigint;
}): bigint {
  return pool.totalInPoolValue ?? pool.acceptedDepositsValue ?? 0n;
}

function sortDepositPromptPools<T extends {
  symbol: string;
  pool: string;
  totalInPoolValue?: bigint;
  acceptedDepositsValue?: bigint;
}>(pools: readonly T[]): T[] {
  return [...pools].sort((left, right) => {
    const leftFunds = depositPoolFundsMetric(left);
    const rightFunds = depositPoolFundsMetric(right);
    if (leftFunds !== rightFunds) {
      return leftFunds > rightFunds ? -1 : 1;
    }

    const bySymbol = left.symbol.localeCompare(right.symbol);
    if (bySymbol !== 0) return bySymbol;
    return left.pool.localeCompare(right.pool);
  });
}

async function bestEffortDepositGasEstimate(
  chainConfig: Awaited<ReturnType<typeof resolveChain>>,
  assetAddress: Address,
  rpcUrl: string | undefined,
): Promise<{ amount: bigint; symbol: string } | null> {
  try {
    const publicClient = getPublicClient(chainConfig, rpcUrl);
    const gasPrice = await publicClient.getGasPrice();
    const gasUnits = isNativePoolAsset(chainConfig.id, assetAddress)
      ? DEPOSIT_GAS_ESTIMATE_NATIVE
      : DEPOSIT_GAS_ESTIMATE_ERC20;
    return {
      amount: gasPrice * gasUnits,
      symbol: chainConfig.chain.nativeCurrency.symbol,
    };
  } catch {
    return null;
  }
}

export async function handleDepositCommand(
  firstArg: string,
  secondArg: string | undefined,
  opts: DepositCommandOptions,
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
  const dryRunMode: DryRunMode | null = normalizeDryRunMode(opts.dryRun);
  const isDryRun = dryRunMode !== null;
  const noWait = opts.wait === false || opts.noWait === true;
  const gasFeeOverrides = parseGasFeeOverrides(opts);
  const silent = isQuiet || isJson || isUnsigned || isDryRun;
  const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
  const isVerbose = globalOpts?.verbose ?? false;
  let errorRecoveryContext: Record<string, unknown> = {};
  try {
    emitStreamJsonEvent(streamJson, {
      mode: "deposit-progress",
      operation: "deposit",
      event: "stage",
      stage: "validating_input",
    });
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
    if (noWait && isDryRun) {
      throw new CLIError(
        "--no-wait cannot be combined with --dry-run.",
        "INPUT",
        "Use either --dry-run to preview or --no-wait to submit without waiting for confirmation.",
        "INPUT_FLAG_CONFLICT",
      );
    }
    if (noWait && isUnsigned) {
      throw new CLIError(
        "--no-wait cannot be combined with --unsigned.",
        "INPUT",
        "Use --unsigned to build a signer-facing envelope, or --no-wait to submit immediately and return a submission id.",
        "INPUT_FLAG_CONFLICT",
      );
    }
    if (isDryRun && isUnsigned) {
      throw new CLIError(
        "--unsigned cannot be combined with --dry-run.",
        "INPUT",
        "Use simulate deposit to preview validation, or use plain --unsigned to build an offline signing envelope.",
        "INPUT_FLAG_CONFLICT",
      );
    }
    if (!isQuiet && !isJson) {
      if (isDryRun) {
        info("Dry-run mode: previewing only; no transaction will be signed or submitted.", false);
      }
    }

    if (await maybeRenderPreviewScenario("deposit")) {
      return;
    }

    const config = loadConfig();
    const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
    errorRecoveryContext = { chain: chainConfig.name };
    emitStreamJsonEvent(streamJson, {
      mode: "deposit-progress",
      operation: "deposit",
      event: "stage",
      stage: "resolving_pool",
      chain: chainConfig.name,
    });
    verbose(
      `Chain: ${chainConfig.name} (${chainConfig.id})`,
      isVerbose,
      silent,
    );

    const { amount: amountStr, asset: positionalOrFlagAsset } =
      resolveAmountAndAssetInput("deposit", firstArg, secondArg);

    // Resolve pool
    let pool;
    if (positionalOrFlagAsset) {
      pool = await resolvePool(
        chainConfig,
        positionalOrFlagAsset,
        globalOpts?.rpcUrl,
      );
    } else if (!skipPrompts) {
      if (await maybeRenderPreviewScenario("deposit asset select")) {
        return;
      }
      const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
      if (pools.length === 0) {
        throw new CLIError(
          `No pools found on ${chainConfig.name}.`,
          "INPUT",
          "Run 'privacy-pools pools --chain <chain>' to see available pools.",
        );
      }
      const sortedPools = sortDepositPromptPools(pools);

      ensurePromptInteractionAvailable();
      const selected = await selectPrompt<string>({
        message: "Select asset to deposit:",
        choices: sortedPools.map((p) => ({
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
        "Run 'privacy-pools pools' to see available assets, then use a positional asset like 'privacy-pools deposit 0.1 ETH'.",
        "INPUT_MISSING_ASSET",
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
      isVerbose,
      silent,
    );
    emitStreamJsonEvent(streamJson, {
      mode: "deposit-progress",
      operation: "deposit",
      event: "stage",
      stage: "pool_resolved",
      chain: chainConfig.name,
      asset: pool.symbol,
      poolAddress: pool.pool,
    });

    // Parse and validate amount
    const amount = parseAmount(amountStr, pool.decimals, {
      allowNegative: true,
    });
    validatePositive(amount, "Deposit amount");
    verbose(`Deposit amount (raw): ${amount.toString()}`, isVerbose, silent);
    const nonRoundAmountWarning = buildPrivacyNonRoundAmountWarning({
      amount,
      decimals: pool.decimals,
      symbol: pool.symbol,
      escape: true,
    });
    const depositWarnings = nonRoundAmountWarning ? [nonRoundAmountWarning] : [];

    if (amount < pool.minimumDepositAmount) {
      throw new CLIError(
        `Deposit amount is below the minimum of ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)} for this pool.`,
        "INPUT",
        `Increase the amount to at least ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)}.`,
        "INPUT_BELOW_MINIMUM_DEPOSIT",
      );
    }

    // Privacy guard: non-round amounts can fingerprint deposits
    if (
      !isDryRun &&
      !opts.allowNonRoundAmounts &&
      !isRoundAmount(amount, pool.decimals, pool.symbol)
    ) {
      const humanAmount = formatAmountDecimal(amount, pool.decimals);
      const suggestions = suggestRoundAmounts(
        amount,
        pool.decimals,
        pool.symbol,
      );
      const suggestionStr =
        suggestions.length > 0
          ? ` Consider: ${suggestions.map((s) => `${formatAmountDecimal(s, pool.decimals)} ${pool.symbol}`).join(", ")}.`
          : "";
      const feeAmount = (amount * pool.vettingFeeBPS) / 10000n;
      const estimatedCommitted = amount - feeAmount;
      const message =
        `Vetting fees reduce your deposited amount by ${Number(pool.vettingFeeBPS) / 100}% in this pool, so ` +
        `${formatAmountDecimal(amount, pool.decimals)} ${pool.symbol} would commit approximately ` +
        `${formatAmountDecimal(estimatedCommitted, pool.decimals)} ${pool.symbol} onchain.${suggestionStr}`;

      if (skipPrompts) {
        // Agent / non-interactive mode: hard error
        throw new CLIError(
          "This deposit would create a distinctive committed amount.",
          "INPUT",
          `${message} Round committed balances are harder to fingerprint. Pass --allow-non-round-amounts to proceed anyway.`,
          "INPUT_NONROUND_AMOUNT",
          false,
          undefined,
          {
            command: "deposit",
            amountInput: amountStr,
            asset: pool.symbol,
            chain: chainConfig.name,
            suggestedRoundAmount: suggestions[0]
              ? formatAmountDecimal(suggestions[0], pool.decimals)
              : undefined,
          },
        );
      } else {
        // Interactive mode: warning + confirmation
        process.stderr.write("\n");
        process.stderr.write(
          formatUniqueAmountReview(
            `${message} Round committed balances are harder to fingerprint.`,
          ),
        );
        if (await maybeRenderPreviewScenario("deposit unique amount confirm")) {
          return;
        }
        ensurePromptInteractionAvailable();
        const proceed = await confirmPrompt({
          message: "Proceed with this amount anyway?",
          default: false,
        });
        if (!proceed) {
          info("Deposit cancelled.", silent);
          return;
        }
      }
    }

    // Show fee preview and confirm
    const feeAmount = (amount * pool.vettingFeeBPS) / 10000n;
    const estimatedCommitted = amount - feeAmount;
    const tokenPrice = deriveTokenPrice(pool);
    const estimatedGas = await bestEffortDepositGasEstimate(
      chainConfig,
      pool.asset,
      globalOpts?.rpcUrl,
    );
    const isNative = isNativePoolAsset(chainConfig.id, pool.asset);
    let balanceSufficient: boolean | "unknown" = "unknown";
    if (!isUnsigned && !isDryRun) {
      const privateKey = loadPrivateKey();
      const signerAddr = privateKeyToAccount(privateKey).address;
      const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

      if (isNative) {
        await checkNativeBalance(
          publicClient,
          signerAddr,
          amount,
          pool.symbol,
        );
      } else {
        await checkErc20Balance(
          publicClient,
          pool.asset,
          signerAddr,
          amount,
          pool.decimals,
          pool.symbol,
        );
        await checkHasGas(publicClient, signerAddr, "ETH", 2);
      }
      balanceSufficient = true;
    } else if (isDryRun && !isUnsigned) {
      try {
        const privateKey = loadPrivateKey();
        const signerAddr = privateKeyToAccount(privateKey).address;
        const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

        if (isNative) {
          await checkNativeBalance(
            publicClient,
            signerAddr,
            amount,
            pool.symbol,
          );
        } else {
          await checkErc20Balance(
            publicClient,
            pool.asset,
            signerAddr,
            amount,
            pool.decimals,
            pool.symbol,
          );
          await checkHasGas(publicClient, signerAddr, "ETH", 2);
        }
        balanceSufficient = true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        const isKeyError =
          msg.includes("private key") ||
          msg.includes("signer") ||
          msg.includes("mnemonic") ||
          msg.includes("ENOENT");
        balanceSufficient = isKeyError ? "unknown" : false;
      }
    }
    const reviewSignerAddress = !skipPrompts
      ? privateKeyToAccount(loadPrivateKey()).address
      : null;
    if (!skipPrompts) {
      const isErc20 = !isNativePoolAsset(chainConfig.id, pool.asset);
      process.stderr.write("\n");
      process.stderr.write(
        formatDepositReview({
          amount,
          feeAmount,
          estimatedCommitted,
          vettingFeeBPS: pool.vettingFeeBPS,
          asset: pool.symbol,
          chain: chainConfig.name,
          decimals: pool.decimals,
          depositorAddress: reviewSignerAddress ?? undefined,
          tokenPrice,
          isErc20,
          estimatedGasCost: estimatedGas?.amount,
          gasSymbol: estimatedGas?.symbol,
        }),
      );
      if (await maybeRenderPreviewScenario("deposit confirm")) {
        return;
      }
      const ok = await confirmActionWithSeverity({
        severity: isHighStakesDeposit({
          amount,
          decimals: pool.decimals,
          chainIsTestnet: chainConfig.isTestnet,
          tokenPrice,
        })
          ? "high_stakes"
          : "standard",
        standardMessage: "Confirm deposit?",
        highStakesToken: CONFIRMATION_TOKENS.deposit,
        highStakesWarning:
          `This mainnet deposit sends ${formatAmount(amount, pool.decimals, pool.symbol)} into a public pool before ASP review.`,
        confirm: confirmPrompt,
      });
      if (!ok) {
        info("Deposit cancelled.", silent);
        return;
      }
    }

    if (!isNativePoolAsset(chainConfig.id, pool.asset)) {
      if (
        await maybeRenderPreviewProgressStep("deposit.approve-token", {
          stage: {
            step: 1,
            total: 2,
            label: "Approving token spend",
          },
          spinnerText: "Approving token spend...",
          doneText: "Token approval ready.",
        })
      ) {
        return;
      }
    }

    if (
      await maybeRenderPreviewProgressStep("deposit.submit", {
        stage: {
          step: isNativePoolAsset(chainConfig.id, pool.asset) ? 1 : 2,
          total: isNativePoolAsset(chainConfig.id, pool.asset) ? 1 : 2,
          label: "Submitting deposit",
        },
        spinnerText: "Submitting deposit transaction...",
        doneText: "Deposit submitted.",
      })
    ) {
      return;
    }

    // Acquire process lock to prevent concurrent account mutations.
    const releaseLock = acquireProcessLock();
    try {
      emitStreamJsonEvent(streamJson, {
        mode: "deposit-progress",
        operation: "deposit",
        event: "stage",
        stage: isUnsigned
          ? "building_unsigned_payload"
          : isDryRun
            ? "building_dry_run"
            : "preflight",
        chain: chainConfig.name,
        asset: pool.symbol,
      });

      // Load wallet/account state and generate deposit secrets.
      const mnemonic = loadMnemonic();
      const dataService = await getDataService(
        chainConfig,
        pool.pool,
        globalOpts?.rpcUrl,
      );
      const writeDepositNarrative = createNarrativeProgressWriter({ silent });
      const writeDepositProgress = (activeIndex: number, note?: string) => {
        const labels = isNative
          ? ["Prepare deposit", "Generate deposit secret", "Submit deposit"]
          : ["Prepare deposit", "Approve token", "Submit deposit"];
        writeDepositNarrative(createNarrativeSteps(labels, activeIndex, note));
      };
      writeDepositProgress(0, "Loading wallet state and preparing the deposit.");
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
      const nextPANumber = getNextPoolAccountNumber(
        accountService.account,
        pool.scope,
      );
      const nextPAId = poolAccountId(nextPANumber);

      // The SDK derives deposit secrets from (mnemonic, scope, next index)
      // without mutating account state, so dry-run/unsigned paths can safely
      // preview the same precommitment without persisting anything first.
      const secrets = withSuppressedSdkStdoutSync(() =>
        accountService.createDepositSecrets(pool.scope as unknown as SDKHash),
      );
      const precommitment = secrets.precommitment;
      verbose(
        `Generated precommitment (truncated): ${precommitment.toString().slice(0, 8)}...`,
        isVerbose,
        silent,
      );
      if (isNative) {
        writeDepositProgress(1, "Deposit secret prepared and ready to submit.");
      }

      if (isDryRun) {
        const ctx = createOutputContext(mode);
        renderDepositDryRun(ctx, {
          chain: chainConfig.name,
          asset: pool.symbol,
          amount,
          decimals: pool.decimals,
          vettingFeeBPS: pool.vettingFeeBPS,
          feeAmount,
          estimatedCommitted,
          feesApply: pool.vettingFeeBPS > 0n,
          poolAccountNumber: nextPANumber,
          poolAccountId: nextPAId,
          precommitment: precommitment as unknown as bigint,
          balanceSufficient,
          dryRunMode,
          warnings: depositWarnings,
        });
        return;
      }

      if (isUnsigned) {
        // Avoid touching private key material in unsigned mode.
        const signerAddress: Address | null = null;

        const payload = buildUnsignedDepositOutput({
          chainId: chainConfig.id,
          chainName: chainConfig.name,
          entrypoint: chainConfig.entrypoint,
          assetAddress: pool.asset,
          assetSymbol: pool.symbol,
          amount,
          precommitment: precommitment as unknown as bigint,
          from: signerAddress,
          isNative,
        });

        if (wantsTxFormat) {
          printRawTransactions(payload.transactions);
        } else {
          if (!isQuiet && !isJson) {
            info("Unsigned mode: building transaction payloads only; validation is approximate until broadcast.", false);
          }
          printJsonSuccess(payload, false);
        }
        return;
      }

      const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
      let approvalTxHash: Hex | null = null;

      // ERC20 approval
      if (!isNative) {
        emitStreamJsonEvent(streamJson, {
          mode: "deposit-progress",
          operation: "deposit",
          event: "stage",
          stage: "approving_token",
          chain: chainConfig.name,
          asset: pool.symbol,
        });
        writeDepositProgress(1, "Approval is only needed for ERC20 deposits.");
        const spin = spinner("Approving token spend...", silent);
        spin.start();
        try {
          const allowanceStatus = await hasSufficientErc20Allowance({
            chainConfig,
            tokenAddress: pool.asset,
            spenderAddress: chainConfig.entrypoint,
            amount,
            rpcOverride: globalOpts?.rpcUrl,
          });
          if (allowanceStatus.sufficient) {
            spin.succeed("Existing token approval is already sufficient.");
          } else {
            if (noWait) {
              throw new CLIError(
                "Token approval is required before this ERC20 deposit can be submitted.",
                "INPUT",
                "Remove --no-wait so the CLI can wait for approval confirmation before submitting the deposit, then rerun the deposit command.",
                "INPUT_APPROVAL_REQUIRED_NO_WAIT",
              );
            }
            const approveTx = await approveERC20({
              chainConfig,
              tokenAddress: pool.asset,
              spenderAddress: chainConfig.entrypoint,
              amount,
              rpcOverride: globalOpts?.rpcUrl,
              gasFeeOverrides,
            });
            approvalTxHash = approveTx.hash as Hex;
            if (noWait) {
              spin.succeed("Token approval submitted.");
            } else {
              let approvalReceipt;
              try {
                const confirmationTimeoutMs = getConfirmationTimeoutMs();
                approvalReceipt = await publicClient.waitForTransactionReceipt({
                  hash: approveTx.hash as `0x${string}`,
                  timeout: confirmationTimeoutMs,
                });
              } catch {
                throw new CLIError(
                  "Timed out waiting for approval confirmation.",
                  "RPC",
                  `Tx ${approveTx.hash} may still confirm. Wait about ${Math.round(getConfirmationTimeoutMs() / 1000)}s or re-run with --timeout <seconds> to allow more time, then retry the deposit to check allowance.`,
                  "RPC_NETWORK_ERROR",
                  true,
                  undefined,
                  {
                    txHash: approveTx.hash,
                    approvalTxHash: approveTx.hash,
                    explorerUrl: explorerTxUrl(chainConfig.id, approveTx.hash),
                  },
                );
              }
              if (approvalReceipt.status !== "success") {
                throw new CLIError(
                  `Approval transaction reverted: ${approveTx.hash}`,
                  "CONTRACT",
                  "Check the transaction on a block explorer for details.",
                  "CONTRACT_ERROR",
                  false,
                  undefined,
                  { approvalTxHash: approveTx.hash },
                );
              }
              spin.succeed("Token approved.");
            }
          }
        } catch (error) {
          spin.fail("Approval failed.");
          throw error;
        }
      }

      // Deposit transaction
      emitStreamJsonEvent(streamJson, {
        mode: "deposit-progress",
        operation: "deposit",
        event: "stage",
        stage: "submitting_transaction",
        chain: chainConfig.name,
        asset: pool.symbol,
      });
      writeDepositProgress(2, "Submitting the public deposit.");
      const spin = spinner("Submitting deposit transaction...", silent);
      spin.start();

      let tx;
      if (isNative) {
        tx = await depositETH(
          chainConfig,
          amount,
          precommitment as unknown as bigint,
          globalOpts?.rpcUrl,
          undefined,
          gasFeeOverrides,
        );
      } else {
        tx = await depositERC20(
          chainConfig,
          pool.asset,
          amount,
          precommitment as unknown as bigint,
          globalOpts?.rpcUrl,
          undefined,
          gasFeeOverrides,
        );
      }

      const depositExplorer = explorerTxUrl(chainConfig.id, tx.hash);
      if (noWait) {
        emitStreamJsonEvent(streamJson, {
          mode: "deposit-progress",
          operation: "deposit",
          event: "stage",
          stage: "submitted",
          chain: chainConfig.name,
          asset: pool.symbol,
          txHash: tx.hash,
        });
        spin.succeed("Deposit submitted.");
        const workflowSnapshot = saveWorkflowSnapshot(createInitialSnapshot({
          workflowKind: "deposit_review",
          phase: "depositing_publicly",
          chain: chainConfig.name,
          asset: pool.symbol,
          assetDecimals: pool.decimals,
          depositAmount: amount,
          estimatedCommittedValue: estimatedCommitted,
          privacyDelayProfile: "off",
          privacyDelayConfigured: false,
          recipient: "",
          poolAccountNumber: nextPANumber,
          poolAccountId: nextPAId,
          depositTxHash: tx.hash,
          depositExplorerUrl: depositExplorer,
        }));
        const submission = createSubmissionRecord({
          operation: "deposit",
          sourceCommand: "deposit",
          chain: chainConfig.name,
          asset: pool.symbol,
          poolAccountId: nextPAId,
          poolAccountNumber: nextPANumber,
          workflowId: workflowSnapshot.workflowId,
          transactions: [
            ...(approvalTxHash
              ? [{ description: "Approve token spend", txHash: approvalTxHash }]
              : []),
            { description: "Deposit into pool", txHash: tx.hash as Hex },
          ],
        });
        const ctx = createOutputContext(mode);
        renderDepositSuccess(ctx, {
          status: "submitted",
          submissionId: submission.submissionId,
          workflowId: workflowSnapshot.workflowId,
          txHash: tx.hash,
          approvalTxHash,
          amount,
          committedValue: undefined,
          vettingFeeBPS: pool.vettingFeeBPS,
          vettingFeeAmount: feeAmount,
          estimatedCommitted,
          feesApply: pool.vettingFeeBPS > 0n,
          asset: pool.symbol,
          chain: chainConfig.name,
          decimals: pool.decimals,
          poolAccountNumber: nextPANumber,
          poolAccountId: nextPAId,
          poolAddress: pool.pool,
          scope: pool.scope,
          label: undefined,
          blockNumber: null,
          explorerUrl: depositExplorer,
          reconciliationRequired: false,
          localStateSynced: false,
          warningCode: null,
          chainOverridden: !!globalOpts?.chain,
        });
        maybeLaunchBrowser({
          globalOpts,
          mode,
          url: depositExplorer,
          label: "deposit transaction",
          silent,
        });
        return;
      }

      spin.text = "Waiting for confirmation...";
      emitStreamJsonEvent(streamJson, {
        mode: "deposit-progress",
        operation: "deposit",
        event: "stage",
        stage: "waiting_confirmation",
        chain: chainConfig.name,
        asset: pool.symbol,
        txHash: tx.hash,
      });
      let receipt;
      try {
        const confirmationTimeoutMs = getConfirmationTimeoutMs();
        receipt = await publicClient.waitForTransactionReceipt({
          hash: tx.hash as `0x${string}`,
          timeout: confirmationTimeoutMs,
        });
      } catch {
        throw new CLIError(
          "Timed out waiting for deposit confirmation.",
          "RPC",
          `Tx ${tx.hash} may still confirm. Wait about ${Math.round(getConfirmationTimeoutMs() / 1000)}s or re-run with --timeout <seconds>, then run 'privacy-pools sync' to pick up the transaction.`,
          "RPC_NETWORK_ERROR",
          true,
          undefined,
          {
            txHash: tx.hash,
            explorerUrl: depositExplorer,
            approvalTxHash: approvalTxHash ?? null,
          },
        );
      }
      if (receipt.status !== "success") {
        throw new CLIError(
          `Deposit transaction reverted: ${tx.hash}`,
          "CONTRACT",
          "Check the transaction on a block explorer for details.",
          "CONTRACT_ERROR",
          false,
          undefined,
          {
            txHash: tx.hash,
            explorerUrl: depositExplorer,
            approvalTxHash: approvalTxHash ?? null,
          },
        );
      }
      let label: bigint | undefined;
      let committedValue: bigint | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== pool.pool.toLowerCase()) {
          continue;
        }
        try {
          const decoded = decodeDepositReceiptLog({
            data: log.data,
            topics: log.topics,
          });
          label = decoded.label;
          committedValue = decoded.value;
          break;
        } catch {
          // Not this event
        }
      }

      const missingReceiptCommitment =
        label === undefined || committedValue === undefined;
      if (missingReceiptCommitment) {
        warnSpinner(
          spin,
          "Deposit confirmed onchain. Attempting automatic local reconciliation...",
          silent,
        );
      }

      const persistedValue = committedValue;
      const persistedLabel = label as unknown as SDKHash;
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
        errorLabel: "Deposit reconciliation",
        reconcileHint: `Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`,
        persistFailureMessage: "Deposit confirmed onchain but failed to save locally",
        forceReconciliation: missingReceiptCommitment,
        persist: missingReceiptCommitment
          ? undefined
          : () => {
              withSuppressedSdkStdoutSync(() =>
                accountService.addPoolAccount(
                  pool.scope as unknown as SDKHash,
                  persistedValue!,
                  secrets.nullifier,
                  secrets.secret,
                  persistedLabel!,
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
          "Deposit confirmed onchain; local state needs reconciliation.",
          silent,
        );
      } else {
        spin.succeed("Deposit confirmed");
      }
      emitStreamJsonEvent(streamJson, {
        mode: "deposit-progress",
        operation: "deposit",
        event: "stage",
        stage: "confirmed",
        chain: chainConfig.name,
        asset: pool.symbol,
        txHash: tx.hash,
        blockNumber: receipt.blockNumber.toString(),
      });

      const workflowSnapshot = saveWorkflowSnapshot(createInitialSnapshot({
        workflowKind: "deposit_review",
        phase: "awaiting_asp",
        chain: chainConfig.name,
        asset: pool.symbol,
        assetDecimals: pool.decimals,
        depositAmount: amount,
        estimatedCommittedValue: estimatedCommitted,
        privacyDelayProfile: "off",
        privacyDelayConfigured: false,
        recipient: "",
        poolAccountNumber: nextPANumber,
        poolAccountId: nextPAId,
        depositTxHash: tx.hash,
        depositBlockNumber: receipt.blockNumber,
        depositExplorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
        depositLabel: label,
        committedValue,
      }));

      const ctx = createOutputContext(mode);
      renderDepositSuccess(ctx, {
        status: "confirmed",
        workflowId: workflowSnapshot.workflowId,
        txHash: tx.hash,
        approvalTxHash,
        amount,
        committedValue,
        vettingFeeBPS: pool.vettingFeeBPS,
        vettingFeeAmount: feeAmount,
        estimatedCommitted,
        feesApply: pool.vettingFeeBPS > 0n,
        asset: pool.symbol,
        chain: chainConfig.name,
        decimals: pool.decimals,
        poolAccountNumber: nextPANumber,
        poolAccountId: nextPAId,
        poolAddress: pool.pool,
        scope: pool.scope,
        label,
        blockNumber: receipt.blockNumber,
        explorerUrl: depositExplorer,
        reconciliationRequired,
        localStateSynced,
        warningCode,
        chainOverridden: !!globalOpts?.chain,
      });
      maybeLaunchBrowser({
        globalOpts,
        mode,
        url: explorerTxUrl(chainConfig.id, tx.hash),
        label: "deposit transaction",
        silent,
      });
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
      normalizeInitRequiredInputError(error, errorRecoveryContext),
      isJson || isUnsigned,
    );
  }
}
