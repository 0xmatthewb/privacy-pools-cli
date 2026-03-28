import type { Address } from "viem";
import { CLIError } from "../utils/errors.js";

const poolCurrentRootAbi = [
  {
    name: "currentRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolRootsAbi = [
  {
    name: "roots",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const poolRootHistorySizeAbi = [
  {
    name: "ROOT_HISTORY_SIZE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
] as const;

interface PoolRootReader {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

export async function isKnownPoolRoot(
  publicClient: PoolRootReader,
  poolAddress: Address,
  root: bigint,
): Promise<boolean> {
  if (root === 0n) {
    return false;
  }

  const currentRoot = await publicClient.readContract({
    address: poolAddress,
    abi: poolCurrentRootAbi,
    functionName: "currentRoot",
  });

  if (BigInt(currentRoot as bigint) === root) {
    return true;
  }

  const rootHistorySize = Number(
    await publicClient.readContract({
      address: poolAddress,
      abi: poolRootHistorySizeAbi,
      functionName: "ROOT_HISTORY_SIZE",
    }),
  );

  const historicalRoots = await Promise.all(
    Array.from({ length: rootHistorySize }, (_, index) =>
      publicClient.readContract({
        address: poolAddress,
        abi: poolRootsAbi,
        functionName: "roots",
        args: [BigInt(index)],
      }),
    ),
  );

  return historicalRoots.some((knownRoot) => BigInt(knownRoot as bigint) === root);
}

export async function assertKnownPoolRoot(params: {
  publicClient: PoolRootReader;
  poolAddress: Address;
  proofRoot: bigint;
  message: string;
  hint: string;
}): Promise<void> {
  const known = await isKnownPoolRoot(
    params.publicClient,
    params.poolAddress,
    params.proofRoot,
  );

  if (!known) {
    throw new CLIError(params.message, "ASP", params.hint);
  }
}
