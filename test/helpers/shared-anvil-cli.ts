import { readFileSync } from "node:fs";
import {
  createWalletClient,
  decodeEventLog,
  http,
  type Abi,
  type PublicClient,
} from "viem";
import {
  impersonateAccount,
  setBalance,
  stopImpersonatingAccount,
} from "./anvil.ts";
import {
  writeAnvilAspState,
  type AnvilAspPoolState,
  type AnvilAspState,
} from "./anvil-asp-server.ts";
import {
  sharedAnvilCliEnv,
  type SharedAnvilEnv,
} from "./shared-anvil-env.ts";

export type SharedPoolKey = "eth" | "erc20";

function poolIndex(poolKey: SharedPoolKey): number {
  return poolKey === "eth" ? 0 : 1;
}

export function sharedCliEnv(
  env: SharedAnvilEnv,
  circuitsDirOverride?: string,
): Record<string, string> {
  return {
    ...sharedAnvilCliEnv(env),
    PRIVACY_POOLS_CIRCUITS_DIR: circuitsDirOverride ?? env.circuitsDir,
  };
}

export function readSharedAspState(env: SharedAnvilEnv): AnvilAspState {
  return JSON.parse(readFileSync(env.aspStateFile, "utf8")) as AnvilAspState;
}

export function writeSharedAspState(
  env: SharedAnvilEnv,
  state: AnvilAspState,
): void {
  writeAnvilAspState(env.aspStateFile, state);
}

export function updateSharedPoolState(
  env: SharedAnvilEnv,
  poolKey: SharedPoolKey,
  update: (pool: AnvilAspPoolState) => AnvilAspPoolState,
): AnvilAspState {
  const state = readSharedAspState(env);
  const index = poolIndex(poolKey);
  const nextState = {
    ...state,
    pools: state.pools.map((pool, currentIndex) =>
      currentIndex === index ? update(pool) : pool),
  };
  writeSharedAspState(env, nextState);
  return nextState;
}

export function appendInsertedStateTreeLeaf(
  env: SharedAnvilEnv,
  poolKey: SharedPoolKey,
  commitment: bigint,
): void {
  updateSharedPoolState(env, poolKey, (pool) => ({
    ...pool,
    insertedStateTreeLeaves: [
      ...pool.insertedStateTreeLeaves,
      commitment.toString(),
    ],
  }));
}

export function setSharedLabelReviewStatus(
  env: SharedAnvilEnv,
  poolKey: SharedPoolKey,
  label: bigint,
  reviewStatus: "pending" | "declined" | "poi_required",
): void {
  const labelString = label.toString();
  updateSharedPoolState(env, poolKey, (pool) => ({
    ...pool,
    approvedLabels: pool.approvedLabels.filter((value) => value !== labelString),
    reviewStatuses: {
      ...pool.reviewStatuses,
      [labelString]: reviewStatus,
    },
  }));
}

export async function approveSharedLabels(options: {
  env: SharedAnvilEnv;
  chain: { id: number };
  entrypoint: `0x${string}`;
  entrypointAbi: Abi;
  publicClient: PublicClient;
  postmanAddress: `0x${string}`;
  labels: readonly bigint[];
  root: bigint;
  dummyCid: string;
  poolKey: SharedPoolKey;
}): Promise<void> {
  const {
    env,
    chain,
    entrypoint,
    entrypointAbi,
    publicClient,
    postmanAddress,
    labels,
    root,
    dummyCid,
    poolKey,
  } = options;

  await impersonateAccount(env.rpcUrl, postmanAddress);
  await setBalance(env.rpcUrl, postmanAddress, 10n ** 20n);

  try {
    const walletClient = createWalletClient({
      account: postmanAddress,
      chain,
      transport: http(env.rpcUrl),
    });

    const txHash = await walletClient.writeContract({
      address: entrypoint,
      abi: entrypointAbi,
      functionName: "updateRoot",
      args: [root, dummyCid],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`updateRoot reverted: ${txHash}`);
    }
  } finally {
    await stopImpersonatingAccount(env.rpcUrl, postmanAddress);
  }

  const labelStrings = labels.map((value) => value.toString());
  updateSharedPoolState(env, poolKey, (pool) => ({
    ...pool,
    approvedLabels: labelStrings,
    reviewStatuses: {
      ...pool.reviewStatuses,
      ...Object.fromEntries(
        labelStrings.map((value) => [value, "approved"] as const),
      ),
    },
  }));
}

export async function decodeDepositEvent(options: {
  publicClient: PublicClient;
  txHash: `0x${string}`;
  poolAddress: `0x${string}`;
  depositedEventAbi: Abi;
}): Promise<{ commitment: bigint; label: bigint }> {
  const { publicClient, txHash, poolAddress, depositedEventAbi } = options;
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: depositedEventAbi,
        data: log.data,
        topics: log.topics,
      });
      return {
        commitment: decoded.args._commitment,
        label: decoded.args._label,
      };
    } catch {
      // Ignore unrelated logs.
    }
  }
  throw new Error(`Deposit event not found for tx ${txHash}`);
}

export async function decodeWithdrawNewCommitmentEvent(options: {
  publicClient: PublicClient;
  txHash: `0x${string}`;
  poolAddress: `0x${string}`;
  withdrawnEventAbi: Abi;
}): Promise<bigint> {
  const { publicClient, txHash, poolAddress, withdrawnEventAbi } = options;
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: withdrawnEventAbi,
        data: log.data,
        topics: log.topics,
      });
      return decoded.args._newCommitment;
    } catch {
      // Ignore unrelated logs.
    }
  }
  throw new Error(`Withdrawn event not found for tx ${txHash}`);
}
