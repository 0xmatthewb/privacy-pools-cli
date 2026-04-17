import type { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
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
  syncAccountEvents,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { explorerTxUrl, isNativePoolAsset } from "../config/chains.js";
import {
  spinner,
  info,
  warn,
  verbose,
  formatAmount,
  deriveTokenPrice,
  formatUsdValue,
} from "../utils/format.js";
import {
  printError,
  CLIError,
  promptCancelledError,
  sanitizeDiagnosticText,
} from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import type { GlobalOptions } from "../types.js";
import { resolveAmountAndAssetInput } from "../utils/positional.js";
import {
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
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../utils/critical-section.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  approveERC20,
  depositERC20,
  depositETH,
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
  HIGH_STAKES_WITHDRAWAL_USD_THRESHOLD,
  confirmActionWithSeverity,
  formatPoolPromptChoice,
} from "../utils/prompts.js";
import { warnLegacyAssetFlag } from "../utils/deprecations.js";
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

interface DepositCommandOptions {
  asset?: string;
  unsigned?: boolean | string;
  dryRun?: boolean;
  ignoreUniqueAmount?: boolean;
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
  if (params.chainIsTestnet) {
    return false;
  }

  const usdValue = formatUsdValue(
    params.amount,
    params.decimals,
    params.tokenPrice ?? null,
  );
  if (usdValue === "-") {
    return false;
  }

  const parsed = Number(usdValue.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed >= HIGH_STAKES_WITHDRAWAL_USD_THRESHOLD;
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
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const unsignedRaw = opts.unsigned;
  const isUnsigned = unsignedRaw === true || typeof unsignedRaw === "string";
  const unsignedFormat =
    typeof unsignedRaw === "string" ? unsignedRaw.toLowerCase() : undefined;
  const wantsTxFormat = unsignedFormat === "tx";
  const isDryRun = opts.dryRun ?? false;
  const silent = isQuiet || isJson || isUnsigned || isDryRun;
  const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
  const isVerbose = globalOpts?.verbose ?? false;
  if (opts.asset !== undefined) {
    warnLegacyAssetFlag(
      "privacy-pools deposit <amount> <asset> (e.g. privacy-pools deposit 0.1 ETH)",
      silent,
    );
  }

  try {
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

    if (await maybeRenderPreviewScenario("deposit")) {
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
      resolveAmountAndAssetInput("deposit", firstArg, secondArg, opts.asset);

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
      const selected = await select({
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
      );
    }
    verbose(
      `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
      isVerbose,
      silent,
    );

    // Parse and validate amount
    const amount = parseAmount(amountStr, pool.decimals, {
      allowNegative: true,
    });
    validatePositive(amount, "Deposit amount");
    verbose(`Deposit amount (raw): ${amount.toString()}`, isVerbose, silent);

    if (amount < pool.minimumDepositAmount) {
      throw new CLIError(
        `Deposit amount is below the minimum of ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)} for this pool.`,
        "INPUT",
        `Increase the amount to at least ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)}.`,
      );
    }

    // Privacy guard: non-round amounts can fingerprint deposits
    if (
      !opts.ignoreUniqueAmount &&
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

      if (skipPrompts) {
        // Agent / non-interactive mode: hard error
        throw new CLIError(
          `Non-round amount ${humanAmount} ${pool.symbol} may reduce privacy.`,
          "INPUT",
          `Unique amounts can be linked between deposits and withdrawals.${suggestionStr} Pass --ignore-unique-amount to proceed anyway.`,
          "INPUT_NONROUND_AMOUNT",
        );
      } else {
        // Interactive mode: warning + confirmation
        process.stderr.write("\n");
        process.stderr.write(
          formatUniqueAmountReview(
            `${humanAmount} ${pool.symbol} is a non-round amount that may reduce your privacy in the anonymity set.${suggestionStr}`,
          ),
        );
        if (await maybeRenderPreviewScenario("deposit unique amount confirm")) {
          return;
        }
        ensurePromptInteractionAvailable();
        const proceed = await confirm({
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
        confirm,
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
      const isNative = isNativePoolAsset(chainConfig.id, pool.asset);

      // Pre-flight balance check before mnemonic/account work for faster feedback.
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

      // Load wallet/account state and generate deposit secrets.
      const mnemonic = loadMnemonic();
      const dataService = await getDataService(
        chainConfig,
        pool.pool,
        globalOpts?.rpcUrl,
      );
      const writeDepositProgress = (activeIndex: number, note?: string) => {
        if (silent) return;
        const labels = isNative
          ? ["Prepare deposit", "Generate deposit secret", "Submit deposit"]
          : ["Prepare deposit", "Approve token", "Submit deposit"];
        process.stderr.write(
          `\n${renderNarrativeSteps(createNarrativeSteps(labels, activeIndex, note))}`,
        );
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
          poolAccountNumber: nextPANumber,
          poolAccountId: nextPAId,
          precommitment: precommitment as unknown as bigint,
          balanceSufficient,
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

      // ERC20 approval
      if (!isNative) {
        writeDepositProgress(1, "Approval is only needed for ERC20 deposits.");
        const spin = spinner("Approving token spend...", silent);
        spin.start();
        try {
          const approveTx = await approveERC20({
            chainConfig,
            tokenAddress: pool.asset,
            spenderAddress: chainConfig.entrypoint,
            amount,
            rpcOverride: globalOpts?.rpcUrl,
          });
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
            );
          }
          if (approvalReceipt.status !== "success") {
            throw new CLIError(
              `Approval transaction reverted: ${approveTx.hash}`,
              "CONTRACT",
              "Check the transaction on a block explorer for details.",
            );
          }
          spin.succeed("Token approved.");
        } catch (error) {
          spin.fail("Approval failed.");
          throw error;
        }
      }

      // Deposit transaction
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
        );
      } else {
        tx = await depositERC20(
          chainConfig,
          pool.asset,
          amount,
          precommitment as unknown as bigint,
          globalOpts?.rpcUrl,
        );
      }

      spin.text = "Waiting for confirmation...";
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
        );
      }
      if (receipt.status !== "success") {
        throw new CLIError(
          `Deposit transaction reverted: ${tx.hash}`,
          "CONTRACT",
          "Check the transaction on a block explorer for details.",
        );
      }
      let label: bigint | undefined;
      let committedValue: bigint | undefined;
      let needsReconciliation = false;
      guardCriticalSection();
      try {
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

        if (label === undefined || committedValue === undefined) {
          spin.warn(
            "Deposit confirmed onchain. Attempting automatic local reconciliation...",
          );
          needsReconciliation = true;
        } else {
          // Persist the new commitment (7 individual args)
          try {
            const persistedValue = committedValue;
            const persistedLabel = label as unknown as SDKHash;
            withSuppressedSdkStdoutSync(() =>
              accountService.addPoolAccount(
                pool.scope as unknown as SDKHash,
                persistedValue,
                secrets.nullifier,
                secrets.secret,
                persistedLabel,
                receipt.blockNumber,
                tx.hash as Hex,
              ),
            );
            saveAccount(chainConfig.id, accountService.account);
            saveSyncMeta(chainConfig.id);
          } catch (saveErr) {
            warn(
              `Deposit confirmed onchain but failed to save locally: ${sanitizeDiagnosticText(saveErr instanceof Error ? saveErr.message : String(saveErr))}`,
              silent,
            );
            needsReconciliation = true;
          }
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
                errorLabel: "Deposit reconciliation",
                dataService,
                mnemonic,
              },
            );
            info("Local account state reconciled from chain events.", silent);
          } catch (syncErr) {
            warn(
              `Automatic reconciliation failed: ${sanitizeDiagnosticText(syncErr instanceof Error ? syncErr.message : String(syncErr))}`,
              silent,
            );
            warn(
              `Run 'privacy-pools sync --chain ${chainConfig.name}' to update your local account state.`,
              silent,
            );
          }
        }
      } finally {
        releaseCriticalSection();
      }
      spin.succeed("Deposit confirmed!");

      const ctx = createOutputContext(mode);
      renderDepositSuccess(ctx, {
        txHash: tx.hash,
        amount,
        committedValue,
        asset: pool.symbol,
        chain: chainConfig.name,
        decimals: pool.decimals,
        poolAccountNumber: nextPANumber,
        poolAccountId: nextPAId,
        poolAddress: pool.pool,
        scope: pool.scope,
        label,
        blockNumber: receipt.blockNumber,
        explorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
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
    printError(error, isJson || isUnsigned);
  }
}
