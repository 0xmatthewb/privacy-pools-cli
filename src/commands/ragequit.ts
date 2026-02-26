import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Hash as SDKHash } from "@0xbow/privacy-pools-core-sdk";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getSDK, getContracts, getPublicClient, getDataService } from "../services/sdk.js";
import { initializeAccountService, saveAccount } from "../services/account.js";
import { resolvePool, listPools } from "../services/pools.js";
import {
  spinner,
  success,
  info,
  warn,
  verbose,
  formatAmount,
  formatAddress,
  formatTxHash,
} from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import { resolveOptionalAssetInput } from "../utils/positional.js";
import { toSolidityProof } from "../utils/unsigned.js";
import { buildUnsignedRagequitOutput } from "../utils/unsigned-flows.js";
import { checkHasGas } from "../utils/preflight.js";
import { withProofProgress } from "../utils/proof-progress.js";
import type { GlobalOptions } from "../types.js";

export function createRagequitCommand(): Command {
  return new Command("ragequit")
    .description("Emergency public exit - sacrifices privacy to recover funds")
    .argument("[asset]", "Optional positional asset alias (e.g., ragequit ETH)")
    .option("--asset <symbol|address>", "Asset pool to ragequit from")
    .option("--commitment <index>", "Commitment index to ragequit (0-based)")
    .option("--unsigned", "Output unsigned transaction payload without submitting")
    .option("--dry-run", "Generate proof and validate without submitting ragequit")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools ragequit --asset ETH --chain sepolia\n  privacy-pools ragequit ETH --chain sepolia\n  privacy-pools ragequit --asset ETH --commitment 0 --yes\n  privacy-pools ragequit --asset 0xTokenAddress --json --yes\n  privacy-pools ragequit ETH --unsigned --chain sepolia\n  privacy-pools ragequit --asset ETH --dry-run --chain sepolia\n"
        + commandHelpText({
          prerequisites: "init (account state should be synced)",
          jsonFields: "{ txHash, amount, asset, chain }",
          jsonVariants: [
            "--unsigned: { mode, operation, chain, asset, amount, transactions[] }",
            "--dry-run: { dryRun, operation, chain, asset, amount, selectedCommitmentLabel, proofPublicSignals }",
          ],
        })
    )
    .action(async (assetArg, opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const isJson = globalOpts?.json ?? false;
      const isQuiet = globalOpts?.quiet ?? false;
      const isUnsigned = opts.unsigned ?? false;
      const isDryRun = opts.dryRun ?? false;
      const silent = isQuiet || isJson || isUnsigned;
      const skipPrompts = (globalOpts?.yes ?? false) || isUnsigned || isDryRun;
      const isVerbose = globalOpts?.verbose ?? false;

      try {
        const config = loadConfig();
        const chainConfig = resolveChain(
          globalOpts?.chain,
          config.defaultChain
        );
        verbose(`Chain: ${chainConfig.name} (${chainConfig.id})`, isVerbose, silent);

        const positionalOrFlagAsset = resolveOptionalAssetInput(
          "ragequit",
          assetArg,
          opts.asset
        );

        // Resolve pool
        let pool;
        if (positionalOrFlagAsset) {
          pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
        } else if (!skipPrompts) {
          const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
          if (pools.length === 0) {
            throw new CLIError(`No pools on ${chainConfig.name}.`, "INPUT");
          }
          const selected = await select({
            message: "Select asset pool for ragequit:",
            choices: pools.map((p) => ({
              name: `${p.symbol} (${formatAddress(p.asset)})`,
              value: p.symbol,
            })),
          });
          pool = pools.find((p) => p.symbol === selected)!;
        } else {
          throw new CLIError("No asset specified. Use --asset.", "INPUT");
        }
        verbose(
          `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
          isVerbose,
          silent
        );

        const mnemonic = loadMnemonic();

        // Private key is only needed for on-chain submission, not --unsigned or --dry-run
        let signerAddress: Address | null = null;
        if (!isUnsigned && !isDryRun) {
          const privateKey = loadPrivateKey();
          signerAddress = privateKeyToAccount(privateKey).address;
        } else {
          try {
            signerAddress = privateKeyToAccount(loadPrivateKey()).address;
          } catch {
            signerAddress = null;
          }
        }

        const sdk = await getSDK();

        const dataService = getDataService(
          chainConfig,
          pool.pool,
          globalOpts?.rpcUrl
        );

        const spin = spinner("Loading account...", silent);
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
          true // sync to pick up latest on-chain state
        );

        // Get spendable commitments for this pool
        const spendable = accountService.getSpendableCommitments();
        const poolCommitments =
          spendable.get(pool.scope) ?? [];
        verbose(`Spendable commitments for scope: ${poolCommitments.length}`, isVerbose, silent);

        if (poolCommitments.length === 0) {
          spin.stop();
          throw new CLIError(
            "No spendable commitments found for ragequit.",
            "INPUT",
            "You may not have any deposits in this pool."
          );
        }

        spin.stop();

        // Select commitment
        let commitment;
        if (opts.commitment !== undefined) {
          const idx = parseInt(opts.commitment, 10);
          if (isNaN(idx) || idx < 0 || idx >= poolCommitments.length) {
            throw new CLIError(
              `Invalid commitment index: ${opts.commitment}. Valid range: 0-${poolCommitments.length - 1}`,
              "INPUT"
            );
          }
          commitment = poolCommitments[idx];
        } else if (!skipPrompts) {
          const selected = await select({
            message: "Select commitment to ragequit:",
            choices: poolCommitments.map((c, i) => ({
              name: `[${i}] ${formatAmount(c.value, pool.decimals, pool.symbol)} (block ${c.blockNumber})`,
              value: i,
            })),
          });
          commitment = poolCommitments[selected];
        } else {
          // Default to first commitment
          commitment = poolCommitments[0];
        }
        verbose(
          `Selected commitment: label=${commitment.label.toString()} value=${commitment.value.toString()}`,
          isVerbose,
          silent
        );

        // Critical warning
        if (!skipPrompts) {
          process.stderr.write("\n");
          warn(
            "RAGEQUIT reveals your deposit publicly and sacrifices privacy.",
            silent
          );
          warn(
            "Your deposit address will be linked to this ragequit transaction.",
            silent
          );
          process.stderr.write("\n");

          const ok = await confirm({
            message: `Ragequit ${formatAmount(commitment.value, pool.decimals, pool.symbol)} from ${pool.symbol} pool? This is irreversible.`,
            default: false,
          });
          if (!ok) {
            info("Ragequit cancelled.", silent);
            return;
          }
        }

        // Pre-flight gas check (skip for unsigned - relying on external signer)
        if (!isUnsigned && !isDryRun) {
          const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
          await checkHasGas(publicClient, signerAddress!);
        }

        // Generate commitment proof
        spin.start();

        const proof = await withProofProgress(
          spin,
          "Generating commitment proof",
          () => sdk.proveCommitment(
            commitment.value,
            BigInt(commitment.label.toString()),
            commitment.nullifier,
            commitment.secret
          )
        );

        if (isDryRun) {
          spin.succeed("Dry-run completed (no transaction submitted).");
          if (isJson) {
            printJsonSuccess(
              {
                dryRun: true,
                operation: "ragequit",
                chain: chainConfig.name,
                asset: pool.symbol,
                amount: commitment.value.toString(),
                selectedCommitmentLabel: commitment.label.toString(),
                selectedCommitmentValue: commitment.value.toString(),
                proofPublicSignals: (proof as any).publicSignals?.length ?? 0,
              },
              false
            );
          } else {
            process.stderr.write("\n");
            success("Dry-run complete.", silent);
            info(`Chain: ${chainConfig.name}`, silent);
            info(`Asset: ${pool.symbol}`, silent);
            info(`Amount: ${formatAmount(commitment.value, pool.decimals, pool.symbol)}`, silent);
            info(
              `Selected commitment: label=${commitment.label.toString()} value=${formatAmount(commitment.value, pool.decimals, pool.symbol)}`,
              silent
            );
            info("No transaction was submitted.", silent);
          }
          return;
        }

        if (isUnsigned) {
          const solidityProof = toSolidityProof(proof as any);
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

          printJsonSuccess(payload, false);
          return;
        }

        // Submit ragequit (contracts requires private key, so load it only for actual submission)
        const contracts = await getContracts(chainConfig, globalOpts?.rpcUrl);
        spin.text = "Submitting ragequit transaction...";
        const tx = await contracts.ragequit(proof, pool.pool);

        spin.text = "Waiting for confirmation...";
        await tx.wait();

        // Get receipt and verify success
        const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);
        const receipt = await publicClient.getTransactionReceipt({
          hash: tx.hash as `0x${string}`,
        });

        if (receipt.status !== "success") {
          throw new CLIError(
            `Ragequit transaction reverted: ${tx.hash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details."
          );
        }

        // Mark the account as ragequit so it's excluded from getSpendableCommitments()
        try {
          accountService.addRagequitToAccount(
            commitment.label as unknown as SDKHash,
            {
              ragequitter: signerAddress,
              commitment: commitment.hash,
              label: commitment.label,
              value: commitment.value,
              blockNumber: receipt.blockNumber,
              transactionHash: tx.hash as Hex,
            } as any
          );
        } catch (err) {
          // Non-fatal: next sync will discover the ragequit event on-chain
          process.stderr.write(`Warning: failed to record ragequit locally: ${err instanceof Error ? err.message : String(err)}. Next sync will recover.\n`);
        }
        saveAccount(chainConfig.id, accountService.account);

        spin.succeed("Ragequit confirmed!");

        if (isJson) {
          printJsonSuccess(
            {
              txHash: tx.hash,
              amount: commitment.value.toString(),
              asset: pool.symbol,
              chain: chainConfig.name,
            },
            false
          );
        } else {
          process.stderr.write("\n");
          success(
            `Recovered ${formatAmount(commitment.value, pool.decimals, pool.symbol)}`,
            silent
          );
          info(`Tx: ${formatTxHash(tx.hash)}`, silent);
        }
      } catch (error) {
        printError(error, isJson || isUnsigned || isDryRun);
      }
    });
}
