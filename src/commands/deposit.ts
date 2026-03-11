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
import { getPublicClient, getDataService } from "../services/sdk.js";
import { resolvePool, listPools } from "../services/pools.js";
import {
  initializeAccountService,
  saveAccount,
  saveSyncMeta,
  withSuppressedSdkStdoutSync,
} from "../services/account.js";
import { NATIVE_ASSET_ADDRESS, explorerTxUrl } from "../config/chains.js";
import {
  spinner,
  stageHeader,
  info,
  verbose,
  formatAmount,
  formatAddress,
  formatBPS,
  deriveTokenPrice,
  usdSuffix,
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
import { resolveGlobalMode, getConfirmationTimeoutMs } from "../utils/mode.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import { acquireProcessLock } from "../utils/lock.js";
import {
  approveERC20,
  depositERC20,
  depositETH,
} from "../services/contracts.js";
import {
  getNextPoolAccountNumber,
  poolAccountId,
} from "../utils/pool-accounts.js";

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

export function createDepositCommand(): Command {
  return new Command("deposit")
    .description("Deposit into a pool")
    .argument("<amountOrAsset>", "Amount to deposit (or asset symbol, see examples)")
    .argument("[amount]", "Amount (when asset is the first argument)")
    .option("-a, --asset <symbol|address>", "Asset to deposit (symbol like ETH, USDC, or contract address)")
    .option("--unsigned", "Build unsigned transaction payload(s); do not submit")
    .option("--unsigned-format <format>", "Unsigned output format (with --unsigned): envelope|tx")
    .option("--dry-run", "Validate and preview the transaction without submitting")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools deposit 0.1 ETH\n  privacy-pools deposit 0.05 ETH --json --yes\n  privacy-pools deposit 0.05 ETH --unsigned\n  privacy-pools deposit 0.1 ETH --dry-run\n  privacy-pools deposit 0.1 ETH --chain mainnet\n  privacy-pools deposit 0.1 --asset ETH\n"
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
              "INPUT",
              "Run 'privacy-pools pools --chain <chain>' to see available pools."
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
            "INPUT",
            "Run 'privacy-pools pools' to see available assets, then use --asset ETH (or the asset symbol)."
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
            `Deposit amount is below the minimum of ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)} for this pool.`,
            "INPUT",
            `Increase the amount to at least ${formatAmount(pool.minimumDepositAmount, pool.decimals, pool.symbol)}.`
          );
        }

        // Show fee preview and confirm
        const feeAmount = (amount * pool.vettingFeeBPS) / 10000n;
        const estimatedCommitted = amount - feeAmount;
        const tokenPrice = deriveTokenPrice(pool);
        const amountUsd = usdSuffix(amount, pool.decimals, tokenPrice);
        const feeUsd = usdSuffix(feeAmount, pool.decimals, tokenPrice);
        const committedUsd = usdSuffix(estimatedCommitted, pool.decimals, tokenPrice);
        if (!skipPrompts) {
          const isErc20 = pool.asset.toLowerCase() !== NATIVE_ASSET_ADDRESS.toLowerCase();
          info(`Vetting fee: ${formatBPS(pool.vettingFeeBPS)} (${formatAmount(feeAmount, pool.decimals, pool.symbol)}${feeUsd})`, silent);
          info(`You will receive: ~${formatAmount(estimatedCommitted, pool.decimals, pool.symbol)}${committedUsd} committed value`, silent);
          if (isErc20) {
            info("This will require 2 transactions: token approval + deposit.", silent);
          }
          process.stderr.write("\n");
          const txNote = isErc20 ? " (2 transactions: approve + deposit)" : "";
          const ok = await confirm({
            message: `Deposit ${formatAmount(amount, pool.decimals, pool.symbol)}${amountUsd} into ${pool.symbol} pool on ${chainConfig.name}?${txNote}`,
            default: true,
          });
          if (!ok) {
            info("Deposit cancelled.", silent);
            return;
          }
        }

        // Acquire process lock to prevent concurrent account mutations.
        const releaseLock = acquireProcessLock();
        try {

        // Load wallet/account state and generate deposit secrets.
        const mnemonic = loadMnemonic();
        const dataService = await getDataService(
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
          withSuppressedSdkStdoutSync(() =>
            accountService.createDepositSecrets(pool.scope as unknown as SDKHash)
          );
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

        const publicClient = getPublicClient(chainConfig, globalOpts?.rpcUrl);

        // ERC20 approval
        const depositSteps = isNative ? 1 : 2;
        if (!isNative) {
          stageHeader(1, depositSteps, "Approving token spend", silent);
          const spin = spinner("Approving token spend...", silent);
          spin.start();
          try {
            const approveTx = await approveERC20(
              chainConfig,
              pool.asset,
              chainConfig.entrypoint,
              amount,
              globalOpts?.rpcUrl
            );
            let approvalReceipt;
            try {
              approvalReceipt = await publicClient.waitForTransactionReceipt({
                hash: approveTx.hash as `0x${string}`,
                timeout: getConfirmationTimeoutMs(),
              });
            } catch {
              throw new CLIError(
                "Timed out waiting for approval confirmation.",
                "RPC",
                `Tx ${approveTx.hash} may still confirm. Retry the deposit to check allowance.`
              );
            }
            if (approvalReceipt.status !== "success") {
              throw new CLIError(
                `Approval transaction reverted: ${approveTx.hash}`,
                "CONTRACT",
                "Check the transaction on a block explorer for details."
              );
            }
            spin.succeed("Token approved.");
          } catch (error) {
            spin.fail("Approval failed.");
            throw error;
          }
        }

        // Deposit transaction
        if (!isNative) stageHeader(2, depositSteps, "Submitting deposit", silent);
        const spin = spinner("Submitting deposit transaction...", silent);
        spin.start();

        let tx;
        if (isNative) {
          tx = await depositETH(
            chainConfig,
            amount,
            precommitment as unknown as bigint,
            globalOpts?.rpcUrl
          );
        } else {
          tx = await depositERC20(
            chainConfig,
            pool.asset,
            amount,
            precommitment as unknown as bigint,
            globalOpts?.rpcUrl
          );
        }

        spin.text = "Waiting for confirmation...";
        let receipt;
        try {
          receipt = await publicClient.waitForTransactionReceipt({
            hash: tx.hash as `0x${string}`,
            timeout: getConfirmationTimeoutMs(),
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
              "Deposit confirmed onchain. Local state update pending: run 'privacy-pools sync' to finalize."
            );
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
                  tx.hash as Hex
                )
              );
              saveAccount(chainConfig.id, accountService.account);
              saveSyncMeta(chainConfig.id);
            } catch (saveErr) {
              process.stderr.write(
                `\nWarning: deposit confirmed onchain but failed to save locally: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}\n`
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

        } finally { releaseLock(); }
      } catch (error) {
        printError(error, isJson || isUnsigned);
      }
    });
}
