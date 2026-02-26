import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import { generateMerkleProof, calculateContext, } from "@0xbow/privacy-pools-core-sdk";
import { encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { resolveChain, parseAmount, validateAddress, validatePositive } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getSDK, getContracts, getPublicClient, getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount } from "../services/account.js";
import { resolvePool, listPools } from "../services/pools.js";
import { fetchMerkleRoots, fetchMerkleLeaves } from "../services/asp.js";
import { getRelayerDetails, requestQuote, submitRelayRequest } from "../services/relayer.js";
import { spinner, success, info, verbose, formatAmount, formatAddress, formatTxHash, } from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { selectBestWithdrawalCommitment } from "../utils/withdrawal.js";
import { resolveAmountAndAssetInput } from "../utils/positional.js";
import { printRawTransactions, stringifyBigInts, toSolidityProof } from "../utils/unsigned.js";
import { buildUnsignedDirectWithdrawOutput, buildUnsignedRelayedWithdrawOutput, } from "../utils/unsigned-flows.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
const entrypointLatestRootAbi = [
    {
        name: "latestRoot",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },
];
const poolCurrentRootAbi = [
    {
        name: "currentRoot",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
    },
];
export function createWithdrawCommand() {
    const command = new Command("withdraw")
        .description("Withdraw from a Privacy Pool (relayed by default)")
        .argument("<amountOrAsset>", "Amount or asset (supports both <amount> --asset ... and <asset> <amount>)")
        .argument("[amount]", "Optional amount when using positional asset alias")
        .option("--to <address>", "Recipient address (required for relayed)")
        .option("--direct", "Use direct withdrawal instead of relayed")
        .option("--unsigned", "Output unsigned payload(s) without submitting")
        .option("--unsigned-format <format>", "Unsigned output format: envelope|tx")
        .option("--dry-run", "Generate and verify all withdrawal artifacts without submitting")
        .option("--asset <symbol|address>", "Asset to withdraw")
        .addHelpText("after", "\nExamples:\n  privacy-pools withdraw 0.05 --asset ETH --to 0xRecipient... --chain sepolia\n  privacy-pools withdraw ETH 0.05 --to 0xRecipient... --chain sepolia\n  privacy-pools withdraw 0.05 --asset ETH --direct --chain sepolia\n  privacy-pools withdraw 0.05 --asset ETH --direct --unsigned --unsigned-format tx --chain sepolia\n  privacy-pools withdraw 1 --asset USDC --json --yes --to 0xRecipient...\n  privacy-pools withdraw 0.1 --asset ETH --to 0xRecipient... --dry-run\n  privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient...\n  privacy-pools withdraw quote ETH 0.1 --to 0xRecipient...\n"
        + commandHelpText({
            prerequisites: "init (account state should be synced)",
            jsonFields: "{ mode, txHash, amount, asset, chain }",
            jsonVariants: [
                "--unsigned: { mode, operation, withdrawMode, chain, transactions[], ... }",
                "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
                "--dry-run: { mode, dryRun, amount, proofPublicSignals, ... }",
                "quote: { mode, chain, asset, amount, quoteFeeBPS, ... }",
            ],
        }))
        .action(async (firstArg, secondArg, opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const isUnsigned = opts.unsigned ?? false;
        const unsignedFormat = opts.unsignedFormat?.toLowerCase();
        const wantsTxFormat = unsignedFormat === "tx";
        const isDryRun = opts.dryRun ?? false;
        const silent = isQuiet || isJson || isUnsigned || isDryRun;
        const skipPrompts = mode.skipPrompts || isUnsigned || isDryRun;
        const isVerbose = globalOpts?.verbose ?? false;
        const isDirect = opts.direct ?? false;
        try {
            if (unsignedFormat && unsignedFormat !== "envelope" && unsignedFormat !== "tx") {
                throw new CLIError(`Unsupported unsigned format: ${opts.unsignedFormat}.`, "INPUT", "Use --unsigned-format envelope or --unsigned-format tx.");
            }
            if (unsignedFormat && !isUnsigned) {
                throw new CLIError("--unsigned-format requires --unsigned.", "INPUT", "Use: privacy-pools withdraw ... --unsigned --unsigned-format " + (unsignedFormat || "envelope"));
            }
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);
            verbose(`Mode: ${isDirect ? "direct" : "relayed"}`, isVerbose, silent);
            const { amount: amountStr, asset: positionalOrFlagAsset } = resolveAmountAndAssetInput("withdraw", firstArg, secondArg, opts.asset);
            // Private key is only needed for on-chain submission, not --unsigned or --dry-run
            let signerAddress = null;
            if (!isUnsigned && !isDryRun) {
                const privateKey = loadPrivateKey();
                signerAddress = privateKeyToAccount(privateKey).address;
            }
            // In unsigned/dry-run modes, do NOT touch the key file at all — the signer is optional
            verbose(`Signer: ${signerAddress ?? "(unsigned mode)"}`, isVerbose, silent);
            // Validate --to / --direct constraints
            if (!isDirect && !opts.to) {
                throw new CLIError("Relayed withdrawals require --to <address>.", "INPUT", "Specify a recipient with --to, or use --direct for direct withdrawal.");
            }
            if (isDirect && !opts.to && !signerAddress) {
                throw new CLIError("Direct withdrawal requires --to <address> in unsigned mode (no signer key available).", "INPUT");
            }
            const recipientAddress = opts.to
                ? validateAddress(opts.to, "Recipient")
                : signerAddress;
            if (isDirect && opts.to && signerAddress) {
                if (recipientAddress.toLowerCase() !== signerAddress.toLowerCase()) {
                    throw new CLIError("Direct withdrawal --to must match your signer address.", "INPUT", `Your signer address is ${signerAddress}. Use relayed mode (default) to withdraw to a different address.`);
                }
            }
            // Resolve pool
            let pool;
            if (positionalOrFlagAsset) {
                pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
            }
            else if (!skipPrompts) {
                const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
                if (pools.length === 0) {
                    throw new CLIError(`No pools on ${chainConfig.name}.`, "INPUT");
                }
                const selected = await select({
                    message: "Select asset to withdraw:",
                    choices: pools.map((p) => ({
                        name: `${p.symbol} (${formatAddress(p.asset)})`,
                        value: p.symbol,
                    })),
                });
                pool = pools.find((p) => p.symbol === selected);
            }
            else {
                throw new CLIError("No asset specified. Use --asset.", "INPUT");
            }
            verbose(`Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`, isVerbose, silent);
            const withdrawalAmount = parseAmount(amountStr, pool.decimals);
            validatePositive(withdrawalAmount, "Withdrawal amount");
            verbose(`Requested withdrawal amount: ${withdrawalAmount.toString()}`, isVerbose, silent);
            // Load account & sync
            const mnemonic = loadMnemonic();
            const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
            const sdk = await getSDK();
            const dataService = getDataService(chainConfig, pool.pool, globalOpts?.rpcUrl);
            const spin = spinner("Syncing account state...", silent);
            spin.start();
            const accountService = await initializeAccountService(dataService, mnemonic, [
                {
                    chainId: chainConfig.id,
                    address: pool.pool,
                    scope: pool.scope,
                    deploymentBlock: chainConfig.startBlock,
                },
            ], chainConfig.id, true, // sync to pick up latest on-chain state
            silent, true);
            // Find spendable commitment
            const spendable = accountService.getSpendableCommitments();
            const poolCommitments = spendable.get(pool.scope) ?? [];
            verbose(`Spendable commitments for scope: ${poolCommitments.length}`, isVerbose, silent);
            const baseSelection = selectBestWithdrawalCommitment(poolCommitments, withdrawalAmount);
            if (baseSelection.kind === "insufficient") {
                spin.stop();
                throw new CLIError(`No commitment with sufficient balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`, "INPUT", poolCommitments.length > 0
                    ? `Largest available: ${formatAmount(baseSelection.largestAvailable, pool.decimals, pool.symbol)}`
                    : "No spendable commitments found. Have you deposited?");
            }
            // Fetch ASP data
            spin.text = "Fetching ASP data...";
            const roots = await fetchMerkleRoots(chainConfig, pool.scope);
            const leaves = await fetchMerkleLeaves(chainConfig, pool.scope);
            verbose(`ASP roots: mtRoot=${roots.mtRoot} onchainMtRoot=${roots.onchainMtRoot}`, isVerbose, silent);
            verbose(`ASP leaves: labels=${leaves.aspLeaves.length} stateLeaves=${leaves.stateTreeLeaves.length}`, isVerbose, silent);
            const aspRoot = BigInt(roots.onchainMtRoot);
            const aspLabels = leaves.aspLeaves.map((s) => BigInt(s));
            const allCommitmentHashes = leaves.stateTreeLeaves.map((s) => BigInt(s));
            // Ensure ASP tree and on-chain root are converged before proof generation.
            if (BigInt(roots.mtRoot) !== BigInt(roots.onchainMtRoot)) {
                throw new CLIError("ASP state is still converging (mtRoot != onchainMtRoot).", "ASP", "Wait briefly, re-fetch ASP data, and retry.");
            }
            // Verify ASP root parity against on-chain latest root.
            const onchainLatestRoot = await publicClient.readContract({
                address: chainConfig.entrypoint,
                abi: entrypointLatestRootAbi,
                functionName: "latestRoot",
            });
            if (BigInt(roots.onchainMtRoot) !== BigInt(onchainLatestRoot)) {
                throw new CLIError("ASP root does not match on-chain latest root.", "ASP", "The ASP data may be stale. Wait and retry.");
            }
            // Choose smallest eligible commitment that is currently ASP-approved.
            const approvedLabelSet = new Set(aspLabels);
            const approvedSelection = selectBestWithdrawalCommitment(poolCommitments, withdrawalAmount, approvedLabelSet);
            if (approvedSelection.kind === "unapproved") {
                throw new CLIError("No ASP-approved commitment can satisfy this withdrawal amount.", "ASP", "You may have sufficient balance, but those labels are not currently approved. Wait for ASP approval or use ragequit.");
            }
            if (approvedSelection.kind === "insufficient") {
                throw new CLIError(`No commitment with sufficient balance for ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}.`, "INPUT", "No spendable commitments found. Have you deposited?");
            }
            const commitment = approvedSelection.commitment;
            const commitmentLabel = commitment.label;
            verbose(`Selected commitment: label=${commitmentLabel.toString()} value=${commitment.value.toString()}`, isVerbose, silent);
            // Build Merkle proofs
            spin.text = "Building proofs...";
            const stateMerkleProof = generateMerkleProof(allCommitmentHashes, BigInt(commitment.hash.toString()));
            const aspMerkleProof = generateMerkleProof(aspLabels, BigInt(commitmentLabel.toString()));
            // Generate withdrawal secrets
            const { nullifier: newNullifier, secret: newSecret } = accountService.createWithdrawalSecrets(commitment);
            const stateRoot = (await publicClient.readContract({
                address: pool.pool,
                abi: poolCurrentRootAbi,
                functionName: "currentRoot",
            }));
            const stateProofRoot = BigInt(stateMerkleProof.root);
            if (stateProofRoot !== BigInt(stateRoot)) {
                throw new CLIError("State tree leaves are stale (proof root does not match on-chain pool root).", "ASP", "Re-fetch ASP leaves and regenerate the proof.");
            }
            if (isDirect) {
                // --- Direct Withdrawal ---
                // Pre-flight gas check (skip for unsigned - relying on external signer)
                if (!isUnsigned && !isDryRun) {
                    await checkHasGas(publicClient, signerAddress);
                }
                const directAddress = recipientAddress;
                const withdrawal = {
                    processooor: directAddress,
                    data: "0x",
                };
                const context = BigInt(calculateContext(withdrawal, pool.scope));
                verbose(`Proof context: ${context.toString()}`, isVerbose, silent);
                // Re-verify parity right before proving
                const latestRootCheck = await publicClient.readContract({
                    address: chainConfig.entrypoint,
                    abi: entrypointLatestRootAbi,
                    functionName: "latestRoot",
                });
                if (BigInt(roots.onchainMtRoot) !== BigInt(latestRootCheck)) {
                    throw new CLIError("ASP root changed during proof preparation. Re-fetch and retry.", "ASP");
                }
                const proof = await withProofProgress(spin, "Generating ZK proof", () => sdk.proveWithdrawal(commitment, {
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
                }));
                verbose(`Proof generated: publicSignals=${proof.publicSignals.length}`, isVerbose, silent);
                if (isUnsigned) {
                    const solidityProof = toSolidityProof(proof);
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
                    }
                    else {
                        printJsonSuccess(payload, false);
                    }
                    return;
                }
                if (isDryRun) {
                    spin.succeed("Dry-run completed (no transaction submitted).");
                    if (isJson) {
                        printJsonSuccess({
                            mode: "direct",
                            dryRun: true,
                            amount: withdrawalAmount.toString(),
                            asset: pool.symbol,
                            chain: chainConfig.name,
                            recipient: directAddress,
                            selectedCommitmentLabel: commitmentLabel.toString(),
                            selectedCommitmentValue: commitment.value.toString(),
                            proofPublicSignals: proof.publicSignals.length,
                        }, false);
                    }
                    else {
                        process.stderr.write("\n");
                        success("Dry-run complete.", silent);
                        info(`Mode: direct`, silent);
                        info(`Recipient: ${formatAddress(directAddress)}`, silent);
                        info(`Selected commitment: label=${commitmentLabel.toString()} value=${formatAmount(commitment.value, pool.decimals, pool.symbol)}`, silent);
                        info("No transaction was submitted.", silent);
                    }
                    return;
                }
                if (!skipPrompts) {
                    spin.stop();
                    const ok = await confirm({
                        message: `Withdraw ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)} directly to ${formatAddress(directAddress)}?`,
                    });
                    if (!ok) {
                        info("Withdrawal cancelled.", silent);
                        return;
                    }
                    spin.start();
                }
                spin.text = "Submitting withdrawal transaction...";
                const contracts = await getContracts(chainConfig, globalOpts?.rpcUrl);
                const tx = await contracts.withdraw(withdrawal, proof, pool.scope);
                spin.text = "Waiting for confirmation...";
                let receipt;
                try {
                    receipt = await publicClient.waitForTransactionReceipt({
                        hash: tx.hash,
                        timeout: 300_000,
                    });
                }
                catch {
                    throw new CLIError("Timed out waiting for withdrawal confirmation.", "RPC", `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to recover.`);
                }
                if (receipt.status !== "success") {
                    throw new CLIError(`Withdrawal transaction reverted: ${tx.hash}`, "CONTRACT", "Check the transaction on a block explorer for details.");
                }
                guardCriticalSection();
                try {
                    // Record the withdrawal in account state
                    try {
                        accountService.addWithdrawalCommitment(commitment, commitment.value - withdrawalAmount, newNullifier, newSecret, receipt.blockNumber, tx.hash);
                        saveAccount(chainConfig.id, accountService.account);
                    }
                    catch (saveErr) {
                        process.stderr.write(`\nWarning: withdrawal confirmed on-chain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`);
                        process.stderr.write("⚠ Run 'privacy-pools sync' to recover your account state.\n");
                    }
                }
                finally {
                    releaseCriticalSection();
                }
                spin.succeed("Direct withdrawal confirmed!");
                if (isJson) {
                    printJsonSuccess({
                        operation: "withdraw",
                        mode: "direct",
                        txHash: tx.hash,
                        amount: withdrawalAmount.toString(),
                        recipient: recipientAddress,
                        asset: pool.symbol,
                        chain: chainConfig.name,
                    }, false);
                }
                else {
                    process.stderr.write("\n");
                    success(`Withdrew ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)}`, silent);
                    info(`Tx: ${formatTxHash(tx.hash)}`, silent);
                }
            }
            else {
                // --- Relayed Withdrawal ---
                // Preload circuits (already done via sdk.proveWithdrawal init)
                // Get relayer details + quote
                spin.text = "Requesting relayer quote...";
                const details = await getRelayerDetails(chainConfig, pool.asset);
                verbose(`Relayer details: minWithdraw=${details.minWithdrawAmount} feeReceiver=${details.feeReceiverAddress}`, isVerbose, silent);
                if (withdrawalAmount < BigInt(details.minWithdrawAmount)) {
                    throw new CLIError(`Amount below relayer minimum: ${details.minWithdrawAmount}`, "RELAYER");
                }
                const quote = await requestQuote(chainConfig, {
                    amount: withdrawalAmount,
                    asset: pool.asset,
                    extraGas: false,
                    recipient: recipientAddress,
                });
                verbose(`Relayer quote: feeBPS=${quote.feeBPS} baseFeeBPS=${quote.baseFeeBPS}`, isVerbose, silent);
                if (!quote.feeCommitment) {
                    throw new CLIError("Relayer did not return a fee commitment.", "RELAYER", "The relayer may not support this asset/chain combination.");
                }
                let quoteFeeBPS;
                try {
                    quoteFeeBPS = BigInt(quote.feeBPS);
                }
                catch {
                    throw new CLIError("Relayer returned malformed feeBPS (expected integer string).", "RELAYER", "Request a fresh quote and retry.");
                }
                // Validate fee
                if (quoteFeeBPS > pool.maxRelayFeeBPS) {
                    throw new CLIError(`Quoted fee ${quote.feeBPS} BPS exceeds on-chain max ${pool.maxRelayFeeBPS} BPS.`, "RELAYER");
                }
                // Build relay withdrawal object
                const relayData = encodeAbiParameters([
                    { name: "recipient", type: "address" },
                    { name: "feeRecipient", type: "address" },
                    { name: "relayFeeBPS", type: "uint256" },
                ], [
                    recipientAddress,
                    details.feeReceiverAddress,
                    quoteFeeBPS,
                ]);
                const withdrawal = {
                    processooor: chainConfig.entrypoint,
                    data: relayData,
                };
                const context = BigInt(calculateContext(withdrawal, pool.scope));
                verbose(`Proof context: ${context.toString()}`, isVerbose, silent);
                // Re-verify parity right before proving
                const latestRootCheck = await publicClient.readContract({
                    address: chainConfig.entrypoint,
                    abi: entrypointLatestRootAbi,
                    functionName: "latestRoot",
                });
                if (BigInt(roots.onchainMtRoot) !== BigInt(latestRootCheck)) {
                    throw new CLIError("ASP root changed during proof preparation. Re-fetch and retry.", "ASP");
                }
                const proof = await withProofProgress(spin, "Generating ZK proof", () => sdk.proveWithdrawal(commitment, {
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
                }));
                verbose(`Proof generated: publicSignals=${proof.publicSignals.length}`, isVerbose, silent);
                if (!skipPrompts) {
                    spin.stop();
                    const ok = await confirm({
                        message: `Withdraw ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)} via relayer to ${formatAddress(recipientAddress)}? (fee: ${quote.feeBPS} BPS)`,
                    });
                    if (!ok) {
                        info("Withdrawal cancelled.", silent);
                        return;
                    }
                    spin.start();
                }
                // Re-check parity before submit (in case of delay from user prompt)
                const finalRootCheck = await publicClient.readContract({
                    address: chainConfig.entrypoint,
                    abi: entrypointLatestRootAbi,
                    functionName: "latestRoot",
                });
                if (BigInt(roots.onchainMtRoot) !== BigInt(finalRootCheck)) {
                    throw new CLIError("ASP root changed. Re-run the withdrawal to generate a fresh proof.", "ASP");
                }
                // Check if feeCommitment expired
                // Relayer may return expiration in seconds (Unix) or ms - normalize
                const expirationMs = quote.feeCommitment.expiration < 1e12
                    ? quote.feeCommitment.expiration * 1000
                    : quote.feeCommitment.expiration;
                verbose(`Quote expiration: ${new Date(expirationMs).toISOString()} (${expirationMs})`, isVerbose, silent);
                if (Date.now() > expirationMs) {
                    throw new CLIError("Relayer fee commitment expired. Re-run the withdrawal.", "RELAYER", "The fee commitment has a ~60 second TTL.");
                }
                if (isUnsigned) {
                    const solidityProof = toSolidityProof(proof);
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
                    }
                    else {
                        printJsonSuccess(payload, false);
                    }
                    return;
                }
                if (isDryRun) {
                    spin.succeed("Dry-run completed (no transaction submitted).");
                    if (isJson) {
                        printJsonSuccess({
                            mode: "relayed",
                            dryRun: true,
                            amount: withdrawalAmount.toString(),
                            asset: pool.symbol,
                            chain: chainConfig.name,
                            recipient: recipientAddress,
                            selectedCommitmentLabel: commitmentLabel.toString(),
                            selectedCommitmentValue: commitment.value.toString(),
                            feeBPS: quote.feeBPS,
                            quoteExpiresAt: new Date(expirationMs).toISOString(),
                            proofPublicSignals: proof.publicSignals.length,
                        }, false);
                    }
                    else {
                        process.stderr.write("\n");
                        success("Dry-run complete.", silent);
                        info(`Mode: relayed`, silent);
                        info(`Recipient: ${formatAddress(recipientAddress)}`, silent);
                        info(`Relay fee: ${quote.feeBPS} BPS`, silent);
                        info(`Quote expires: ${new Date(expirationMs).toISOString()}`, silent);
                        info(`Selected commitment: label=${commitmentLabel.toString()} value=${formatAmount(commitment.value, pool.decimals, pool.symbol)}`, silent);
                        info("No transaction was submitted.", silent);
                    }
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
                        hash: result.txHash,
                        timeout: 300_000,
                    });
                }
                catch {
                    throw new CLIError("Timed out waiting for relayed withdrawal confirmation.", "RPC", "The relayer may have replaced or delayed the transaction. Check the relayer/explorer and run 'privacy-pools sync' to recover local state.");
                }
                if (receipt.status !== "success") {
                    throw new CLIError(`Relay transaction reverted: ${result.txHash}`, "CONTRACT");
                }
                guardCriticalSection();
                try {
                    // Record the withdrawal in account state
                    try {
                        accountService.addWithdrawalCommitment(commitment, commitment.value - withdrawalAmount, newNullifier, newSecret, receipt.blockNumber, result.txHash);
                        saveAccount(chainConfig.id, accountService.account);
                    }
                    catch (saveErr) {
                        process.stderr.write(`\nWarning: relayed withdrawal confirmed on-chain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`);
                        process.stderr.write("⚠ Run 'privacy-pools sync' to recover your account state.\n");
                    }
                }
                finally {
                    releaseCriticalSection();
                }
                spin.succeed("Relayed withdrawal confirmed!");
                if (isJson) {
                    printJsonSuccess({
                        operation: "withdraw",
                        mode: "relayed",
                        txHash: result.txHash,
                        amount: withdrawalAmount.toString(),
                        recipient: recipientAddress,
                        feeBPS: quote.feeBPS,
                        asset: pool.symbol,
                        chain: chainConfig.name,
                    }, false);
                }
                else {
                    process.stderr.write("\n");
                    success(`Withdrew ${formatAmount(withdrawalAmount, pool.decimals, pool.symbol)} to ${formatAddress(recipientAddress)}`, silent);
                    info(`Tx: ${formatTxHash(result.txHash)}`, silent);
                    info(`Relay fee: ${quote.feeBPS} BPS`, silent);
                }
            }
        }
        catch (error) {
            printError(error, isJson || isUnsigned || isDryRun);
        }
    });
    command
        .command("quote")
        .description("Request relayer quote and limits without generating a proof")
        .argument("<amountOrAsset>", "Amount or asset (supports both <amount> --asset ... and <asset> <amount>)")
        .argument("[amount]", "Optional amount when using positional asset alias")
        .option("--asset <symbol|address>", "Asset to quote")
        .option("--to <address>", "Recipient address (recommended for signed fee commitment)")
        .addHelpText("after", "\nExamples:\n  privacy-pools withdraw quote 0.1 --asset ETH --to 0xRecipient... --chain sepolia\n  privacy-pools withdraw quote 100 --asset USDC --json --chain ethereum\n"
        + commandHelpText({
            prerequisites: "init",
            jsonFields: "{ mode, chain, asset, amount, quoteFeeBPS, quoteExpiresAt, ... }",
        }))
        .action(async (firstArg, secondArg, opts, subCmd) => {
        const globalOpts = subCmd.parent?.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        const isJson = mode.isJson;
        const isQuiet = mode.isQuiet;
        const silent = isQuiet || isJson;
        const isVerbose = globalOpts?.verbose ?? false;
        try {
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);
            const { amount: amountStr, asset: positionalOrFlagAsset } = resolveAmountAndAssetInput("withdraw quote", firstArg, secondArg, opts.asset);
            let pool;
            if (positionalOrFlagAsset) {
                pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
            }
            else {
                throw new CLIError("No asset specified. Use --asset.", "INPUT");
            }
            verbose(`Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool}`, isVerbose, silent);
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
            if (isJson) {
                printJsonSuccess({
                    mode: "relayed-quote",
                    chain: chainConfig.name,
                    asset: pool.symbol,
                    amount: amount.toString(),
                    recipient: recipient ?? null,
                    minWithdrawAmount: details.minWithdrawAmount,
                    maxRelayFeeBPS: pool.maxRelayFeeBPS.toString(),
                    quoteFeeBPS: quote.feeBPS,
                    feeCommitmentPresent: !!quote.feeCommitment,
                    quoteExpiresAt: expirationMs ? new Date(expirationMs).toISOString() : null,
                }, false);
                return;
            }
            process.stderr.write("\n");
            success("Relayer quote", silent);
            info(`Asset: ${pool.symbol}`, silent);
            info(`Amount: ${formatAmount(amount, pool.decimals, pool.symbol)}`, silent);
            info(`Min withdraw: ${details.minWithdrawAmount}`, silent);
            info(`Quoted fee: ${quote.feeBPS} BPS`, silent);
            info(`On-chain max fee: ${pool.maxRelayFeeBPS.toString()} BPS`, silent);
            if (recipient)
                info(`Recipient: ${formatAddress(recipient)}`, silent);
            if (expirationMs)
                info(`Quote expires: ${new Date(expirationMs).toISOString()}`, silent);
        }
        catch (error) {
            printError(error, isJson);
        }
    });
    return command;
}
