import type { Address, PublicClient } from "viem";
import { erc20Abi, formatUnits } from "viem";
import { CLIError } from "./errors.js";

/**
 * Pre-flight balance checks to fail fast before expensive operations
 * (proof generation, transaction submission).
 */

// Conservative gas buffer: 200k gas * 50 gwei (~0.01 ETH on mainnet)
const GAS_BUFFER_WEI = 200_000n * 50_000_000_000n;

export async function checkNativeBalance(
  publicClient: PublicClient,
  signerAddress: Address,
  requiredWei: bigint,
  symbol: string
): Promise<void> {
  const balance = await publicClient.getBalance({ address: signerAddress });
  const totalNeeded = requiredWei + GAS_BUFFER_WEI;
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
 * Lightweight gas check - verifies the signer has *some* native balance for gas.
 * Does not estimate exact gas cost (that would require a simulation call).
 */
export async function checkHasGas(
  publicClient: PublicClient,
  signerAddress: Address,
  symbol: string = "ETH"
): Promise<void> {
  const balance = await publicClient.getBalance({ address: signerAddress });
  if (balance === 0n) {
    throw new CLIError(
      `Wallet has zero ${symbol} balance - cannot pay gas.`,
      "INPUT",
      `Send some ${symbol} to ${signerAddress} for transaction gas fees.`,
      "INPUT_NO_GAS"
    );
  }
}
