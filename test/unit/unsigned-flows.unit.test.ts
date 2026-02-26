import { describe, expect, test } from "bun:test";
import { decodeFunctionData } from "viem";
import {
  buildUnsignedDepositOutput,
  buildUnsignedDirectWithdrawOutput,
  buildUnsignedRelayedWithdrawOutput,
  buildUnsignedRagequitOutput,
  entrypointDepositErc20Abi,
  entrypointDepositNativeAbi,
  entrypointRelayAbi,
  erc20ApproveAbi,
  privacyPoolRagequitAbi,
  privacyPoolWithdrawAbi,
} from "../../src/utils/unsigned-flows.ts";

describe("unsigned payload contract + ABI decodability", () => {
  test("deposit unsigned (native) shape is stable and calldata decodes", () => {
    const amount = 100000000000000000n;
    const precommitment = 123456789n;

    const payload = buildUnsignedDepositOutput({
      chainId: 11155111,
      chainName: "sepolia",
      entrypoint: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
      assetAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      assetSymbol: "ETH",
      amount,
      precommitment,
      from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      isNative: true,
    });

    expect(payload.mode).toBe("unsigned");
    expect(payload.operation).toBe("deposit");
    expect(payload.transactions.length).toBe(1);

    const tx = payload.transactions[0];
    expect(tx.value).toBe(amount.toString());
    const decoded = decodeFunctionData({
      abi: entrypointDepositNativeAbi,
      data: tx.data,
    });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args?.[0]).toBe(precommitment);
  });

  test("deposit unsigned (erc20) includes approve + deposit calldata that decode cleanly", () => {
    const amount = 2500000n;
    const precommitment = 987654321n;
    const entrypoint = "0x6818809eefce719e480a7526d76bd3e561526b46";
    const asset = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

    const payload = buildUnsignedDepositOutput({
      chainId: 1,
      chainName: "ethereum",
      entrypoint,
      assetAddress: asset,
      assetSymbol: "USDC",
      amount,
      precommitment,
      from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      isNative: false,
    });

    expect(payload.transactions.length).toBe(2);
    const approveTx = payload.transactions[0];
    const depositTx = payload.transactions[1];

    const approveDecoded = decodeFunctionData({
      abi: erc20ApproveAbi,
      data: approveTx.data,
    });
    expect(approveDecoded.functionName).toBe("approve");
    expect((approveDecoded.args?.[0] as string).toLowerCase()).toBe(entrypoint.toLowerCase());
    expect(approveDecoded.args?.[1]).toBe(amount);

    const depositDecoded = decodeFunctionData({
      abi: entrypointDepositErc20Abi,
      data: depositTx.data,
    });
    expect(depositDecoded.functionName).toBe("deposit");
    expect((depositDecoded.args?.[0] as string).toLowerCase()).toBe(asset.toLowerCase());
    expect(depositDecoded.args?.[1]).toBe(amount);
    expect(depositDecoded.args?.[2]).toBe(precommitment);
  });

  test("withdraw unsigned (direct) shape is stable and calldata decodes", () => {
    const proof = {
      pA: [1n, 2n] as [bigint, bigint],
      pB: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]],
      pC: [7n, 8n] as [bigint, bigint],
      pubSignals: [9n, 10n, 11n, 12n, 13n, 14n, 15n, 16n],
    };
    const payload = buildUnsignedDirectWithdrawOutput({
      chainId: 11155111,
      chainName: "sepolia",
      assetSymbol: "ETH",
      amount: 50000000000000000n,
      from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      poolAddress: "0x644d5A2554d36e27509254F32ccfeBe8cd58861f",
      recipient: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      selectedCommitmentLabel: 123n,
      selectedCommitmentValue: 100000000000000000n,
      withdrawal: {
        processooor: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        data: "0x",
      },
      proof,
    });

    expect(payload.mode).toBe("unsigned");
    expect(payload.withdrawMode).toBe("direct");
    expect(payload.transactions).toHaveLength(1);
    expect(payload.transactions[0].to).toBe("0x644d5A2554d36e27509254F32ccfeBe8cd58861f");

    const decoded = decodeFunctionData({
      abi: privacyPoolWithdrawAbi,
      data: payload.transactions[0].data,
    });
    expect(decoded.functionName).toBe("withdraw");
    expect((decoded.args?.[0] as { processooor: string }).processooor).toBe(
      "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A"
    );
    expect((decoded.args?.[1] as { pA: [bigint, bigint] }).pA[0]).toBe(1n);
  });

  test("withdraw unsigned (relayed) includes decodable relay calldata", () => {
    const proof = {
      pA: [11n, 12n] as [bigint, bigint],
      pB: [[13n, 14n], [15n, 16n]] as [[bigint, bigint], [bigint, bigint]],
      pC: [17n, 18n] as [bigint, bigint],
      pubSignals: [19n, 20n, 21n, 22n, 23n, 24n, 25n, 26n],
    };
    const scope = 13541713702858359530363969798588891965037210808099002426745892519913535247342n;
    const payload = buildUnsignedRelayedWithdrawOutput({
      chainId: 11155111,
      chainName: "sepolia",
      assetSymbol: "ETH",
      amount: 50000000000000000n,
      from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      entrypoint: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
      scope,
      recipient: "0x1111111111111111111111111111111111111111",
      selectedCommitmentLabel: 123n,
      selectedCommitmentValue: 100000000000000000n,
      feeBPS: "30",
      quoteExpiresAt: "2026-01-01T00:00:00.000Z",
      withdrawal: {
        processooor: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
        data: "0x1234",
      },
      proof,
      relayerRequest: { feeCommitment: { expiration: "123" } },
    });

    expect(payload.mode).toBe("unsigned");
    expect(payload.withdrawMode).toBe("relayed");
    expect(payload.relayerRequest).toEqual({ feeCommitment: { expiration: "123" } });

    const decoded = decodeFunctionData({
      abi: entrypointRelayAbi,
      data: payload.transactions[0].data,
    });
    expect(decoded.functionName).toBe("relay");
    expect(decoded.args?.[2]).toBe(scope);
  });

  test("ragequit unsigned shape is stable and calldata decodes", () => {
    const proof = {
      pA: [31n, 32n] as [bigint, bigint],
      pB: [[33n, 34n], [35n, 36n]] as [[bigint, bigint], [bigint, bigint]],
      pC: [37n, 38n] as [bigint, bigint],
      pubSignals: [39n, 40n, 41n, 42n],
    };
    const payload = buildUnsignedRagequitOutput({
      chainId: 11155111,
      chainName: "sepolia",
      assetSymbol: "ETH",
      amount: 100000000000000000n,
      from: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      poolAddress: "0x644d5A2554d36e27509254F32ccfeBe8cd58861f",
      selectedCommitmentLabel: 777n,
      selectedCommitmentValue: 100000000000000000n,
      proof,
    });

    expect(payload.mode).toBe("unsigned");
    expect(payload.operation).toBe("ragequit");

    const decoded = decodeFunctionData({
      abi: privacyPoolRagequitAbi,
      data: payload.transactions[0].data,
    });
    expect(decoded.functionName).toBe("ragequit");
    expect((decoded.args?.[0] as { pubSignals: bigint[] }).pubSignals.length).toBe(4);
  });
});
