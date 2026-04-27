import type { Address, Hex } from "viem";
import { encodeFunctionData, parseAbi } from "viem";
import type { NextAction } from "../types.js";
import type {
  SolidityRagequitProof,
  SolidityWithdrawProof,
  UnsignedTransactionPayload,
} from "./unsigned.js";

export const erc20ApproveAbi = parseAbi([
  "function approve(address spender, uint256 amount)",
]);
export const entrypointDepositNativeAbi = parseAbi([
  "function deposit(uint256 _precommitment) payable",
]);
export const entrypointDepositErc20Abi = parseAbi([
  "function deposit(address _asset, uint256 _value, uint256 _precommitment)",
]);
export const privacyPoolWithdrawAbi = parseAbi([
  "function withdraw((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof)",
]);
export const entrypointRelayAbi = parseAbi([
  "function relay((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof, uint256 _scope)",
]);
export const privacyPoolRagequitAbi = parseAbi([
  "function ragequit((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals) _proof)",
]);

interface WithdrawalCall {
  processooor: Address;
  data: Hex;
}

interface UnsignedBase {
  chainId: number;
  chainName: string;
  assetSymbol: string;
  amount: bigint;
  from: Address | null;
}

export interface UnsignedDepositOutput {
  mode: "unsigned";
  operation: "deposit";
  chain: string;
  asset: string;
  amount: string;
  precommitment: string;
  warnings: Array<{ code: string; category: string; message: string }>;
  nextActions?: NextAction[];
  transactions: UnsignedTransactionPayload[];
}

export function buildUnsignedDepositOutput(params: UnsignedBase & {
  entrypoint: Address;
  assetAddress: Address;
  precommitment: bigint;
  isNative: boolean;
  nextActions?: NextAction[];
}): UnsignedDepositOutput {
  const transactions: UnsignedTransactionPayload[] = [];

  if (!params.isNative) {
    transactions.push({
      chainId: params.chainId,
      from: params.from,
      to: params.assetAddress,
      value: "0",
      data: encodeFunctionData({
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [params.entrypoint, params.amount],
      }),
      description: "Approve ERC-20 allowance for Entrypoint",
    });
  }

  transactions.push({
    chainId: params.chainId,
    from: params.from,
    to: params.entrypoint,
    value: params.isNative ? params.amount.toString() : "0",
    data: params.isNative
      ? encodeFunctionData({
        abi: entrypointDepositNativeAbi,
        functionName: "deposit",
        args: [params.precommitment],
      })
      : encodeFunctionData({
        abi: entrypointDepositErc20Abi,
        functionName: "deposit",
        args: [params.assetAddress, params.amount, params.precommitment],
      }),
    description: `Deposit ${params.assetSymbol} into Privacy Pool`,
  });

  return {
    mode: "unsigned",
    operation: "deposit",
    chain: params.chainName,
    asset: params.assetSymbol,
    amount: params.amount.toString(),
    precommitment: params.precommitment.toString(),
    warnings: unsignedPreviewWarnings(),
    ...(params.nextActions ? { nextActions: params.nextActions } : {}),
    transactions,
  };
}

export interface UnsignedDirectWithdrawOutput {
  mode: "unsigned";
  operation: "withdraw";
  withdrawMode: "direct";
  chain: string;
  asset: string;
  amount: string;
  recipient: Address;
  selectedCommitmentLabel: string;
  selectedCommitmentValue: string;
  privacyCostManifest: Record<string, unknown>;
  warnings: Array<{ code: string; category: string; message: string }>;
  nextActions?: NextAction[];
  transactions: UnsignedTransactionPayload[];
}

export function buildUnsignedDirectWithdrawOutput(params: UnsignedBase & {
  poolAddress: Address;
  recipient: Address;
  poolAccountId?: string;
  selectedCommitmentLabel: bigint;
  selectedCommitmentValue: bigint;
  withdrawal: WithdrawalCall;
  proof: SolidityWithdrawProof;
  nextActions?: NextAction[];
}): UnsignedDirectWithdrawOutput {
  const transaction: UnsignedTransactionPayload = {
    chainId: params.chainId,
    from: params.from,
    to: params.poolAddress,
    value: "0",
    data: encodeFunctionData({
      abi: privacyPoolWithdrawAbi,
      functionName: "withdraw",
      args: [params.withdrawal, params.proof],
    }),
    description: "Direct withdraw from Privacy Pool",
  };

  return {
    mode: "unsigned",
    operation: "withdraw",
    withdrawMode: "direct",
    chain: params.chainName,
    asset: params.assetSymbol,
    amount: params.amount.toString(),
    recipient: params.recipient,
    selectedCommitmentLabel: params.selectedCommitmentLabel.toString(),
    selectedCommitmentValue: params.selectedCommitmentValue.toString(),
    privacyCostManifest: {
      action: "withdraw --direct",
      framing: "public_direct_withdrawal",
      poolAccountId: params.poolAccountId ?? null,
      amount: params.amount.toString(),
      asset: params.assetSymbol,
      chain: params.chainName,
      recipient: params.recipient,
      privacyCost: "direct withdrawal publicly links the deposit and withdrawal addresses onchain",
      privacyPreserved: false,
      recommendation: "Use the default relayed withdrawal path unless you intentionally accept this privacy loss.",
    },
    warnings: unsignedPreviewWarnings(),
    ...(params.nextActions ? { nextActions: params.nextActions } : {}),
    transactions: [transaction],
  };
}

export interface UnsignedRelayedWithdrawOutput {
  mode: "unsigned";
  operation: "withdraw";
  withdrawMode: "relayed";
  chain: string;
  asset: string;
  amount: string;
  recipient: Address;
  selectedCommitmentLabel: string;
  selectedCommitmentValue: string;
  feeBPS: string;
  quoteExpiresAt: string;
  quoteSummary?: {
    quotedAt: string;
    quoteExpiresAt: string;
    baseFeeBPS: string;
    quoteFeeBPS: string;
    feeAmount: string;
    netAmount: string;
    relayerHost: string;
    extraGas: boolean;
  };
  warnings: Array<{ code: string; category: string; message: string }>;
  nextActions?: NextAction[];
  transactions: UnsignedTransactionPayload[];
  relayerRequest: unknown;
}

export function buildUnsignedRelayedWithdrawOutput(params: UnsignedBase & {
  entrypoint: Address;
  scope: bigint;
  recipient: Address;
  selectedCommitmentLabel: bigint;
  selectedCommitmentValue: bigint;
  feeBPS: string;
  quoteExpiresAt: string;
  quotedAt: string;
  baseFeeBPS: string;
  relayerHost: string;
  extraGas: boolean;
  withdrawal: WithdrawalCall;
  proof: SolidityWithdrawProof;
  relayerRequest: unknown;
  nextActions?: NextAction[];
}): UnsignedRelayedWithdrawOutput {
  const feeAmount = (params.amount * BigInt(params.feeBPS)) / 10000n;
  const netAmount = params.amount - feeAmount;
  const transaction: UnsignedTransactionPayload = {
    chainId: params.chainId,
    from: params.from,
    to: params.entrypoint,
    value: "0",
    data: encodeFunctionData({
      abi: entrypointRelayAbi,
      functionName: "relay",
      args: [params.withdrawal, params.proof, params.scope],
    }),
    description: "Relay withdrawal through Entrypoint",
  };

  return {
    mode: "unsigned",
    operation: "withdraw",
    withdrawMode: "relayed",
    chain: params.chainName,
    asset: params.assetSymbol,
    amount: params.amount.toString(),
    recipient: params.recipient,
    selectedCommitmentLabel: params.selectedCommitmentLabel.toString(),
    selectedCommitmentValue: params.selectedCommitmentValue.toString(),
    feeBPS: params.feeBPS,
    quoteExpiresAt: params.quoteExpiresAt,
    quoteSummary: {
      quotedAt: params.quotedAt,
      quoteExpiresAt: params.quoteExpiresAt,
      baseFeeBPS: params.baseFeeBPS,
      quoteFeeBPS: params.feeBPS,
      feeAmount: feeAmount.toString(),
      netAmount: netAmount.toString(),
      relayerHost: params.relayerHost,
      extraGas: params.extraGas,
    },
    warnings: unsignedPreviewWarnings(),
    ...(params.nextActions ? { nextActions: params.nextActions } : {}),
    transactions: [transaction],
    relayerRequest: params.relayerRequest,
  };
}

export interface UnsignedRagequitOutput {
  mode: "unsigned";
  operation: "ragequit";
  chain: string;
  asset: string;
  amount: string;
  selectedCommitmentLabel: string;
  selectedCommitmentValue: string;
  privacyCostManifest: Record<string, unknown>;
  warnings: Array<{ code: string; category: string; message: string }>;
  nextActions?: NextAction[];
  transactions: UnsignedTransactionPayload[];
}

export function buildUnsignedRagequitOutput(params: UnsignedBase & {
  poolAddress: Address;
  poolAccountId?: string;
  selectedCommitmentLabel: bigint;
  selectedCommitmentValue: bigint;
  proof: SolidityRagequitProof;
  nextActions?: NextAction[];
}): UnsignedRagequitOutput {
  const transaction: UnsignedTransactionPayload = {
    chainId: params.chainId,
    from: params.from,
    to: params.poolAddress,
    value: "0",
    data: encodeFunctionData({
      abi: privacyPoolRagequitAbi,
      functionName: "ragequit",
      args: [params.proof],
    }),
    description: "Ragequit from Privacy Pool",
  };

  return {
    mode: "unsigned",
    operation: "ragequit",
    chain: params.chainName,
    asset: params.assetSymbol,
    amount: params.selectedCommitmentValue.toString(),
    selectedCommitmentLabel: params.selectedCommitmentLabel.toString(),
    selectedCommitmentValue: params.selectedCommitmentValue.toString(),
    privacyCostManifest: {
      action: "ragequit",
      framing: "public_self_custody_recovery",
      poolAccountId: params.poolAccountId ?? null,
      amount: params.selectedCommitmentValue.toString(),
      asset: params.assetSymbol,
      chain: params.chainName,
      destinationAddress: params.from,
      privacyCost: "funds return publicly to the original depositing address",
      privacyPreserved: false,
      recommendation: "Prefer a relayed private withdrawal when the Pool Account is approved and above the relayer minimum.",
    },
    warnings: unsignedPreviewWarnings(),
    ...(params.nextActions ? { nextActions: params.nextActions } : {}),
    transactions: [transaction],
  };
}

function unsignedPreviewWarnings(): Array<{ code: string; category: string; message: string }> {
  return [
    {
      code: "UNSIGNED_VALIDATION_APPROXIMATE",
      category: "preview",
      message: "Unsigned output is a transaction payload preview; final validation happens when the signer broadcasts it.",
    },
  ];
}
