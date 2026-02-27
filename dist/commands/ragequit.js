import { Command, Option } from "commander";
import { confirm, select } from "@inquirer/prompts";
import { privateKeyToAccount } from "viem/accounts";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getSDK, getContracts, getPublicClient, getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount } from "../services/account.js";
import { resolvePool, listPools } from "../services/pools.js";
import { explorerTxUrl } from "../config/chains.js";
import { spinner, info, warn, verbose, formatAmount, formatAddress, } from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { resolveOptionalAssetInput } from "../utils/positional.js";
import { createOutputContext } from "../output/common.js";
import { renderRagequitDryRun, renderRagequitSuccess } from "../output/ragequit.js";
import { printRawTransactions, toSolidityProof } from "../utils/unsigned.js";
import { buildUnsignedRagequitOutput } from "../utils/unsigned-flows.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import { buildPoolAccountRefs, parsePoolAccountSelector, poolAccountId, } from "../utils/pool-accounts.js";
export function createRagequitCommand() {
    return new Command("ragequit")
        .alias("exit")
        .description("Publicly withdraw funds without ASP approval (reveals deposit link)")
        .argument("[asset]", "Optional positional asset alias (e.g., ragequit ETH)")
        .option("-a, --asset <symbol|address>", "Asset pool to exit from")
        .option("-p, --from-pa <PA-#|#>", "Exit a specific Pool Account (e.g. PA-2)")
        .addOption(new Option("-i, --commitment <index>", "Deprecated: 0-based spendable commitment index (use --from-pa)")
        .hideHelp())
        .option("--unsigned", "Build unsigned transaction payload; do not submit")
        .option("--unsigned-format <format>", "Unsigned output format (with --unsigned): envelope|tx")
        .option("--dry-run", "Generate proof and validate without submitting")
        .addHelpText("after", "\nExamples:\n  privacy-pools exit --asset ETH -p PA-1 --chain sepolia\n  privacy-pools ragequit ETH -p PA-1 --chain sepolia\n  privacy-pools ragequit --asset 0xTokenAddress --json --yes -p PA-2\n  privacy-pools exit ETH --unsigned -p PA-1 --chain sepolia\n  privacy-pools ragequit ETH --unsigned --unsigned-format tx -p PA-1 --chain sepolia\n  privacy-pools exit --asset ETH --dry-run -p PA-1 --chain sepolia\n"
        + commandHelpText({
            prerequisites: "init (account state should be synced)",
            jsonFields: "{ txHash, amount, asset, chain, poolAccountId, blockNumber, explorerUrl, ... }",
            jsonVariants: [
                "--unsigned: { mode, operation, chain, asset, amount, transactions[] }",
                "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
                "--dry-run: { dryRun, operation, chain, asset, amount, selectedCommitmentLabel, proofPublicSignals }",
            ],
            supportsUnsigned: true,
            supportsDryRun: true,
        }))
        .action(async (assetArg, opts, cmd) => {
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
        const fromPaRaw = opts.fromPa;
        const fromPaNumber = fromPaRaw === undefined ? undefined : parsePoolAccountSelector(fromPaRaw);
        try {
            if (fromPaRaw !== undefined && fromPaNumber === null) {
                throw new CLIError(`Invalid --from-pa value: ${fromPaRaw}.`, "INPUT", "Use a Pool Account identifier like PA-2 (or just 2).");
            }
            if (fromPaRaw !== undefined && opts.commitment !== undefined) {
                throw new CLIError("Cannot use --from-pa and --commitment together.", "INPUT", "Use --from-pa for Pool Account selection. --commitment is deprecated.");
            }
            if (unsignedFormat && unsignedFormat !== "envelope" && unsignedFormat !== "tx") {
                throw new CLIError(`Unsupported unsigned format: ${opts.unsignedFormat}.`, "INPUT", "Use --unsigned-format envelope or --unsigned-format tx.");
            }
            if (unsignedFormat && !isUnsigned) {
                throw new CLIError("--unsigned-format requires --unsigned.", "INPUT", "Use: privacy-pools ragequit ... --unsigned --unsigned-format " + (unsignedFormat || "envelope"));
            }
            const config = loadConfig();
            const chainConfig = resolveChain(globalOpts?.chain, config.defaultChain);
            verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);
            const positionalOrFlagAsset = resolveOptionalAssetInput("ragequit", assetArg, opts.asset);
            // Resolve pool
            let pool;
            if (positionalOrFlagAsset) {
                pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
            }
            else if (!skipPrompts) {
                const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
                if (pools.length === 0) {
                    throw new CLIError(`No pools found on ${chainConfig.name}.`, "INPUT");
                }
                const selected = await select({
                    message: "Select asset pool to exit:",
                    choices: pools.map((p) => ({
                        name: `${p.symbol} (${formatAddress(p.asset)})`,
                        value: p.symbol,
                    })),
                });
                pool = pools.find((p) => p.symbol === selected);
            }
            else {
                throw new CLIError("No asset specified. Use --asset <symbol|address>.", "INPUT");
            }
            verbose(`Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`, isVerbose, silent);
            const mnemonic = loadMnemonic();
            // Private key is only needed for on-chain submission, not --unsigned or --dry-run
            let signerAddress = null;
            if (!isUnsigned && !isDryRun) {
                const privateKey = loadPrivateKey();
                signerAddress = privateKeyToAccount(privateKey).address;
            }
            // In unsigned/dry-run modes, do NOT touch the key file at all — the signer is optional
            const sdk = await getSDK();
            const dataService = getDataService(chainConfig, pool.pool, globalOpts?.rpcUrl);
            const spin = spinner("Loading account...", silent);
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
            // Get spendable commitments for this pool
            const spendable = accountService.getSpendableCommitments();
            const poolCommitments = spendable.get(pool.scope) ?? [];
            verbose(`Spendable commitments for scope: ${poolCommitments.length}`, isVerbose, silent);
            const poolAccounts = buildPoolAccountRefs(accountService.account, pool.scope, poolCommitments);
            if (poolCommitments.length === 0) {
                spin.stop();
                throw new CLIError("No spendable Pool Accounts found for exit.", "INPUT", `You may not have deposits in ${pool.symbol}. Try 'privacy-pools deposit ...' first.`);
            }
            spin.stop();
            // Select Pool Account
            let selectedPoolAccount;
            if (fromPaNumber !== undefined && fromPaNumber !== null) {
                const requestedPoolAccount = poolAccounts.find((pa) => pa.paNumber === fromPaNumber);
                if (!requestedPoolAccount) {
                    throw new CLIError(`Unknown Pool Account ${poolAccountId(fromPaNumber)} for ${pool.symbol}.`, "INPUT", `Run 'privacy-pools accounts --chain ${chainConfig.name}' to list available Pool Accounts.`);
                }
                selectedPoolAccount = requestedPoolAccount;
            }
            else if (opts.commitment !== undefined) {
                const idx = parseInt(opts.commitment, 10);
                if (isNaN(idx) || idx < 0 || idx >= poolCommitments.length) {
                    throw new CLIError(`Invalid commitment index: ${opts.commitment}. Valid range: 0-${poolCommitments.length - 1}`, "INPUT", "This legacy index is deprecated. Use --from-pa PA-<n> instead.");
                }
                const legacyCommitment = poolCommitments[idx];
                const matchedPoolAccount = poolAccounts.find((pa) => pa.label.toString() === legacyCommitment.label.toString() &&
                    pa.commitment.hash.toString() === legacyCommitment.hash.toString());
                if (!matchedPoolAccount) {
                    selectedPoolAccount = {
                        paNumber: idx + 1,
                        paId: poolAccountId(idx + 1),
                        status: "spendable",
                        aspStatus: "unknown",
                        commitment: legacyCommitment,
                        label: legacyCommitment.label,
                        value: legacyCommitment.value,
                        blockNumber: legacyCommitment.blockNumber,
                        txHash: legacyCommitment.txHash,
                    };
                }
                else {
                    selectedPoolAccount = matchedPoolAccount;
                }
                if (!silent) {
                    warn("--commitment is deprecated. Use --from-pa PA-<n> instead.", false);
                }
            }
            else if (!skipPrompts) {
                const selected = await select({
                    message: "Select Pool Account to exit:",
                    choices: poolAccounts.map((pa) => ({
                        name: `${pa.paId} • ${formatAmount(pa.value, pool.decimals, pool.symbol)}`,
                        value: pa.paNumber,
                    })),
                });
                selectedPoolAccount = poolAccounts.find((pa) => pa.paNumber === selected);
            }
            else {
                throw new CLIError("Must specify --from-pa in non-interactive mode.", "INPUT", "Use --from-pa <PA-#> to select which Pool Account to exit.");
            }
            const commitment = selectedPoolAccount.commitment;
            verbose(`Selected ${selectedPoolAccount.paId}: label=${commitment.label.toString()} value=${commitment.value.toString()}`, isVerbose, silent);
            // Critical warning
            if (!skipPrompts) {
                process.stderr.write("\n");
                warn("By exiting, you are withdrawing funds to your depositing address. You will not gain any privacy.", silent);
                process.stderr.write("\n");
                const ok = await confirm({
                    message: `Exit ${selectedPoolAccount.paId} and recover ${formatAmount(commitment.value, pool.decimals, pool.symbol)} from ${pool.symbol} pool? This is irreversible.`,
                    default: false,
                });
                if (!ok) {
                    info("Exit cancelled.", silent);
                    return;
                }
            }
            // Pre-flight gas check (skip for unsigned - relying on external signer)
            if (!isUnsigned && !isDryRun) {
                const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
                await checkHasGas(publicClient, signerAddress);
                // Pre-check: verify signer is the original depositor (avoids wasting proof generation)
                try {
                    const depositor = await publicClient.readContract({
                        address: pool.pool,
                        abi: [{
                                name: "depositors",
                                type: "function",
                                stateMutability: "view",
                                inputs: [{ name: "_label", type: "uint256" }],
                                outputs: [{ name: "", type: "address" }],
                            }],
                        functionName: "depositors",
                        args: [commitment.label],
                    });
                    if (depositor.toLowerCase() !== signerAddress.toLowerCase()) {
                        throw new CLIError(`Signer ${signerAddress} is not the original depositor (${depositor}).`, "INPUT", "Only the original depositor can exit this Pool Account. Check your signer key.");
                    }
                }
                catch (err) {
                    // If the contract doesn't expose depositors(), skip the check
                    if (err instanceof CLIError)
                        throw err;
                    verbose(`Could not verify depositor on-chain: ${err instanceof Error ? err.message : String(err)}`, isVerbose, silent);
                }
            }
            // Generate commitment proof
            spin.start();
            const proof = await withProofProgress(spin, "Generating commitment proof", () => sdk.proveCommitment(commitment.value, BigInt(commitment.label.toString()), commitment.nullifier, commitment.secret));
            if (isDryRun) {
                spin.succeed("Dry-run completed (no transaction submitted).");
                const ctx = createOutputContext(mode);
                renderRagequitDryRun(ctx, {
                    chain: chainConfig.name,
                    asset: pool.symbol,
                    amount: commitment.value,
                    decimals: pool.decimals,
                    poolAccountNumber: selectedPoolAccount.paNumber,
                    poolAccountId: selectedPoolAccount.paId,
                    selectedCommitmentLabel: commitment.label,
                    selectedCommitmentValue: commitment.value,
                    proofPublicSignals: proof.publicSignals?.length ?? 0,
                });
                return;
            }
            if (isUnsigned) {
                const solidityProof = toSolidityProof(proof);
                const payload = buildUnsignedRagequitOutput({
                    chainId: chainConfig.id,
                    chainName: chainConfig.name,
                    assetSymbol: pool.symbol,
                    amount: commitment.value,
                    from: signerAddress,
                    poolAddress: pool.pool,
                    selectedCommitmentLabel: commitment.label,
                    selectedCommitmentValue: commitment.value,
                    proof: solidityProof,
                });
                if (wantsTxFormat) {
                    printRawTransactions(payload.transactions);
                }
                else {
                    printJsonSuccess({
                        ...payload,
                        poolAccountNumber: selectedPoolAccount.paNumber,
                        poolAccountId: selectedPoolAccount.paId,
                    }, false);
                }
                return;
            }
            // Submit exit (ragequit)
            const contracts = await getContracts(chainConfig, globalOpts?.rpcUrl);
            spin.text = "Submitting exit transaction...";
            const tx = await contracts.ragequit(proof, pool.pool);
            spin.text = "Waiting for confirmation...";
            const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
            let receipt;
            try {
                receipt = await publicClient.waitForTransactionReceipt({
                    hash: tx.hash,
                    timeout: 300_000,
                });
            }
            catch {
                throw new CLIError("Timed out waiting for exit confirmation.", "RPC", `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to pick up the transaction.`);
            }
            if (receipt.status !== "success") {
                throw new CLIError(`Exit transaction reverted: ${tx.hash}`, "CONTRACT", "Check the transaction on a block explorer for details.");
            }
            guardCriticalSection();
            try {
                // Mark the account as ragequit so it's excluded from getSpendableCommitments()
                try {
                    accountService.addRagequitToAccount(commitment.label, {
                        ragequitter: signerAddress,
                        commitment: commitment.hash,
                        label: commitment.label,
                        value: commitment.value,
                        blockNumber: receipt.blockNumber,
                        transactionHash: tx.hash,
                    });
                }
                catch (err) {
                    // Non-fatal: next sync will discover the ragequit event on-chain
                    if (!silent) {
                        process.stderr.write(`Warning: failed to record ragequit locally: ${err instanceof Error ? err.message : String(err)}. Next sync will pick it up.\n`);
                    }
                }
                try {
                    saveAccount(chainConfig.id, accountService.account);
                }
                catch (err) {
                    process.stderr.write(`Warning: ragequit confirmed on-chain but failed to save local state: ${err instanceof Error ? err.message : String(err)}\n`);
                    process.stderr.write("⚠ Run 'privacy-pools sync' to update your local account state.\n");
                }
            }
            finally {
                releaseCriticalSection();
            }
            spin.succeed("Exit confirmed!");
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
            });
        }
        catch (error) {
            printError(error, isJson || isUnsigned);
        }
    });
}
