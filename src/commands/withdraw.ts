import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
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
import { getSDK, getContracts, getPublicClient, getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount } from "../services/account.js";
import { resolvePool, listPools } from "../services/pools.js";
import { fetchMerkleRoots, fetchMerkleLeaves, fetchDepositsLargerThan } from "../services/asp.js";
import { getRelayerDetails, requestQuote, submitRelayRequest } from "../services/relayer.js";
import {
  spinner,
  info,
  warn,
  verbose,
  formatAmount,
  formatAddress,
  formatBPS,
} from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { selectBestWithdrawalCommitment } from "../utils/withdrawal.js";
import { resolveAmountAndAssetInput } from "../utils/positional.js";
import { printRawTransactions, stringifyBigInts, toSolidityProof } from "../utils/unsigned.js";
import {
  buildUnsignedDirectWithdrawOutput,
  buildUnsignedRelayedWithdrawOutput,
} from "../utils/unsigned-flows.js";
import { explorerTxUrl } from "../config/chains.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderWithdrawDryRun, renderWithdrawSuccess, renderWithdrawQuote } from "../output/withdraw.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import {
  buildPoolAccountRefs,
  parsePoolAccountSelector,
  poolAccountId,
} from "../utils/pool-accounts.js";

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

export function createWithdrawCommand(): Command {
  const command = new Command("withdraw")
    .description("Withdraw from a Privacy Pool (relayed by default)")
    .argument("<amountOrAsset>", "Amount to withdraw (or asset symbol, see examples)")
    .argument("[amount]", "Amount (when asset is the first argument)")
    .option("-t, --to <address>", "Recipient address (required for relayed)")
    .option("-p, --from-pa <PA-#|#>", "Withdraw from a specific Pool Account (e.g. PA-2)")
    .option("--direct", "Use direct withdrawal instead of relayed")
    .option("--unsigned", "Build unsigned payload(s); do not submit")
    .option("--unsigned-format <format>", "Unsigned output format (with --unsigned): envelope|tx")
    .option("--dry-run", "Generate and verify withdrawal artifacts without submitting")
    .option("-a, --asset <symbol|address>", "Asset to withdraw")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient...\n  privacy-pools withdraw ETH 0.05 --to 0xRecipient... -p PA-2\n  privacy-pools withdraw 0.05 --asset ETH --direct\n  privacy-pools withdraw 0.1 --asset ETH --to 0xRecipient... --dry-run\n  privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient...\n  privacy-pools withdraw ETH 0.05 --to 0xRecipient... --chain sepolia\n"
        + commandHelpText({
          prerequisites: "init (account state should be synced)",
          jsonFields: "{ mode, txHash, amount, recipient, asset, chain, poolAccountId, blockNumber, explorerUrl, ... }",
          jsonVariants: [
            "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
            "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
            "--dry-run: { mode, dryRun, amount, proofPublicSignals, ... }",
            "quote: { mode, chain, asset, amount, quoteFeeBPS, ... }",
          ],
          supportsUnsigned: true,
          supportsDryRun: true,
        })
    )
    .action(async (firstArg, secondArg, opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const isUnsigned = opts.unsigned ?? false;
      const unsignedFormat = (opts.unsignedFormat as string | undefined)?.toLowerCase();
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

        if (unsignedFormat && unsignedFormat !== "envelope" && unsignedFormat !== "tx") {
          throw new CLIError(
            `Unsupported unsigned format: ${opts.unsignedFormat}.`,
            "INPUT",
            "Use --unsigned-format envelope or --unsigned-format tx."
          );
        }

        if (unsignedFormat && !isUnsigned) {
          throw new CLIError(
            "--unsigned-format requires --unsigned.",
            "INPUT",
            "Use: privacy-pools withdraw ... --unsigned --unsigned-format " + (unsignedFormat || "envelope")
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
          info("Using direct withdrawal (funds sent to your signer address, no relay fee).", silent);
        } else {
          info("Using relayed withdrawal (stronger privacy via relayer routing).", silent);
        }

        const { amount: amountStr, asset: positionalOrFlagAsset } = resolveAmountAndAssetInput(
          "withdraw",
          firstArg,
          secondArg,
          opts.asset
        );

        // Private key is only needed for on-chain submission, not --unsigned or --dry-run
        let signerAddress: Address | null = null;
        if (!isUnsigned && !isDryRun) {
          const privateKey = loadPrivateKey();
          signerAddress = privateKeyToAccount(privateKey).address;
        }
        // In unsigned/dry-run modes, do NOT touch the key file at all — the signer is optional
        verbose(`Signer: ${signerAddress ?? "(unsigned mode)"}`, isVerbose, silent);

        // Validate --to / --direct constraints
        if (!isDirect && !opts.to) {
          throw new CLIError(
            "Relayed withdrawals require --to <address>.",
            "INPUT",
            "Specify a recipient with --to, or use --direct for direct withdrawal."
          );
        }

        if (isDirect && !opts.to && !signerAddress) {
          throw new CLIError(
            "Direct withdrawal requires --to <address> in unsigned mode (no signer key available).",
            "INPUT",
            "Specify a recipient address with --to 0x..."
          );
        }

        const recipientAddress: Address = opts.to
          ? validateAddress(opts.to, "Recipient")
          : signerAddress!;

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
        let pool;
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

        const withdrawalAmount = parseAmount(amountStr, pool.decimals);
        validatePositive(withdrawalAmount, "Withdrawal amount");
        verbose(`Requested withdrawal amount: ${withdrawalAmount.toString()}`, isVerbose, silent);

        // Load account & sync
        const mnemonic = loadMnemonic();
        const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
        const sdk = await getSDK();

        const dataService = getDataService(
          chainConfig,
          pool.pool,
          globalOpts?.rpcUrl
        );

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
              deploymentBlock: chainConfig.startBlock,
            },
          ],
          chainConfig.id,
          true, // sync to pick up latest on-chain state
          silent,
          true
        );

        // Find spendable Pool Accounts for this scope.
        const spendable = accountService.getSpendableCommitments();
        const poolCommitments =
          spendable.get(pool.scope) ?? [];

        const poolAccounts = buildPoolAccountRefs(
          accountService.account,
          pool.scope,
          poolCommitments
        );
        verbose(`Available Pool Accounts in this pool: ${poolAccounts.length}`, isVerbose, silent);

        const baseSelection = selectBestWithdrawalCommitment(
          poolAccounts,
          withdrawalAmount
        );

        if (baseSelection.kind === "insufficient") {
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
        spin.text = "Fetching ASP data...";
        const roots = await fetchMerkleRoots(chainConfig, pool.scope);
        const leaves = await fetchMerkleLeaves(chainConfig, pool.scope);
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
        const allCommitmentHashes = leaves.stateTreeLeaves.map((s) => BigInt(s));

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
          throw new CLIError(
            "No eligible Pool Account is currently approved for private withdrawal.",
            "ASP",
            "Your balance may be sufficient, but this Pool Account is not yet eligible. Wait and retry, or use 'privacy-pools ragequit' for public recovery."
          );
        }

        if (approvedSelection.kind === "insufficient") {
          throw new CLIError(
            `No Pool Account has enough balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`,
            "INPUT",
            `No available Pool Accounts found for ${pool.symbol}.`
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
            throw new CLIError(
              `Unknown Pool Account ${poolAccountId(fromPaNumber)} for ${pool.symbol}.`,
              "INPUT",
              `Run 'privacy-pools accounts --chain ${chainConfig.name}' to list available Pool Accounts.`
            );
          }

          if (requested.value < withdrawalAmount) {
            throw new CLIError(
              `${requested.paId} has insufficient balance for this withdrawal.`,
              "INPUT",
              `${requested.paId} balance: ${formatAmount(requested.value, pool.decimals, pool.symbol)}`
            );
          }

          if (!approvedLabelSet.has(requested.label)) {
            throw new CLIError(
              `${requested.paId} is not currently eligible for private withdrawal.`,
              "ASP",
              "Wait and retry, or use 'privacy-pools ragequit' for public recovery."
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
          selectedPoolAccount = approvedEligiblePoolAccounts[0];
        }

        const commitment = selectedPoolAccount.commitment;
        const commitmentLabel = commitment.label;
        verbose(
          `Selected ${selectedPoolAccount.paId}: label=${commitmentLabel.toString()} value=${commitment.value.toString()}`,
          isVerbose,
          silent
        );

        // Anonymity set info (non-fatal)
        try {
          const anonSet = await fetchDepositsLargerThan(chainConfig, pool.scope, withdrawalAmount);
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
          accountService.createWithdrawalSecrets(commitment);

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
          const latestRootCheck = await publicClient.readContract({
            address: chainConfig.entrypoint,
            abi: entrypointLatestRootAbi,
            functionName: "latestRoot",
          });
          if (BigInt(roots.onchainMtRoot) !== BigInt(latestRootCheck as bigint)) {
            throw new CLIError(
              "Pool state changed while preparing your proof.",
              "ASP",
              "Re-run the withdrawal command to generate a fresh proof."
            );
          }

          const proof = await withProofProgress(
            spin,
            "Generating ZK proof",
            () => sdk.proveWithdrawal(commitment, {
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

          if (isUnsigned) {
            const solidityProof = toSolidityProof(proof as any);
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
            });
            return;
          }

          if (!skipPrompts) {
            spin.stop();
            const ok = await confirm({
              message: `Withdraw ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)} from ${selectedPoolAccount.paId} directly to ${formatAddress(directAddress)} on ${chainConfig.name}?`,
              default: false,
            });
            if (!ok) {
              info("Withdrawal cancelled.", silent);
              return;
            }
            spin.start();
          }

          spin.text = "Submitting withdrawal transaction...";
          const contracts = await getContracts(chainConfig, globalOpts?.rpcUrl);
          const tx = await contracts.withdraw(
            withdrawal,
            proof,
            pool.scope as unknown as SDKHash
          );

          spin.text = "Waiting for confirmation...";
          let receipt;
          try {
            receipt = await publicClient.waitForTransactionReceipt({
              hash: tx.hash as `0x${string}`,
              timeout: 300_000,
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
              accountService.addWithdrawalCommitment(
                commitment,
                commitment.value - withdrawalAmount,
                newNullifier,
                newSecret,
                receipt.blockNumber,
                tx.hash as Hex
              );
              saveAccount(chainConfig.id, accountService.account);
            } catch (saveErr) {
              process.stderr.write(
                `\nWarning: withdrawal confirmed onchain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`
              );
              process.stderr.write(
                "⚠ Run 'privacy-pools sync' to update your local account state.\n"
              );
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
          });
        } else {
          // --- Relayed Withdrawal ---
          // Preload circuits (already done via sdk.proveWithdrawal init)
          // Get relayer details + quote
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

          let quote = await requestQuote(chainConfig, {
            amount: withdrawalAmount,
            asset: pool.asset,
            extraGas: false,
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
              extraGas: false,
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
          info(`Relayer fee: ${quote.feeBPS} BPS (${formatBPS(BigInt(quote.feeBPS))})`, silent);

          // Keep human flow quote-aware before proving, matching frontend review semantics.
          if (!skipPrompts) {
            while (true) {
              const secondsLeft = Math.max(0, Math.floor((expirationMs - Date.now()) / 1000));
              if (secondsLeft <= 0) {
                await fetchFreshQuote("Quote expired. Refreshing relayer quote...");
                continue;
              }

              spin.stop();
              process.stderr.write("\n");
              info(`Quote fee: ${quote.feeBPS} BPS`, silent);
              info(
                `Quote valid for ~${secondsLeft}s (expires ${new Date(expirationMs).toISOString()})`,
                silent
              );
              const ok = await confirm({
                message: `Withdraw ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)} from ${selectedPoolAccount.paId} via relayer to ${formatAddress(recipientAddress)} on ${chainConfig.name}?`,
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
          const latestRootCheck = await publicClient.readContract({
            address: chainConfig.entrypoint,
            abi: entrypointLatestRootAbi,
            functionName: "latestRoot",
          });
          if (BigInt(roots.onchainMtRoot) !== BigInt(latestRootCheck as bigint)) {
            throw new CLIError(
              "Pool state changed while preparing your proof.",
              "ASP",
              "Re-run the withdrawal command to generate a fresh proof."
            );
          }

          const proof = await withProofProgress(
            spin,
            "Generating ZK proof",
            () => sdk.proveWithdrawal(commitment, {
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
          const finalRootCheck = await publicClient.readContract({
            address: chainConfig.entrypoint,
            abi: entrypointLatestRootAbi,
            functionName: "latestRoot",
          });
          if (BigInt(roots.onchainMtRoot) !== BigInt(finalRootCheck as bigint)) {
            throw new CLIError(
              "Pool state changed before submission. Re-run withdrawal to generate a fresh proof.",
              "ASP",
              "Run 'privacy-pools sync' then retry the withdrawal."
            );
          }

          // Check if feeCommitment expired before submit.
          if (Date.now() > expirationMs) {
            throw new CLIError(
              "Relayer quote expired. Re-run the withdrawal.",
              "RELAYER",
              "Quotes are valid for about 60 seconds. Re-run withdrawal to fetch a fresh quote."
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
            });
            return;
          }

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
              timeout: 300_000,
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
              accountService.addWithdrawalCommitment(
                commitment,
                commitment.value - withdrawalAmount,
                newNullifier,
                newSecret,
                receipt.blockNumber,
                result.txHash as Hex
              );
              saveAccount(chainConfig.id, accountService.account);
            } catch (saveErr) {
              process.stderr.write(
                `\nWarning: relayed withdrawal confirmed onchain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`
              );
              process.stderr.write(
                "⚠ Run 'privacy-pools sync' to update your local account state.\n"
              );
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
          });
        }
      } catch (error) {
        printError(error, isJson || isUnsigned);
      }
    });

  command
    .command("quote")
    .description("Request relayer quote and limits without generating a proof")
    .argument("<amountOrAsset>", "Amount to withdraw (or asset symbol, see examples)")
    .argument("[amount]", "Amount (when asset is the first argument)")
    .option("-a, --asset <symbol|address>", "Asset to quote")
    .option("-t, --to <address>", "Recipient address (recommended for signed fee commitment)")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient...\n  privacy-pools withdraw quote 100 --asset USDC --json --chain ethereum\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ mode, chain, asset, amount, quoteFeeBPS, quoteExpiresAt, ... }",
        })
    )
    .action(async (firstArg, secondArg, opts, subCmd) => {
      const globalOpts = subCmd.parent?.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;
      const isVerbose = globalOpts?.verbose ?? false;

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

        const { amount: amountStr, asset: positionalOrFlagAsset } = resolveAmountAndAssetInput(
          "withdraw quote",
          firstArg,
          secondArg,
          opts.asset
        );

        let pool;
        if (positionalOrFlagAsset) {
          pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
        } else {
          throw new CLIError(
            "No asset specified. Use --asset <symbol|address>.",
            "INPUT",
            "Example: privacy-pools withdraw quote 0.1 --asset ETH --chain sepolia"
          );
        }
        verbose(
          `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool}`,
          isVerbose,
          silent
        );

        const amount = parseAmount(amountStr, pool.decimals);
        validatePositive(amount, "Quote amount");

        const recipient = opts.to
          ? validateAddress(opts.to, "Recipient")
          : undefined;

        const spin = spinner("Requesting relayer quote...", silent);
        spin.start();
        const details = await getRelayerDetails(chainConfig, pool.asset);
        const quote = await requestQuote(chainConfig, {
          amount,
          asset: pool.asset,
          extraGas: false,
          ...(recipient ? { recipient } : {}),
        });
        spin.succeed("Quote received.");

        const expirationMs = quote.feeCommitment
          ? (quote.feeCommitment.expiration < 1e12
              ? quote.feeCommitment.expiration * 1000
              : quote.feeCommitment.expiration)
          : null;

        const ctx = createOutputContext(mode);
        renderWithdrawQuote(ctx, {
          chain: chainConfig.name,
          asset: pool.symbol,
          amount,
          decimals: pool.decimals,
          recipient: recipient ?? null,
          minWithdrawAmount: details.minWithdrawAmount,
          maxRelayFeeBPS: pool.maxRelayFeeBPS,
          quoteFeeBPS: quote.feeBPS,
          feeCommitmentPresent: !!quote.feeCommitment,
          quoteExpiresAt: expirationMs ? new Date(expirationMs).toISOString() : null,
        });
      } catch (error) {
        printError(error, isJson);
      }
    });

  return command;
}
