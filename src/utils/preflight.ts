import type { Address, PublicClient } from "viem";
import { erc20Abi, formatUnits } from "viem";
import { CLIError } from "./errors.js";

/**
 * Pre-flight balance checks to fail fast before expensive operations
 * (proof generation, transaction submission).
 */

// Conservative gas limit estimate for Privacy Pool deposit/withdraw.
const GAS_LIMIT = 200_000n;
// Absolute floor: if the RPC gas price fetch fails, fall back to this.
const FALLBACK_GAS_PRICE = 50_000_000_000n; // 50 gwei

async function estimateGasBuffer(publicClient: PublicClient): Promise<bigint> {
  try {
    const gasPrice = await publicClient.getGasPrice();
    // Add a 20% margin to the live gas price to account for fluctuation.
    const bufferedPrice = gasPrice + (gasPrice / 5n);
    return GAS_LIMIT * bufferedPrice;
  } catch {
    return GAS_LIMIT * FALLBACK_GAS_PRICE;
  }
}

export async function checkNativeBalance(
  publicClient: PublicClient,
  signerAddress: Address,
  requiredWei: bigint,
  symbol: string
): Promise<void> {
  const [balance, gasBuffer] = await Promise.all([
    publicClient.getBalance({ address: signerAddress }),
    estimateGasBuffer(publicClient),
  ]);
  const totalNeeded = requiredWei + gasBuffer;
  if (balance < totalNeeded) {
    const have = formatUnits(balance, 18);
    const need = formatUnits(totalNeeded, 18);
    throw new CLIError(
      `Insufficient ${symbol} balance: have ${have}, need ~${need} (includes gas buffer).`,
      "INPUT",
      `Top up your wallet (${signerAddress}) before retrying.`,
      "INPUT_INSUFFICIENT_BALANCE"
    );
  }
}

export async function checkErc20Balance(
  publicClient: PublicClient,
  tokenAddress: Address,
  signerAddress: Address,
  requiredAmount: bigint,
  decimals: number,
  symbol: string
): Promise<void> {
  const balance = (await publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [signerAddress],
  })) as bigint;

  if (balance < requiredAmount) {
    const have = formatUnits(balance, decimals);
    const need = formatUnits(requiredAmount, decimals);
    throw new CLIError(
      `Insufficient ${symbol} balance: have ${have}, need ${need}.`,
      "INPUT",
      `Top up your wallet (${signerAddress}) with ${symbol} before retrying.`,
      "INPUT_INSUFFICIENT_BALANCE"
    );
  }
}

/**
 * Verifies the signer has enough native balance to cover gas for one or more
 * transactions.  Pass `txCount` > 1 for multi-step flows (e.g. ERC20 approve + deposit).
 */
export async function checkHasGas(
  publicClient: PublicClient,
  signerAddress: Address,
  symbol: string = "ETH",
  txCount: number = 1
): Promise<void> {
  const [balance, singleTxGas] = await Promise.all([
    publicClient.getBalance({ address: signerAddress }),
    estimateGasBuffer(publicClient),
  ]);
  const requiredGas = singleTxGas * BigInt(txCount);

  if (balance === 0n) {
    throw new CLIError(
      `Wallet has zero ${symbol} balance - cannot pay gas.`,
      "INPUT",
      `Send some ${symbol} to ${signerAddress} for transaction gas fees.`,
      "INPUT_NO_GAS"
    );
  }

  if (balance < requiredGas) {
    const have = formatUnits(balance, 18);
    const need = formatUnits(requiredGas, 18);
    throw new CLIError(
      `Insufficient ${symbol} for gas: have ${have}, need ~${need}${txCount > 1 ? ` (${txCount} transactions)` : ""}.`,
      "INPUT",
      `Top up your wallet (${signerAddress}) with ${symbol} to cover gas fees.`,
      "INPUT_INSUFFICIENT_GAS"
    );
  }
}
