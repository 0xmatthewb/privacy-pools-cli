import { createPublicClient, createWalletClient, http } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainConfig } from "../types.js";
import { loadPrivateKey } from "./wallet.js";
import { getHealthyRpcUrl } from "./sdk.js";
import { getNetworkTimeoutMs } from "../utils/mode.js";
import {
  entrypointDepositErc20Abi,
  entrypointDepositNativeAbi,
  erc20ApproveAbi,
  privacyPoolRagequitAbi,
  privacyPoolWithdrawAbi,
} from "../utils/unsigned-flows.js";
import type { SolidityProof } from "../utils/unsigned.js";

type TransactionResponse = {
  hash: Hex;
};

type WithdrawalCall = {
  processooor: Address;
  data: Hex;
};

export type ContractWriteStatusHooks = {
  onBroadcasting?: () => Promise<void> | void;
  onSimulating?: () => Promise<void> | void;
};

type ApproveErc20Params = {
  chainConfig: ChainConfig;
  spenderAddress: Address;
  tokenAddress: Address;
  amount: bigint;
  rpcOverride?: string;
  privateKeyOverride?: string;
};

async function createWriteClients(
  chainConfig: ChainConfig,
  rpcOverride?: string,
  privateKeyOverride?: string
) {
  const rpcUrl = await getHealthyRpcUrl(chainConfig.id, rpcOverride);
  const timeoutMs = getNetworkTimeoutMs();
  const account = privateKeyToAccount(
    (privateKeyOverride ?? loadPrivateKey()) as `0x${string}`
  );

  return {
    account,
    publicClient: createPublicClient({
      chain: chainConfig.chain,
      transport: http(rpcUrl, { timeout: timeoutMs }),
    }),
    walletClient: createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(rpcUrl, { timeout: timeoutMs }),
    }),
  };
}

async function submitContractWrite(params: {
  chainConfig: ChainConfig;
  rpcOverride?: string;
  privateKeyOverride?: string;
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  statusHooks?: ContractWriteStatusHooks;
}): Promise<TransactionResponse> {
  const { account, publicClient, walletClient } = await createWriteClients(
    params.chainConfig,
    params.rpcOverride,
    params.privateKeyOverride
  );

  await params.statusHooks?.onSimulating?.();
  const { request } = await (publicClient as any).simulateContract({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    value: params.value ?? 0n,
    account,
  });

  await params.statusHooks?.onBroadcasting?.();
  const hash = await walletClient.writeContract({
    ...request,
    account,
  });

  return { hash };
}

export async function approveERC20({
  chainConfig,
  spenderAddress,
  tokenAddress,
  amount,
  rpcOverride,
  privateKeyOverride,
}: ApproveErc20Params
): Promise<TransactionResponse> {
  return submitContractWrite({
    chainConfig,
    rpcOverride,
    privateKeyOverride,
    address: tokenAddress,
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [spenderAddress, amount],
  });
}

export async function depositETH(
  chainConfig: ChainConfig,
  amount: bigint,
  precommitment: bigint,
  rpcOverride?: string,
  privateKeyOverride?: string
): Promise<TransactionResponse> {
  return submitContractWrite({
    chainConfig,
    rpcOverride,
    privateKeyOverride,
    address: chainConfig.entrypoint,
    abi: entrypointDepositNativeAbi,
    functionName: "deposit",
    args: [precommitment],
    value: amount,
  });
}

export async function depositERC20(
  chainConfig: ChainConfig,
  assetAddress: Address,
  amount: bigint,
  precommitment: bigint,
  rpcOverride?: string,
  privateKeyOverride?: string
): Promise<TransactionResponse> {
  return submitContractWrite({
    chainConfig,
    rpcOverride,
    privateKeyOverride,
    address: chainConfig.entrypoint,
    abi: entrypointDepositErc20Abi,
    functionName: "deposit",
    args: [assetAddress, amount, precommitment],
  });
}

export async function ragequit(
  chainConfig: ChainConfig,
  poolAddress: Address,
  proof: SolidityProof,
  rpcOverride?: string,
  privateKeyOverride?: string,
  statusHooks?: ContractWriteStatusHooks,
): Promise<TransactionResponse> {
  return submitContractWrite({
    chainConfig,
    rpcOverride,
    privateKeyOverride,
    address: poolAddress,
    abi: privacyPoolRagequitAbi,
    functionName: "ragequit",
    args: [proof],
    statusHooks,
  });
}

export async function withdrawDirect(
  chainConfig: ChainConfig,
  poolAddress: Address,
  withdrawal: WithdrawalCall,
  proof: SolidityProof,
  rpcOverride?: string,
  privateKeyOverride?: string,
  statusHooks?: ContractWriteStatusHooks,
): Promise<TransactionResponse> {
  return submitContractWrite({
    chainConfig,
    rpcOverride,
    privateKeyOverride,
    address: poolAddress,
    abi: privacyPoolWithdrawAbi,
    functionName: "withdraw",
    args: [withdrawal, proof],
    statusHooks,
  });
}
