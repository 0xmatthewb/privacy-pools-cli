import type { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
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
  stageHeader,
  info,
  warn,
  verbose,
  formatAmount,
  formatAddress,
  deriveTokenPrice,
  usdSuffix,
} from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { resolveOptionalAssetInput } from "../utils/positional.js";
import { createOutputContext } from "../output/common.js";
import {
  renderRagequitDryRun,
  renderRagequitSuccess,
} from "../output/ragequit.js";
import { printRawTransactions, toRagequitSolidityProof } from "../utils/unsigned.js";
import { buildUnsignedRagequitOutput } from "../utils/unsigned-flows.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import type { GlobalOptions, PoolStats } from "../types.js";
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import {
  guardCriticalSection,
  releaseCriticalSection,
} from "../utils/critical-section.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  buildAllPoolAccountRefs,
  buildDeclinedLegacyPoolAccountRefs,
  buildPoolAccountRefs,
  collectActiveLabels,
  describeUnavailablePoolAccount,
  getUnknownPoolAccountError,
  parsePoolAccountSelector,
  poolAccountId,
  type PoolAccountRef,
} from "../utils/pool-accounts.js";
import {
  formatPoolAccountStatus,
  type AspApprovalStatus,
} from "../utils/statuses.js";

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
  asset?: string;
  fromPa?: string;
  commitment?: string;
  unsigned?: boolean | string;
  unsignedFormat?: string;
  dryRun?: boolean;
}

interface RagequitAccountLoadResult {
  accountService: AccountService;
  legacyAccountService: AccountService | null;
  legacyDeclinedLabels: ReadonlySet<string> | null;
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
        message: `${poolAccount.paId} is approved. Use 'privacy-pools withdraw --from-pa ${poolAccount.paId} ...' for a private withdrawal instead. Only continue with ragequit if you intentionally want public recovery.`,
      };
    case "pending":
      return {
        level: "info",
        message: `${poolAccount.paId} is still pending ASP review. Ragequit is available if you prefer public recovery instead of waiting for approval.`,
      };
    case "poi_required":
      return {
        level: "info",
        message: `${poolAccount.paId} needs Proof of Association before it can use withdraw. Complete the PoA flow at ${POA_PORTAL_URL} for a private withdrawal, or continue with ragequit for public recovery.`,
      };
    case "declined":
      return {
        level: "info",
        message: `${poolAccount.paId} was declined by the ASP. Ragequit is the only recovery path for this Pool Account and will return funds publicly to the original deposit address.`,
      };
    default:
      return null;
  }
}

function isLegacyRecoveryFallbackError(error: unknown): error is CLIError {
  return (
    error instanceof CLIError &&
    (
      error.code === "ACCOUNT_WEBSITE_RECOVERY_REQUIRED" ||
      error.code === "ACCOUNT_MIGRATION_REQUIRED"
    )
  );
}

async function loadRagequitAccountServices(
  dataService: Awaited<ReturnType<typeof getDataService>>,
  mnemonic: string,
  poolInfo: {
    chainId: number;
    address: Address;
    scope: SDKHash;
    deploymentBlock: bigint;
  },
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
  const silent = isQuiet || isJson || isUnsigned || isDryRun;
  const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
  const isVerbose = globalOpts?.verbose ?? false;
  const fromPaRaw = opts.fromPa as string | undefined;
  const fromPaNumber =
    fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);

  try {
    if (fromPaRaw !== undefined && fromPaNumber === null) {
      throw new CLIError(
        `Invalid --from-pa value: ${fromPaRaw}.`,
        "INPUT",
        "Use a Pool Account identifier like PA-2 (or just 2).",
      );
    }

    if (fromPaRaw !== undefined && opts.commitment !== undefined) {
      throw new CLIError(
        "Cannot use --from-pa and --commitment together.",
        "INPUT",
        "Use --from-pa for Pool Account selection. --commitment is deprecated.",
      );
    }

    if (opts.unsignedFormat !== undefined) {
      throw new CLIError(
        "--unsigned-format has been replaced by --unsigned [format].",
        "INPUT",
        `Use: privacy-pools ragequit ... --unsigned ${opts.unsignedFormat ?? "envelope"}`,
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
      opts.asset,
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
      const selected = await select({
        message: "Select asset pool to ragequit:",
        choices: pools.map((p) => ({
          name: `${p.symbol} (${formatAddress(p.asset)})`,
          value: p.symbol,
        })),
      });
      pool = pools.find((p) => p.symbol === selected)!;
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

    // Acquire process lock to prevent concurrent account mutations.
    const releaseLock = acquireProcessLock();
    try {
      const mnemonic = loadMnemonic();

      // Private key is only needed for on-chain submission, not --unsigned or --dry-run
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

      stageHeader(1, 3, "Loading account state", silent);
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
          (pa) => pa.paNumber === fromPaNumber,
        );
        const unavailableReason = requestedKnownPoolAccount
          ? describeUnavailablePoolAccount(
              requestedKnownPoolAccount,
              "ragequit",
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
          `You may not have deposits in ${pool.symbol}. Try 'privacy-pools deposit ...' first.`,
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
        const requestedPoolAccount = poolAccounts.find(
          (pa) => pa.paNumber === fromPaNumber,
        );
        if (!requestedPoolAccount) {
          const historicalPoolAccount = allKnownPoolAccounts.find(
            (pa) => pa.paNumber === fromPaNumber,
          );
          const unavailableReason = historicalPoolAccount
            ? describeUnavailablePoolAccount(historicalPoolAccount, "ragequit")
            : null;
          if (historicalPoolAccount && unavailableReason) {
            throw new CLIError(
              unavailableReason,
              "INPUT",
              `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect ${historicalPoolAccount.paId} and choose a Pool Account with remaining balance.`,
            );
          }
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
        selectedPoolAccount = requestedPoolAccount;
      } else if (opts.commitment !== undefined) {
        const idx = parseInt(opts.commitment, 10);
        if (isNaN(idx) || idx < 0 || idx >= poolCommitments.length) {
          throw new CLIError(
            `Invalid commitment index: ${opts.commitment}. Valid range: 0-${poolCommitments.length - 1}`,
            "INPUT",
            "This legacy index is deprecated. Use --from-pa PA-<n> instead.",
          );
        }
        const legacyCommitment = poolCommitments[idx];
        const matchedPoolAccount = poolAccounts.find(
          (pa) =>
            pa.label.toString() === legacyCommitment.label.toString() &&
            pa.commitment.hash.toString() === legacyCommitment.hash.toString(),
        );
        if (!matchedPoolAccount) {
          selectedPoolAccount = {
            paNumber: idx + 1,
            paId: poolAccountId(idx + 1),
            status: "unknown",
            aspStatus: "unknown",
            commitment: legacyCommitment,
            label: legacyCommitment.label,
            value: legacyCommitment.value,
            blockNumber: legacyCommitment.blockNumber,
            txHash: legacyCommitment.txHash,
          };
        } else {
          selectedPoolAccount = matchedPoolAccount;
        }
        if (!silent) {
          warn(
            "--commitment is deprecated. Use --from-pa PA-<n> instead.",
            false,
          );
        }
      } else if (!skipPrompts) {
        const selected = await select({
          message: "Select Pool Account to ragequit:",
          choices: poolAccounts.map((pa) => ({
            name: formatRagequitPoolAccountChoice(
              pa,
              pool.decimals,
              pool.symbol,
            ),
            value: pa.paNumber,
          })),
        });
        selectedPoolAccount = poolAccounts.find(
          (pa) => pa.paNumber === selected,
        )!;
      } else {
        throw new CLIError(
          "Must specify --from-pa in non-interactive mode.",
          "INPUT",
          "Use --from-pa <PA-#> to select which Pool Account to ragequit.",
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
      if (!silent) {
        process.stderr.write("\n");

        warn(
          "Ragequit withdraws funds publicly to your deposit address and does not preserve privacy. If your deposit is approved, use 'withdraw' instead for a private withdrawal.",
          silent,
        );
        const advisory = getRagequitAdvisory(selectedPoolAccount);
        if (advisory) {
          if (advisory.level === "warn") {
            warn(advisory.message, silent);
          } else {
            info(advisory.message, silent);
          }
        }
        if (depositorAddress) {
          info(`Funds will be sent to: ${depositorAddress}`, silent);
        }
        process.stderr.write("\n");
      }

      if (!skipPrompts) {
        const ok = await confirm({
          message: `Exit ${selectedPoolAccount.paId} and recover ${formatAmount(commitment.value, pool.decimals, pool.symbol)}${recoverUsd} publicly to your deposit address? Privacy is lost and this cannot be undone.`,
          default: false,
        });
        if (!ok) {
          info("Ragequit cancelled.", silent);
          return;
        }
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

      // Generate commitment proof
      stageHeader(2, 3, "Generating commitment proof", silent);
      spin.start();

      const proof = await withProofProgress(
        spin,
        "Generating commitment proof",
        () =>
          proveCommitment(
            commitment.value,
            commitment.label,
            commitment.nullifier,
            commitment.secret,
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
          selectedCommitmentLabel: commitment.label,
          selectedCommitmentValue: commitment.value,
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

      // Submit ragequit
      stageHeader(3, 3, "Submitting ragequit", silent);
      const solidityProof = toRagequitSolidityProof(proof);
      spin.text = "Submitting ragequit transaction...";
      const tx = await submitRagequit(
        chainConfig,
        pool.pool,
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
          "Timed out waiting for ragequit confirmation.",
          "RPC",
          `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to pick up the transaction.`,
        );
      }
      if (receipt.status !== "success") {
        throw new CLIError(
          `Ragequit transaction reverted: ${tx.hash}`,
          "CONTRACT",
          "Check the transaction on a block explorer for details.",
        );
      }

      guardCriticalSection();
      try {
        // Mark the account as ragequit so it's excluded from getSpendableCommitments()
        try {
          if (!selectedPoolAccountUsesLegacyRecovery) {
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
          }
        } catch (err) {
          // Non-fatal: next sync will discover the ragequit event on-chain
          warn(
              `Failed to record ragequit locally: ${err instanceof Error ? err.message : String(err)}. Next sync will pick it up.`,
              silent,
            );
        }

        try {
          if (selectedPoolAccountUsesLegacyRecovery) {
            warn(
              "Ragequit confirmed onchain. Legacy recovery state will refresh from chain events the next time the CLI syncs this account.",
              silent,
            );
          } else {
            saveAccount(chainConfig.id, accountService.account);
            saveSyncMeta(chainConfig.id);
          }
        } catch (err) {
          warn(
              `Ragequit confirmed onchain but failed to save local state: ${err instanceof Error ? err.message : String(err)}`,
              silent,
            );
            warn(
              "Run 'privacy-pools sync' to update your local account state.",
              silent,
            );
        }
      } finally {
        releaseCriticalSection();
      }
      spin.succeed("Ragequit confirmed!");

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
        explorerUrl: explorerTxUrl(chainConfig.id, tx.hash),
        destinationAddress: depositorAddress,
      });
    } finally {
      releaseLock();
    }
  } catch (error) {
    printError(error, isJson || isUnsigned);
  }
}
