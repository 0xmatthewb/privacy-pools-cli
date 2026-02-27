import { encodeFunctionData, parseAbi } from "viem";
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
export function buildUnsignedDepositOutput(params) {
    const transactions = [];
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
        transactions,
    };
}
export function buildUnsignedDirectWithdrawOutput(params) {
    const transaction = {
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
        transactions: [transaction],
    };
}
export function buildUnsignedRelayedWithdrawOutput(params) {
    const transaction = {
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
        transactions: [transaction],
        relayerRequest: params.relayerRequest,
    };
}
export function buildUnsignedRagequitOutput(params) {
    const transaction = {
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
        transactions: [transaction],
    };
}
