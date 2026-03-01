import { erc20Abi, formatUnits } from "viem";
import { CLIError } from "./errors.js";
/**
 * Pre-flight balance checks to fail fast before expensive operations
 * (proof generation, transaction submission).
 */
// Conservative gas limit estimate for Privacy Pool deposit/withdraw.
const GAS_LIMIT = 200000n;
// Absolute floor: if the RPC gas price fetch fails, fall back to this.
const FALLBACK_GAS_PRICE = 50000000000n; // 50 gwei
async function estimateGasBuffer(publicClient) {
    try {
        const gasPrice = await publicClient.getGasPrice();
        // Add a 20% margin to the live gas price to account for fluctuation.
        const bufferedPrice = gasPrice + (gasPrice / 5n);
        return GAS_LIMIT * bufferedPrice;
    }
    catch {
        return GAS_LIMIT * FALLBACK_GAS_PRICE;
    }
}
export async function checkNativeBalance(publicClient, signerAddress, requiredWei, symbol) {
    const [balance, gasBuffer] = await Promise.all([
        publicClient.getBalance({ address: signerAddress }),
        estimateGasBuffer(publicClient),
    ]);
    const totalNeeded = requiredWei + gasBuffer;
    if (balance < totalNeeded) {
        const have = formatUnits(balance, 18);
        const need = formatUnits(totalNeeded, 18);
        throw new CLIError(`Insufficient ${symbol} balance: have ${have}, need ~${need} (includes gas buffer).`, "INPUT", `Top up your wallet (${signerAddress}) before retrying.`, "INPUT_INSUFFICIENT_BALANCE");
    }
}
export async function checkErc20Balance(publicClient, tokenAddress, signerAddress, requiredAmount, decimals, symbol) {
    const balance = (await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [signerAddress],
    }));
    if (balance < requiredAmount) {
        const have = formatUnits(balance, decimals);
        const need = formatUnits(requiredAmount, decimals);
        throw new CLIError(`Insufficient ${symbol} balance: have ${have}, need ${need}.`, "INPUT", `Top up your wallet (${signerAddress}) with ${symbol} before retrying.`, "INPUT_INSUFFICIENT_BALANCE");
    }
}
/**
 * Lightweight gas check - verifies the signer has *some* native balance for gas.
 * Does not estimate exact gas cost (that would require a simulation call).
 */
export async function checkHasGas(publicClient, signerAddress, symbol = "ETH") {
    const balance = await publicClient.getBalance({ address: signerAddress });
    if (balance === 0n) {
        throw new CLIError(`Wallet has zero ${symbol} balance - cannot pay gas.`, "INPUT", `Send some ${symbol} to ${signerAddress} for transaction gas fees.`, "INPUT_NO_GAS");
    }
}
