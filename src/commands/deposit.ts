import { Command } from "commander";
import { confirm, select } from "@inquirer/prompts";
import {
  type Hash as SDKHash,
} from "@0xbow/privacy-pools-core-sdk";
import type { Hex, Address } from "viem";
import { decodeEventLog, parseAbi } from "viem";
import { resolveChain, parseAmount, validatePositive } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic, loadPrivateKey } from "../services/wallet.js";
import { getContracts, getPublicClient, getDataService } from "../services/sdk.js";
import { resolvePool, listPools } from "../services/pools.js";
import { initializeAccountService, saveAccount } from "../services/account.js";
import { NATIVE_ASSET_ADDRESS } from "../config/chains.js";
import {
  spinner,
  success,
  info,
  verbose,
  formatAmount,
  formatAddress,
  formatTxHash,
} from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveAmountAndAssetInput } from "../utils/positional.js";
import { buildUnsignedDepositOutput } from "../utils/unsigned-flows.js";
import { checkNativeBalance, checkErc20Balance } from "../utils/preflight.js";
import { privateKeyToAccount } from "viem/accounts";

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

export function createDepositCommand(): Command {
  return new Command("deposit")
    .description("Deposit ETH or ERC20 tokens into a Privacy Pool")
    .argument("<amountOrAsset>", "Amount or asset (supports both <amount> --asset ... and <asset> <amount>)")
    .argument("[amount]", "Optional amount when using positional asset alias")
    .option("--asset <symbol|address>", "Asset to deposit (symbol like ETH, USDC, or contract address)")
    .option("--unsigned", "Output unsigned transaction payload(s) without submitting")
    .option("--dry-run", "Validate inputs and show transaction details without submitting")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools deposit 0.1 --asset ETH --chain sepolia\n  privacy-pools deposit ETH 0.1 --chain sepolia\n  privacy-pools deposit 100 --asset 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum\n  privacy-pools deposit 0.05 --asset ETH --json --yes\n  privacy-pools deposit ETH 0.05 --unsigned --chain sepolia\n  privacy-pools deposit 0.1 --asset ETH --dry-run --chain sepolia\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ txHash, amount, committedValue, asset, chain }",
          jsonVariants: [
            "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] }",
            "--dry-run: { dryRun, operation, chain, asset, amount, precommitment, balanceSufficient }",
          ],
        })
    )
    .action(async (firstArg, secondArg, opts, cmd) => {
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

        const { amount: amountStr, asset: positionalOrFlagAsset } = resolveAmountAndAssetInput(
          "deposit",
          firstArg,
          secondArg,
          opts.asset
        );

        // Resolve pool
        let pool;
        if (positionalOrFlagAsset) {
          pool = await resolvePool(chainConfig, positionalOrFlagAsset, globalOpts?.rpcUrl);
        } else if (!skipPrompts) {
          const pools = await listPools(chainConfig, globalOpts?.rpcUrl);
          if (pools.length === 0) {
            throw new CLIError(
              `No pools found on ${chainConfig.name}.`,
              "INPUT"
            );
          }

          const selected = await select({
            message: "Select asset to deposit:",
            choices: pools.map((p) => ({
              name: `${p.symbol} (${formatAddress(p.asset)})`,
              value: p.symbol,
            })),
          });
          pool = pools.find((p) => p.symbol === selected)!;
        } else {
          throw new CLIError(
            "No asset specified. Use --asset <symbol|address>.",
            "INPUT"
          );
        }
        verbose(
          `Pool resolved: ${pool.symbol} asset=${pool.asset} pool=${pool.pool} scope=${pool.scope.toString()}`,
          isVerbose,
          silent
        );

        // Parse and validate amount
        const amount = parseAmount(amountStr, pool.decimals);
        validatePositive(amount, "Deposit amount");
        verbose(`Deposit amount (raw): ${amount.toString()}`, isVerbose, silent);

        if (amount < pool.minimumDepositAmount) {
          throw new CLIError(
            `Amount below minimum deposit: ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)}`,
            "INPUT"
          );
        }

        // Confirm
        if (!skipPrompts) {
          const ok = await confirm({
            message: `Deposit ${formatAmount(amount, pool.decimals, pool.symbol)} into ${pool.symbol} pool on ${chainConfig.name}?`,
          });
          if (!ok) {
            info("Deposit cancelled.", silent);
            return;
          }
        }

        // Load wallet/account state and generate deposit secrets.
        const mnemonic = loadMnemonic();
        const dataService = getDataService(
          chainConfig,
          pool.pool,
          globalOpts?.rpcUrl
        );
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

        // Generate deposit secrets (SDK returns precommitment directly)
        const secrets =
          accountService.createDepositSecrets(pool.scope as unknown as SDKHash);
        const precommitment = secrets.precommitment;
        verbose(`Generated precommitment: ${precommitment.toString()}`, isVerbose, silent);

        const isNative =
          pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase();

        // Pre-flight balance check (skip for unsigned - signer may not exist)
        let balanceSufficient: boolean | "unknown" = "unknown";
        if (!isUnsigned) {
          try {
            const privateKey = loadPrivateKey();
            const signerAddr = privateKeyToAccount(privateKey).address;
            const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

            if (isNative) {
              await checkNativeBalance(publicClient, signerAddr, amount, pool.symbol);
            } else {
              await checkErc20Balance(
                publicClient, pool.asset, signerAddr, amount, pool.decimals, pool.symbol
              );
            }
            balanceSufficient = true;
          } catch (error) {
            if (isDryRun) {
              // Distinguish "no signer key" from "actually insufficient balance"
              const msg = error instanceof Error ? error.message : "";
              const isKeyError = msg.includes("private key") ||
                msg.includes("signer") ||
                msg.includes("mnemonic") ||
                msg.includes("ENOENT");
              balanceSufficient = isKeyError ? "unknown" : false;
            } else {
              throw error;
            }
          }
        }

        if (isDryRun) {
          if (isJson) {
            printJsonSuccess(
              {
                dryRun: true,
                operation: "deposit",
                chain: chainConfig.name,
                asset: pool.symbol,
                amount: amount.toString(),
                precommitment: (precommitment as unknown as bigint).toString(),
                balanceSufficient,
              },
              false
            );
          } else {
            process.stderr.write("\n");
            success("Dry-run complete.", silent);
            info(`Chain: ${chainConfig.name}`, silent);
            info(`Asset: ${pool.symbol}`, silent);
            info(`Amount: ${formatAmount(amount, pool.decimals, pool.symbol)}`, silent);
            const balanceLabel = balanceSufficient === "unknown" ? "unknown (no signer key)" : balanceSufficient ? "yes" : "no";
            info(`Balance sufficient: ${balanceLabel}`, silent);
            info("No transaction was submitted.", silent);
          }
          return;
        }

        if (isUnsigned) {
          let signerAddress: Address | null = null;
          try {
            signerAddress = privateKeyToAccount(loadPrivateKey()).address;
          } catch {
            signerAddress = null;
          }

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

          printJsonSuccess(payload, false);
          return;
        }

        const contracts = await getContracts(chainConfig, globalOpts?.rpcUrl);
        const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

        // ERC20 approval
        if (!isNative) {
          const spin = spinner("Approving token spend...", silent);
          spin.start();
          try {
            const approveTx = await contracts.approveERC20(
              chainConfig.entrypoint,
              pool.asset,
              amount
            );
            await approveTx.wait();
            spin.succeed("Token approved.");
          } catch (error) {
            spin.fail("Approval failed.");
            throw error;
          }
        }

        // Deposit transaction
        const spin = spinner("Submitting deposit transaction...", silent);
        spin.start();

        let tx;
        if (isNative) {
          tx = await contracts.depositETH(amount, precommitment as unknown as bigint);
        } else {
          tx = await contracts.depositERC20(pool.asset, amount, precommitment as unknown as bigint);
        }

        spin.text = "Waiting for confirmation...";
        await tx.wait();

        // Parse Deposited event from receipt
        const receipt = await publicClient.getTransactionReceipt({
          hash: tx.hash as `0x${string}`,
        });

        let label: bigint | undefined;
        let committedValue: bigint | undefined;

        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== pool.pool.toLowerCase()) {
            continue;
          }
          try {
            const decoded = decodeEventLog({
              abi: depositedEventAbi,
              data: log.data,
              topics: log.topics,
            });
            label = decoded.args._label;
            committedValue = decoded.args._value;
            break;
          } catch {
            // Not this event
          }
        }

        if (label === undefined || committedValue === undefined) {
          spin.warn("Deposit confirmed but could not parse event. Sync manually.");
        } else {
          // Persist the new commitment (7 individual args)
          accountService.addPoolAccount(
            pool.scope as unknown as SDKHash,
            committedValue,
            secrets.nullifier,
            secrets.secret,
            label as unknown as SDKHash,
            receipt.blockNumber,
            tx.hash as Hex
          );
          saveAccount(chainConfig.id, accountService.account);
        }

        spin.succeed("Deposit confirmed!");

        if (isJson) {
          printJsonSuccess(
            {
              txHash: tx.hash,
              amount: amount.toString(),
              committedValue: committedValue?.toString(),
              asset: pool.symbol,
              chain: chainConfig.name,
            },
            false
          );
        } else {
          process.stderr.write("\n");
          success(`Deposited ${formatAmount(amount, pool.decimals, pool.symbol)}`, silent);
          if (committedValue !== undefined) {
            info(
              `Committed: ${formatAmount(committedValue, pool.decimals, pool.symbol)} (after vetting fee)`,
              silent
            );
          }
          info(`Tx: ${formatTxHash(tx.hash)}`, silent);
        }
      } catch (error) {
        printError(error, isJson || isUnsigned || isDryRun);
      }
    });
}
