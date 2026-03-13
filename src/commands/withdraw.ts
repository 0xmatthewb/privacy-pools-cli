import { Command, Option } from "commander";
import { confirm, input, select } from "@inquirer/prompts";
import {
  generateMerkleProof,
  calculateContext,
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import type { Hex, Address } from "viem";
import { encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveChain, parseAmount, validateAddress, validatePositive } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getPublicClient, getDataService } from "../services/sdk.js";
import { proveWithdrawal } from "../services/proofs.js";
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
import { getRelayerDetails, requestQuote, submitRelayRequest } from "../services/relayer.js";
import {
  spinner,
  stageHeader,
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
} from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { selectBestWithdrawalCommitment } from "../utils/withdrawal.js";
import { resolveAmountAndAssetInput, isPercentageAmount } from "../utils/positional.js";
import {
  writeWithdrawalPrivacyTip,
} from "../utils/amount-privacy.js";
import { printRawTransactions, stringifyBigInts, toSolidityProof } from "../utils/unsigned.js";
import {
  buildUnsignedDirectWithdrawOutput,
  buildUnsignedRelayedWithdrawOutput,
} from "../utils/unsigned-flows.js";
import { explorerTxUrl, NATIVE_ASSET_ADDRESS } from "../config/chains.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import type { GlobalOptions, PoolStats } from "../types.js";
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderWithdrawDryRun, renderWithdrawSuccess, renderWithdrawQuote } from "../output/withdraw.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
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
import {
  type AspApprovalStatus,
} from "../utils/statuses.js";

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

type WithdrawReviewStatus = Exclude<AspApprovalStatus, "approved">;

function getEligibleUnapprovedStatuses(
  poolAccounts: readonly PoolAccountRef[],
  withdrawalAmount: bigint,
): WithdrawReviewStatus[] {
  const statuses = new Set<WithdrawReviewStatus>();

  for (const poolAccount of poolAccounts) {
    if (poolAccount.value < withdrawalAmount) continue;
    if (poolAccount.status === "approved") continue;
    if (
      poolAccount.status === "pending" ||
      poolAccount.status === "poi_required" ||
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
  const ragequitCmd =
    `privacy-pools ragequit --chain ${chainName} --asset ${assetSymbol} --from-pa ${ragequitSelector}`;

  switch (status) {
    case "pending":
      return `ASP approval is required for both relayed and direct withdrawals. Run 'privacy-pools accounts --json --chain ${chainName}' to check aspStatus. Most deposits are approved within 1 hour, though some may take up to 7 days.`;
    case "poi_required":
      return `This Pool Account needs Proof of Association before it can use withdraw. Complete the POA flow at https://tornado.0xbow.io, then re-run 'privacy-pools accounts --json --chain ${chainName}' to confirm aspStatus. If you prefer a public recovery path instead, use '${ragequitCmd}'.`;
    case "declined":
      return `This Pool Account was declined by the ASP. Private withdraw, including --direct, is unavailable. Use '${ragequitCmd}' to exit publicly to the original deposit address.`;
    default:
      return `Run 'privacy-pools accounts --json --chain ${chainName}' to inspect aspStatus. Pending deposits need more time, POA-needed deposits need Proof of Association at https://tornado.0xbow.io, and declined deposits must use '${ragequitCmd}' to exit publicly to the original deposit address.`;
  }
}

export function getRelayedWithdrawalRemainderAdvisory(params: {
  remainingBalance: bigint;
  minWithdrawAmount: bigint;
  poolAccountId: string;
  assetSymbol: string;
  decimals: number;
}): string | null {
  const { remainingBalance, minWithdrawAmount, poolAccountId, assetSymbol, decimals } = params;
  if (remainingBalance <= 0n || remainingBalance >= minWithdrawAmount) {
    return null;
  }

  return (
    `${poolAccountId} would keep ${formatAmount(remainingBalance, decimals, assetSymbol)}, ` +
    `which is below the relayer minimum (${formatAmount(minWithdrawAmount, decimals, assetSymbol)}). ` +
    "Withdraw less to keep a privately withdrawable remainder, use --all/100% to fully withdraw it, " +
    "or ragequit the remainder publicly later."
  );
}

export function createWithdrawCommand(): Command {
  const metadata = getCommandMetadata("withdraw");
  const quoteMetadata = getCommandMetadata("withdraw quote");
  const command = new Command("withdraw")
    .description(metadata.description)
    .argument("[amount]", "Amount to withdraw (e.g. 0.05, 50%)")
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .option("-t, --to <address>", "Recipient address (required for relayed)")
    .option("-p, --from-pa <PA-#|#>", "Withdraw from a specific Pool Account (e.g. PA-2)")
    .addOption(new Option("--direct", "Use direct withdrawal (not privacy-preserving)").hideHelp())
    .option("--unsigned [format]", "Build unsigned payload; format: envelope (default) or tx")
    .addOption(new Option("--unsigned-format <format>", "Deprecated: use --unsigned [format]").hideHelp())
    .option("--dry-run", "Generate and verify withdrawal artifacts without submitting")
    .option("-a, --asset <symbol|address>", "Asset to withdraw")
    .option("--all", "Withdraw entire Pool Account balance")
    .option("--extra-gas", "Request gas tokens with withdrawal (default: true for ERC20)")
    .option("--no-extra-gas", "Disable extra gas request")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (firstArg, secondArg, opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const unsignedRaw = opts.unsigned;
      const isUnsigned = unsignedRaw === true || typeof unsignedRaw === "string";
      const unsignedFormat = typeof unsignedRaw === "string" ? unsignedRaw.toLowerCase() : undefined;
      const wantsTxFormat = unsignedFormat === "tx";
      const isDryRun = opts.dryRun ?? false;
      const silent = isQuiet || isJson || isUnsigned || isDryRun;
      const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
      const isVerbose = globalOpts?.verbose ?? false;
      const isDirect = opts.direct ?? false;
      const fromPaRaw = opts.fromPa as string | undefined;
      const fromPaNumber =
        fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);

      try {
        if (fromPaRaw !== undefined && fromPaNumber === null) {
          throw new CLIError(
            `Invalid --from-pa value: ${fromPaRaw}.`,
            "INPUT",
            "Use a Pool Account identifier like PA-2 (or just 2)."
          );
        }

        if (opts.unsignedFormat !== undefined) {
          throw new CLIError(
            "--unsigned-format has been replaced by --unsigned [format].",
            "INPUT",
            `Use: privacy-pools withdraw ... --unsigned ${opts.unsignedFormat ?? "envelope"}`
          );
        }

        if (unsignedFormat && unsignedFormat !== "envelope" && unsignedFormat !== "tx") {
          throw new CLIError(
            `Unsupported unsigned format: "${unsignedFormat}".`,
            "INPUT",
            "Use --unsigned envelope or --unsigned tx."
          );
        }

        const config = loadConfig();
        const chainConfig = resolveChain(
          globalOpts?.chain,
          config.defaultChain
        );
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);
        verbose(`Mode: ${isDirect ? "direct" : "relayed"}`, isVerbose, silent);
        if (isDirect) {
          warn("Using direct withdrawal. This is NOT privacy-preserving. Use relayed mode (default) for private withdrawals.", silent);
        } else {
          info("Using relayed withdrawal (recommended: stronger privacy via relayer routing).", silent);
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
              "Use 'withdraw <asset> --all --to <address>' to withdraw the entire Pool Account balance."
            );
          }
          positionalOrFlagAsset = opts.asset ?? firstArg;
          if (!positionalOrFlagAsset) {
            throw new CLIError(
              "--all requires an asset. Use 'withdraw --all ETH --to <address>' or '--all --asset <symbol>'.",
              "INPUT",
              "Run 'privacy-pools pools' to see available assets."
            );
          }
          amountStr = "";
        } else {
          if (!firstArg) {
            throw new CLIError(
              "Missing amount. Specify an amount or use --all.",
              "INPUT",
              "Example: privacy-pools withdraw 0.05 ETH --to 0x... or privacy-pools withdraw --all --asset ETH --to 0x..."
            );
          }
          const resolved = resolveAmountAndAssetInput("withdraw", firstArg, secondArg, opts.asset);
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
              "Use a value between 1% and 100% (e.g., 50%, 100%)."
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

        // Validate --to / --direct constraints
        let recipientAddress: Address;
        if (!isDirect && !opts.to) {
          if (!skipPrompts) {
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
          } else {
            throw new CLIError(
              "Relayed withdrawals require --to <address>.",
              "INPUT",
              "Specify a recipient with --to, or use --direct for direct withdrawal."
            );
          }
        } else if (isDirect && !opts.to && !signerAddress) {
          throw new CLIError(
            "Direct withdrawal requires --to <address> in unsigned mode (no signer key available).",
            "INPUT",
            "Specify a recipient address with --to 0x..."
          );
        } else {
          recipientAddress = opts.to
            ? validateAddress(opts.to, "Recipient")
            : signerAddress!;
        }

        if (isDirect && opts.to && signerAddress) {
          if (recipientAddress.toLowerCase() !== signerAddress.toLowerCase()) {
            throw new CLIError(
              "Direct withdrawal --to must match your signer address.",
              "INPUT",
              `Your signer address is ${signerAddress}. Use relayed mode (default) to withdraw to a different address.`
            );
          }
        }

        // Resolve pool
        let pool: PoolStats;
        if (positionalOrFlagAsset) {
          pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
        } else if (!skipPrompts) {
          const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
          if (pools.length === 0) {
            throw new CLIError(
              `No pools found on ${chainConfig.name}.`,
              "INPUT",
              "Run 'privacy-pools pools --chain <chain>' to see available pools."
            );
          }
          const selected = await select({
            message: "Select asset to withdraw:",
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
            "Run 'privacy-pools pools' to see available assets, then use --asset ETH (or the asset symbol)."
          );
        }
        verbose(
          `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
          isVerbose,
          silent
        );

        // Resolve --extra-gas: default true for ERC20, always false for native asset (ETH)
        const isNativeAsset = pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase();
        const effectiveExtraGas = isNativeAsset ? false : (opts.extraGas ?? true);
        if (isNativeAsset && opts.extraGas === true) {
          info("Extra gas is not applicable for ETH withdrawals (ETH is the gas token).", silent);
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
          verbose(`Requested withdrawal amount: ${withdrawalAmount.toString()}`, isVerbose, silent);
          withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
        } else {
          // Use a minimal positive threshold to select any PA with remaining balance.
          // The real withdrawal amount is resolved after PA selection.
          withdrawalAmount = 1n;
          withdrawalUsd = "";
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
          globalOpts?.rpcUrl
        );

        const withdrawSteps = isDirect ? 4 : 5;
        stageHeader(1, withdrawSteps, "Syncing account state", silent);
        const spin = spinner("Syncing account state...", silent);
        spin.start();

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
          true
        );

        // Find Pool Accounts in this scope with remaining balance.
        const spendable = withSuppressedSdkStdoutSync(() =>
          accountService.getSpendableCommitments()
        );
        const poolCommitments =
          spendable.get(pool.scope) ?? [];

        const rawPoolAccounts = buildPoolAccountRefs(
          accountService.account,
          pool.scope,
          poolCommitments
        );
        const allKnownPoolAccounts = buildAllPoolAccountRefs(
          accountService.account,
          pool.scope,
          poolCommitments,
        );
        verbose(`Available Pool Accounts in this pool: ${rawPoolAccounts.length}`, isVerbose, silent);

        if (fromPaNumber !== undefined && fromPaNumber !== null) {
          const requestedKnownPoolAccount = allKnownPoolAccounts.find(
            (pa) => pa.paNumber === fromPaNumber,
          );
          const requestedActivePoolAccount = rawPoolAccounts.find(
            (pa) => pa.paNumber === fromPaNumber,
          );
          const unavailableReason =
            requestedKnownPoolAccount && !requestedActivePoolAccount
              ? describeUnavailablePoolAccount(requestedKnownPoolAccount, "withdraw")
              : null;
          if (requestedKnownPoolAccount && unavailableReason) {
            spin.stop();
            throw new CLIError(
              unavailableReason,
              "INPUT",
              `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect ${requestedKnownPoolAccount.paId} and choose a Pool Account with remaining balance.`
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

        const baseSelection = selectBestWithdrawalCommitment(
          rawPoolAccounts,
          withdrawalAmount
        );

        if (baseSelection.kind === "insufficient" && (fromPaNumber === undefined || fromPaNumber === null)) {
          spin.stop();
          throw new CLIError(
            `No Pool Account has enough balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`,
            "INPUT",
            poolCommitments.length > 0
              ? `Largest available: ${formatAmount(baseSelection.largestAvailable, pool.decimals, pool.symbol)}`
              : `No available Pool Accounts found for ${pool.symbol}. Deposit first, then run 'privacy-pools accounts --chain ${chainConfig.name}'.`
          );
        }

        // Fetch ASP data
        stageHeader(2, withdrawSteps, "Fetching ASP data and building proofs", silent);
        spin.text = "Fetching ASP data...";
        const activeLabels = collectActiveLabels(poolCommitments);
        const [roots, leaves, rawReviewStatuses] = await Promise.all([
          fetchMerkleRoots(chainConfig, pool.scope),
          fetchMerkleLeaves(chainConfig, pool.scope),
          fetchDepositReviewStatuses(
            chainConfig,
            pool.scope,
            activeLabels,
          ),
        ]);
        verbose(
          `ASP roots: mtRoot=${roots.mtRoot} onchainMtRoot=${roots.onchainMtRoot}`,
          isVerbose,
          silent
        );
        verbose(
          `ASP leaves: labels=${leaves.aspLeaves.length} stateLeaves=${leaves.stateTreeLeaves.length}`,
          isVerbose,
          silent
        );

        const aspRoot = BigInt(roots.onchainMtRoot) as unknown as SDKHash;
        const aspLabels = leaves.aspLeaves.map((s) => BigInt(s));
        const approvedLabelStrings = new Set(aspLabels.map((label) => label.toString()));
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
            "Wait a few seconds and retry."
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
            "Wait briefly and retry so the service can catch up."
          );
        }

        // Choose smallest eligible commitment that is currently ASP-approved.
        const approvedLabelSet = new Set(aspLabels);
        const approvedSelection = selectBestWithdrawalCommitment(
          poolAccounts,
          withdrawalAmount,
          approvedLabelSet
        );

        if (approvedSelection.kind === "unapproved") {
          const statuses = getEligibleUnapprovedStatuses(poolAccounts, withdrawalAmount);
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
            true
          );
        }

        if (approvedSelection.kind === "insufficient") {
          throw new CLIError(
            `No Pool Account has enough balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`,
            "INPUT",
            `No approved Pool Accounts found for ${pool.symbol}. Check 'privacy-pools accounts' for pending approvals or deposit first.`
          );
        }

        const approvedEligiblePoolAccounts = poolAccounts
          .filter((pa) => pa.value >= withdrawalAmount && approvedLabelSet.has(pa.label))
          .sort((a, b) => {
            if (a.value < b.value) return -1;
            if (a.value > b.value) return 1;
            if (a.label < b.label) return -1;
            if (a.label > b.label) return 1;
            return 0;
          });

        let selectedPoolAccount = approvedSelection.commitment;

        if (fromPaNumber !== undefined && fromPaNumber !== null) {
          const requested = poolAccounts.find((pa) => pa.paNumber === fromPaNumber);
          if (!requested) {
            const historical = allPoolAccounts.find((pa) => pa.paNumber === fromPaNumber);
            const unavailableReason = historical
              ? describeUnavailablePoolAccount(historical, "withdraw")
              : null;
            if (historical && unavailableReason) {
              throw new CLIError(
                unavailableReason,
                "INPUT",
                `Run 'privacy-pools accounts --chain ${chainConfig.name}' to inspect ${historical.paId} and choose a Pool Account with remaining balance.`
              );
            }
            const unknownPoolAccount = getUnknownPoolAccountError({
              paNumber: fromPaNumber,
              symbol: pool.symbol,
              chainName: chainConfig.name,
              knownPoolAccountsCount: allPoolAccounts.length,
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
              `${requested.paId} balance: ${formatAmount(requested.value, pool.decimals, pool.symbol)}`
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
                  requested.status === "poi_required" ||
                  requested.status === "declined" ||
                  requested.status === "unknown"
                    ? requested.status
                    : undefined,
              }),
              "ACCOUNT_NOT_APPROVED",
              true
            );
          }

          selectedPoolAccount = requested;
        } else if (!skipPrompts && approvedEligiblePoolAccounts.length > 1) {
          spin.stop();
          const selectedPA = await select({
            message: "Select Pool Account to withdraw from:",
            choices: approvedEligiblePoolAccounts.map((pa) => ({
              name: `${pa.paId} • ${formatAmount(pa.value, pool.decimals, pool.symbol)}`,
              value: pa.paNumber,
            })),
          });
          selectedPoolAccount = approvedEligiblePoolAccounts.find((pa) => pa.paNumber === selectedPA)!;
          spin.start();
        } else if (approvedEligiblePoolAccounts.length > 0) {
          // For --all/percentage, pick largest PA; for fixed amounts, pick smallest eligible.
          selectedPoolAccount = isDeferredAmount
            ? approvedEligiblePoolAccounts[approvedEligiblePoolAccounts.length - 1]
            : approvedEligiblePoolAccounts[0];
          verbose(`Auto-selected ${selectedPoolAccount.paId} (balance: ${selectedPoolAccount.value.toString()})`, isVerbose, silent);
        }

        // Show selected PA balance
        info(
          `Selected ${selectedPoolAccount.paId}: ${formatAmount(selectedPoolAccount.value, pool.decimals, pool.symbol)} available`,
          silent
        );

        // Resolve deferred amount (--all or percentage)
        if (isDeferredAmount) {
          if (isAllWithdrawal || deferredPercent === 100) {
            withdrawalAmount = selectedPoolAccount.value;
          } else {
            // Compute percentage with 2 decimal places precision via bigint math
            withdrawalAmount = (selectedPoolAccount.value * BigInt(Math.round(deferredPercent! * 100))) / 10000n;
          }
          validatePositive(withdrawalAmount, "Withdrawal amount");
          withdrawalUsd = usdSuffix(withdrawalAmount, pool.decimals, tokenPrice);
          if (isAllWithdrawal) {
            info(
              `Withdrawing 100% of ${selectedPoolAccount.paId}: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent
            );
          } else {
            info(
              `Withdrawing ${deferredPercent}% of ${selectedPoolAccount.paId}: ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`,
              silent
            );
          }
        }

        const commitment = selectedPoolAccount.commitment;
        const commitmentLabel = commitment.label;
        verbose(
          `Selected ${selectedPoolAccount.paId}: label=${commitmentLabel.toString()} value=${commitment.value.toString()}`,
          isVerbose,
          silent
        );

        writeWithdrawalPrivacyTip(
          {
            amount: withdrawalAmount,
            balance: selectedPoolAccount.value,
            decimals: pool.decimals,
            symbol: pool.symbol,
          },
          { silent }
        );

        // Anonymity set info (non-fatal)
        let anonymitySet: { eligible: number; total: number; percentage: number } | undefined;
        try {
          const anonSet = await fetchDepositsLargerThan(chainConfig, pool.scope, withdrawalAmount);
          anonymitySet = { eligible: anonSet.eligibleDeposits, total: anonSet.totalDeposits, percentage: Number(anonSet.percentage.toFixed(1)) };
          if (!silent) {
            info(`Anonymity set: ${anonSet.eligibleDeposits} of ${anonSet.totalDeposits} deposits (${anonSet.percentage.toFixed(1)}%)`, silent);
          }
        } catch { /* non-fatal */ }

        // Build Merkle proofs
        spin.text = "Building proofs...";
        const stateMerkleProof = generateMerkleProof(
          allCommitmentHashes,
          BigInt(commitment.hash.toString())
        );
        const aspMerkleProof = generateMerkleProof(
          aspLabels,
          BigInt(commitmentLabel.toString())
        );

        // Generate withdrawal secrets
        const { nullifier: newNullifier, secret: newSecret } =
          withSuppressedSdkStdoutSync(() =>
            accountService.createWithdrawalSecrets(commitment)
          );

        const stateRoot = (await publicClient.readContract({
          address: pool.pool,
          abi: poolCurrentRootAbi,
          functionName: "currentRoot",
        })) as unknown as SDKHash;

        const stateProofRoot = BigInt((stateMerkleProof as { root: bigint | string }).root);
        if (stateProofRoot !== BigInt(stateRoot as unknown as bigint)) {
          throw new CLIError(
            "Pool data is out of date.",
            "ASP",
            "Run 'privacy-pools sync' and try the withdrawal again."
          );
        }

        const assertLatestRootUnchanged = async (
          message: string,
          hint: string
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

          const directAddress = recipientAddress;
          const withdrawal = {
            processooor: directAddress,
            data: "0x" as Hex,
          };

          const context = BigInt(
            calculateContext(withdrawal, pool.scope as unknown as SDKHash)
          );
          verbose(`Proof context: ${context.toString()}`, isVerbose, silent);

          // Re-verify parity right before proving
          stageHeader(3, withdrawSteps, "Generating ZK proof", silent);
          await assertLatestRootUnchanged(
            "Pool state changed while preparing your proof.",
            "Re-run the withdrawal command to generate a fresh proof."
          );

          const proof = await withProofProgress(
            spin,
            "Generating ZK proof",
            () => proveWithdrawal(commitment, {
              context,
              withdrawalAmount,
              stateMerkleProof,
              aspMerkleProof,
              stateRoot,
              stateTreeDepth: 32n,
              aspRoot,
              aspTreeDepth: 32n,
              newNullifier,
              newSecret,
            })
          );
          verbose(`Proof generated: publicSignals=${proof.publicSignals.length}`, isVerbose, silent);
          const solidityProof = toSolidityProof(proof as any);
          await assertLatestRootUnchanged(
            "Pool state changed after proof generation. Re-run withdrawal to generate a fresh proof.",
            "Run 'privacy-pools sync' then retry the withdrawal."
          );

          if (isUnsigned) {
            const payload = buildUnsignedDirectWithdrawOutput({
              chainId: chainConfig.id,
              chainName: chainConfig.name,
              assetSymbol: pool.symbol,
              amount: withdrawalAmount,
              from: signerAddress,
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
                false
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

          if (!skipPrompts) {
            spin.stop();
            warn(
              `Direct withdrawal sends funds to your signer address (${formatAddress(directAddress)}). This is NOT privacy-preserving. Your deposit address will be linked to your withdrawal onchain.`,
              silent
            );
            process.stderr.write("\n");
            const ok = await confirm({
              message: `Withdraw ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}${withdrawalUsd} from ${selectedPoolAccount.paId} directly to ${formatAddress(directAddress)} on ${chainConfig.name}? (no privacy)`,
              default: false,
            });
            if (!ok) {
              info("Withdrawal cancelled.", silent);
              return;
            }
            spin.start();
          }

          await assertLatestRootUnchanged(
            "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
            "Run 'privacy-pools sync' then retry the withdrawal."
          );

          stageHeader(4, withdrawSteps, "Submitting withdrawal", silent);
          spin.text = "Submitting withdrawal transaction...";
          const tx = await withdrawDirect(
            chainConfig,
            pool.pool,
            withdrawal,
            solidityProof,
            globalOpts?.rpcUrl
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
              `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to pick up the transaction.`
            );
          }
          if (receipt.status !== "success") {
            throw new CLIError(
              `Withdrawal transaction reverted: ${tx.hash}`,
              "CONTRACT",
              "Check the transaction on a block explorer for details."
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
                  tx.hash as Hex
                )
              );
              saveAccount(chainConfig.id, accountService.account);
              saveSyncMeta(chainConfig.id);
            } catch (saveErr) {
              if (!silent) {
                process.stderr.write(
                  `\nWarning: withdrawal confirmed onchain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`
                );
                process.stderr.write(
                  "⚠ Run 'privacy-pools sync' to update your local account state.\n"
                );
              }
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
            recipient: recipientAddress,
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
          // Get relayer details + quote
          stageHeader(3, withdrawSteps, "Requesting relayer quote", silent);
          spin.text = "Requesting relayer quote...";
          const details = await getRelayerDetails(chainConfig, pool.asset);
          verbose(
            `Relayer details: minWithdraw=${details.minWithdrawAmount} feeReceiver=${details.feeReceiverAddress}`,
            isVerbose,
            silent
          );

          if (withdrawalAmount < BigInt(details.minWithdrawAmount)) {
            throw new CLIError(
              `Amount below relayer minimum of ${formatAmount(BigInt(details.minWithdrawAmount), pool.decimals, pool.symbol)}.`,
              "RELAYER",
              `Increase your withdrawal amount to at least ${formatAmount(BigInt(details.minWithdrawAmount), pool.decimals, pool.symbol)}.`
            );
          }

          const remainingBelowMinAdvisory = getRelayedWithdrawalRemainderAdvisory({
            remainingBalance: selectedPoolAccount.value - withdrawalAmount,
            minWithdrawAmount: BigInt(details.minWithdrawAmount),
            poolAccountId: selectedPoolAccount.paId,
            assetSymbol: pool.symbol,
            decimals: pool.decimals,
          });

          if (skipPrompts && !silent && remainingBelowMinAdvisory) {
            warn(remainingBelowMinAdvisory, silent);
            process.stderr.write("\n");
          }

          let quote = await requestQuote(chainConfig, {
            amount: withdrawalAmount,
            asset: pool.asset,
            extraGas: effectiveExtraGas,
            recipient: recipientAddress,
          });
          verbose(
            `Relayer quote: feeBPS=${quote.feeBPS} baseFeeBPS=${quote.baseFeeBPS}`,
            isVerbose,
            silent
          );

          if (!quote.feeCommitment) {
            throw new CLIError(
              "Relayer quote is missing required fee details.",
              "RELAYER",
              "The relayer may not support this asset/chain combination."
            );
          }

          let quoteFeeBPS: bigint;
          let expirationMs: number;
          const maxQuoteRefreshAttempts = 3;
          let quoteRefreshAttempts = 0;

          const readAndValidateQuote = (): { quoteFeeBPS: bigint; expirationMs: number } => {
            if (!quote.feeCommitment) {
              throw new CLIError(
                "Relayer quote is missing required fee details.",
                "RELAYER",
                "The relayer may not support this asset/chain combination."
              );
            }

            let parsedFeeBPS: bigint;
            try {
              parsedFeeBPS = BigInt(quote.feeBPS);
            } catch {
              throw new CLIError(
                "Relayer returned malformed feeBPS (expected integer string).",
                "RELAYER",
                "Request a fresh quote and retry."
              );
            }

            if (parsedFeeBPS > pool.maxRelayFeeBPS) {
              throw new CLIError(
                `Quoted relay fee (${formatBPS(quote.feeBPS)}) exceeds onchain maximum (${formatBPS(pool.maxRelayFeeBPS)}).`,
                "RELAYER",
                "Try again later when fees are lower, or use --direct for a direct withdrawal."
              );
            }

            // Relayer may return expiration in seconds (Unix) or ms - normalize.
            const parsedExpirationMs = quote.feeCommitment.expiration < 1e12
              ? quote.feeCommitment.expiration * 1000
              : quote.feeCommitment.expiration;

            return { quoteFeeBPS: parsedFeeBPS, expirationMs: parsedExpirationMs };
          };

          const fetchFreshQuote = async (reason: string): Promise<void> => {
            quoteRefreshAttempts += 1;
            if (quoteRefreshAttempts > maxQuoteRefreshAttempts) {
              throw new CLIError(
                "Relayer returned stale/expired quotes repeatedly.",
                "RELAYER",
                "Wait a moment and retry, or switch to another relayer."
              );
            }
            spin.text = reason;
            quote = await requestQuote(chainConfig, {
              amount: withdrawalAmount,
              asset: pool.asset,
              extraGas: effectiveExtraGas,
              recipient: recipientAddress,
            });
            ({ quoteFeeBPS, expirationMs } = readAndValidateQuote());
            verbose(
              `Relayer quote refreshed: feeBPS=${quote.feeBPS} expiresAt=${new Date(expirationMs).toISOString()}`,
              isVerbose,
              silent
            );
          };

          ({ quoteFeeBPS, expirationMs } = readAndValidateQuote());
          verbose(
            `Quote expiration: ${new Date(expirationMs).toISOString()} (${expirationMs})`,
            isVerbose,
            silent
          );

          // Keep human flow quote-aware before proving, matching frontend review semantics.
          if (!skipPrompts) {
            const dd = displayDecimals(pool.decimals);
            const usd = (amount: bigint): string => {
              const val = formatUsdValue(amount, pool.decimals, tokenPrice);
              return val === "-" ? "" : ` (${val})`;
            };
            while (true) {
              const secondsLeft = Math.max(0, Math.floor((expirationMs - Date.now()) / 1000));
              if (secondsLeft <= 0) {
                await fetchFreshQuote("Quote expired. Refreshing relayer quote...");
                continue;
              }

              spin.stop();

              // Compute fee, net, and remaining for the review block
              const feeAmount = (withdrawalAmount * quoteFeeBPS) / 10000n;
              const netAmount = withdrawalAmount - feeAmount;
              const remainingBalance = selectedPoolAccount.value - withdrawalAmount;

              process.stderr.write("\n");
              process.stderr.write("  ── Withdrawal Review ──────────────────────────\n");
              process.stderr.write(`  From:            ${selectedPoolAccount.paId} (balance: ${formatAmount(selectedPoolAccount.value, pool.decimals, pool.symbol, dd)})\n`);
              process.stderr.write(`  To:              ${formatAddress(recipientAddress)}\n`);
              process.stderr.write(`  Chain:           ${chainConfig.name}\n`);
              process.stderr.write(`  Amount:          ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol, dd)}${usd(withdrawalAmount)}\n`);
              process.stderr.write(`  Relayer fee:     ${formatBPS(quoteFeeBPS)} (${formatAmount(feeAmount, pool.decimals, pool.symbol, dd)}${usd(feeAmount)})\n`);
              process.stderr.write(`  You receive:     ~${formatAmount(netAmount, pool.decimals, pool.symbol, dd)}${usd(netAmount)}\n`);
              process.stderr.write(`  Remaining:       ${remainingBalance === 0n ? `${selectedPoolAccount.paId} fully withdrawn` : `${formatAmount(remainingBalance, pool.decimals, pool.symbol, dd)}${usd(remainingBalance)}`}\n`);
              if (effectiveExtraGas) {
                process.stderr.write("  Gas token drop:  enabled (receive ETH for gas)\n");
              }
              process.stderr.write(`  Quote expires:   in ${secondsLeft}s\n`);
              process.stderr.write("  ────────────────────────────────────────────────\n");
              if (remainingBelowMinAdvisory) {
                warn(remainingBelowMinAdvisory, silent);
                process.stderr.write("\n");
              }

              const ok = await confirm({
                message: "Confirm withdrawal?",
                default: false,
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
              warn("Quote expired while waiting for confirmation. Fetching a fresh quote...", silent);
              await fetchFreshQuote("Refreshing relayer quote...");
            }
          } else if (Date.now() > expirationMs) {
            await fetchFreshQuote("Quote expired. Refreshing relayer quote...");
            if (Date.now() > expirationMs) {
              throw new CLIError(
                "Relayer returned an already expired quote.",
                "RELAYER",
                "Wait a moment and retry, or switch to another relayer."
              );
            }
          }

          // Build relay withdrawal object
          const relayData = encodeAbiParameters(
            [
              { name: "recipient", type: "address" },
              { name: "feeRecipient", type: "address" },
              { name: "relayFeeBPS", type: "uint256" },
            ],
            [
              recipientAddress,
              details.feeReceiverAddress,
              quoteFeeBPS,
            ]
          );

          const withdrawal = {
            processooor: chainConfig.entrypoint as Address,
            data: relayData,
          };

          const context = BigInt(
            calculateContext(withdrawal, pool.scope as unknown as SDKHash)
          );
          verbose(`Proof context: ${context.toString()}`, isVerbose, silent);

          // Re-verify parity right before proving
          stageHeader(4, withdrawSteps, "Generating ZK proof", silent);
          await assertLatestRootUnchanged(
            "Pool state changed while preparing your proof.",
            "Re-run the withdrawal command to generate a fresh proof."
          );

          const proof = await withProofProgress(
            spin,
            "Generating ZK proof",
            () => proveWithdrawal(commitment, {
              context,
              withdrawalAmount,
              stateMerkleProof,
              aspMerkleProof,
              stateRoot,
              stateTreeDepth: 32n,
              aspRoot,
              aspTreeDepth: 32n,
              newNullifier,
              newSecret,
            })
          );
          verbose(`Proof generated: publicSignals=${proof.publicSignals.length}`, isVerbose, silent);

          // Re-check parity before submit (in case of delay from user prompt)
          await assertLatestRootUnchanged(
            "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
            "Run 'privacy-pools sync' then retry the withdrawal."
          );

          // Auto-refresh quote if it expired during proof generation.
          // The proof context is bound to the fee BPS, so a refreshed quote
          // with the same fee is safe; a fee change invalidates the proof.
          if (Date.now() > expirationMs) {
            verbose("Quote expired after proof generation. Auto-refreshing...", isVerbose, silent);
            const previousFeeBPS = quote.feeBPS;
            await fetchFreshQuote("Quote expired after proof. Refreshing...");
            if (Number(quote.feeBPS) !== Number(previousFeeBPS)) {
              throw new CLIError(
                `Relayer fee changed during proof generation (${previousFeeBPS} → ${quote.feeBPS} BPS). Re-run the withdrawal.`,
                "RELAYER",
                "The proof is bound to the original fee. Re-run the withdrawal command to generate a fresh proof with the new fee."
              );
            }
            verbose(
              `Quote refreshed with same fee (${quote.feeBPS} BPS), expires ${new Date(expirationMs).toISOString()}`,
              isVerbose,
              silent
            );
          }

          if (isUnsigned) {
            const solidityProof = toSolidityProof(proof as any);
            const payload = buildUnsignedRelayedWithdrawOutput({
              chainId: chainConfig.id,
              chainName: chainConfig.name,
              assetSymbol: pool.symbol,
              amount: withdrawalAmount,
              from: signerAddress,
              entrypoint: chainConfig.entrypoint,
              scope: pool.scope,
              recipient: recipientAddress,
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
                false
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
              recipient: recipientAddress,
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

          stageHeader(5, withdrawSteps, "Submitting to relayer", silent);
          spin.text = "Submitting to relayer...";
          const result = await submitRelayRequest(chainConfig, {
            scope: pool.scope,
            withdrawal,
            proof: proof.proof,
            publicSignals: proof.publicSignals,
            feeCommitment: quote.feeCommitment,
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
              "The relayer may have replaced or delayed the transaction. Check the explorer and run 'privacy-pools sync' to update local state."
            );
          }

          if (receipt.status !== "success") {
            throw new CLIError(
              `Relay transaction reverted: ${result.txHash}`,
              "CONTRACT",
              "Check the transaction on a block explorer for details."
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
                  result.txHash as Hex
                )
              );
              saveAccount(chainConfig.id, accountService.account);
              saveSyncMeta(chainConfig.id);
            } catch (saveErr) {
              if (!silent) {
                process.stderr.write(
                  `\nWarning: relayed withdrawal confirmed onchain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`
                );
                process.stderr.write(
                  "⚠ Run 'privacy-pools sync' to update your local account state.\n"
                );
              }
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
            recipient: recipientAddress,
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

        } finally { releaseLock(); }
      } catch (error) {
        printError(error, isJson || isUnsigned);
      }
    });

  command
    .command("quote")
    .description(quoteMetadata.description)
    .argument("<amountOrAsset>", "Amount to withdraw (or asset symbol, see examples)")
    .argument("[amount]", "Amount (when asset is the first argument)")
    .option("-a, --asset <symbol|address>", "Asset to quote")
    .option("-t, --to <address>", "Recipient address (recommended for signed fee commitment)")
    .addHelpText("after", commandHelpText(quoteMetadata.help ?? {}))
    .action(async (firstArg, secondArg, opts, subCmd) => {
      const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;
      const isVerbose = globalOpts?.verbose ?? false;

      // Commander.js consumes --asset / --to at the parent `withdraw` command
      // before the `quote` subcommand sees them.  Fall back to parent opts so
      // that `withdraw quote 0.1 --asset ETH --to 0x...` works as documented.
      const withdrawOpts = subCmd.parent?.opts() as Record<string, unknown> | undefined;
      const effectiveAsset = (opts.asset ?? withdrawOpts?.asset) as string | undefined;
      const effectiveTo = (opts.to ?? withdrawOpts?.to) as string | undefined;

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

        const { amount: amountStr, asset: positionalOrFlagAsset } = resolveAmountAndAssetInput(
          "withdraw quote",
          firstArg,
          secondArg,
          effectiveAsset
        );

        let pool;
        if (positionalOrFlagAsset) {
          pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
        } else {
          throw new CLIError(
            "No asset specified. Use --asset <symbol|address>.",
            "INPUT",
            "Example: privacy-pools withdraw quote 0.1 --asset ETH"
          );
        }
        verbose(
          `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool}`,
          isVerbose,
          silent
        );

        // Resolve --extra-gas: read from parent withdraw opts (same pattern as --asset/--to).
        // Default true for ERC20, always false for native asset (ETH).
        const quoteIsNativeAsset = pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase();
        const parentExtraGas = withdrawOpts?.extraGas as boolean | undefined;
        const quoteExtraGas = quoteIsNativeAsset ? false : (parentExtraGas ?? true);
        if (quoteIsNativeAsset && parentExtraGas === true) {
          info("Extra gas is not applicable for ETH withdrawals (ETH is the gas token).", silent);
        }

        const amount = parseAmount(amountStr, pool.decimals);
        validatePositive(amount, "Quote amount");

        const recipient = effectiveTo
          ? validateAddress(effectiveTo, "Recipient")
          : undefined;

        const spin = spinner("Requesting relayer quote...", silent);
        spin.start();
        const details = await getRelayerDetails(chainConfig, pool.asset);
        const quote = await requestQuote(chainConfig, {
          amount,
          asset: pool.asset,
          extraGas: quoteExtraGas,
          ...(recipient ? { recipient } : {}),
        });
        spin.succeed("Quote received.");

        const expirationMs = quote.feeCommitment
          ? (quote.feeCommitment.expiration < 1e12
              ? quote.feeCommitment.expiration * 1000
              : quote.feeCommitment.expiration)
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
          feeCommitmentPresent: !!quote.feeCommitment,
          quoteExpiresAt: expirationMs ? new Date(expirationMs).toISOString() : null,
          tokenPrice: quoteTokenPrice,
          extraGas: quoteExtraGas,
          chainOverridden: !!globalOpts?.chain,
        });
      } catch (error) {
        printError(error, isJson);
      }
    });

  return command;
}
