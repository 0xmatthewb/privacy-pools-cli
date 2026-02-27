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
import { NATIVE_ASSET_ADDRESS, explorerTxUrl } from "../config/chains.js";
import {
  spinner,
  info,
  verbose,
  formatAmount,
  formatAddress,
  formatBPS,
} from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveAmountAndAssetInput } from "../utils/positional.js";
import { createOutputContext } from "../output/common.js";
import { renderDepositDryRun, renderDepositSuccess } from "../output/deposit.js";
import { buildUnsignedDepositOutput } from "../utils/unsigned-flows.js";
import { checkNativeBalance, checkErc20Balance, checkHasGas } from "../utils/preflight.js";
import { printRawTransactions } from "../utils/unsigned.js";
import { privateKeyToAccount } from "viem/accounts";
import { resolveGlobalMode } from "../utils/mode.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import {
  getNextPoolAccountNumber,
  poolAccountId,
} from "../utils/pool-accounts.js";

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

export function createDepositCommand(): Command {
  return new Command("deposit")
    .description("Deposit ETH or ERC-20 tokens into a Privacy Pool")
    .argument("<amountOrAsset>", "Amount to deposit (or asset symbol, see examples)")
    .argument("[amount]", "Amount (when asset is the first argument)")
    .option("-a, --asset <symbol|address>", "Asset to deposit (symbol like ETH, USDC, or contract address)")
    .option("--unsigned", "Build unsigned transaction payload(s); do not submit")
    .option("--unsigned-format <format>", "Unsigned output format (with --unsigned): envelope|tx")
    .option("--dry-run", "Validate and preview the transaction without submitting")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools deposit 0.1 --asset ETH --chain sepolia\n  privacy-pools deposit ETH 0.1 --chain sepolia\n  privacy-pools deposit 100 --asset 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain ethereum\n  privacy-pools deposit 0.05 --asset ETH --json --yes\n  privacy-pools deposit ETH 0.05 --unsigned --chain sepolia\n  privacy-pools deposit ETH 0.05 --unsigned --unsigned-format tx --chain sepolia\n  privacy-pools deposit 0.1 --asset ETH --dry-run --chain sepolia\n"
        + commandHelpText({
          prerequisites: "init",
          jsonFields: "{ txHash, amount, committedValue, asset, chain, poolAccountId, blockNumber, explorerUrl, ... }",
          jsonVariants: [
            "--unsigned: { mode, operation, chain, asset, amount, precommitment, transactions[] }",
            "--unsigned --unsigned-format tx: [{ to, data, value, valueHex, chainId }]",
            "--dry-run: { dryRun, operation, chain, asset, amount, precommitment, balanceSufficient }",
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

      try {
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
            "Use: privacy-pools deposit ... --unsigned --unsigned-format " + (unsignedFormat || "envelope")
          );
        }

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

        // Show fee preview and confirm
        const feeAmount = (amount * pool.vettingFeeBPS) / 10000n;
        const estimatedCommitted = amount - feeAmount;
        if (!skipPrompts) {
          info(`Vetting fee: ${formatBPS(pool.vettingFeeBPS)} (${formatAmount(feeAmount, pool.decimals, pool.symbol)})`, silent);
          info(`You will receive: ~${formatAmount(estimatedCommitted, pool.decimals, pool.symbol)} committed value`, silent);
          process.stderr.write("\n");
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
          true, // sync to pick up latest on-chain state
          silent,
          true
        );
        const nextPANumber = getNextPoolAccountNumber(
          accountService.account,
          pool.scope
        );
        const nextPAId = poolAccountId(nextPANumber);

        // Generate deposit secrets (SDK returns precommitment directly)
        const secrets =
          accountService.createDepositSecrets(pool.scope as unknown as SDKHash);
        const precommitment = secrets.precommitment;
        verbose(`Generated precommitment (truncated): ${precommitment.toString().slice(0, 8)}...`, isVerbose, silent);

        const isNative =
          pool.asset.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase();

        // Pre-flight balance check (skip for unsigned - signer may not exist)
        let balanceSufficient: boolean | "unknown" = "unknown";
        if (!isUnsigned && !isDryRun) {
          // Full check: load key and verify balance
          const privateKey = loadPrivateKey();
          const signerAddr = privateKeyToAccount(privateKey).address;
          const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

          if (isNative) {
            await checkNativeBalance(publicClient, signerAddr, amount, pool.symbol);
          } else {
            await checkErc20Balance(
              publicClient, pool.asset, signerAddr, amount, pool.decimals, pool.symbol
            );
            // Also check native balance for gas (approve + deposit txs)
            await checkHasGas(publicClient, signerAddr);
          }
          balanceSufficient = true;
        } else if (isDryRun && !isUnsigned) {
          // Dry-run: attempt balance check but don't fail on missing key
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
              await checkHasGas(publicClient, signerAddr);
            }
            balanceSufficient = true;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "";
            const isKeyError = msg.includes("private key") ||
              msg.includes("signer") ||
              msg.includes("mnemonic") ||
              msg.includes("ENOENT");
            balanceSufficient = isKeyError ? "unknown" : false;
          }
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
            printJsonSuccess(payload, false);
          }
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
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({
            hash: tx.hash as `0x${string}`,
            timeout: 300_000,
          });
        } catch {
          throw new CLIError(
            "Timed out waiting for deposit confirmation.",
            "RPC",
            `Tx ${tx.hash} may still confirm. Run 'privacy-pools sync' to pick up the transaction.`
          );
        }
        if (receipt.status !== "success") {
          throw new CLIError(
            `Deposit transaction reverted: ${tx.hash}`,
            "CONTRACT",
            "Check the transaction on a block explorer for details."
          );
        }
        let label: bigint | undefined;
        let committedValue: bigint | undefined;
        guardCriticalSection();
        try {

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
            spin.warn(
              "Deposit confirmed on-chain. Local state update pending: run 'privacy-pools sync' to finalize."
            );
          } else {
            // Persist the new commitment (7 individual args)
            try {
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
            } catch (saveErr) {
              process.stderr.write(
                `\nWarning: deposit confirmed on-chain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`
              );
              process.stderr.write(
                "⚠ Run 'privacy-pools sync' to update your local account state.\n"
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
        });
      } catch (error) {
        printError(error, isJson || isUnsigned);
      }
    });
}
