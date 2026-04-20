import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { encodeAbiParameters, parseAbiParameters, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "../../src/config/chains.ts";
import {
  buildUnsignedDepositOutput,
  buildUnsignedDirectWithdrawOutput,
  buildUnsignedRelayedWithdrawOutput,
  buildUnsignedRagequitOutput,
} from "../../src/utils/unsigned-flows.ts";
import {
  toRagequitSolidityProof,
  toWithdrawSolidityProof,
} from "../../src/utils/unsigned.ts";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const chain = CHAINS.mainnet;
const multiRelayerChain = CHAINS.sepolia;
const ZERO_HEX = "0x";
const SIGNER_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const ALT_SIGNER_PRIVATE_KEY =
  "0x0000000000000000000000000000000000000000000000000000000000000002";
const signer = privateKeyToAccount(SIGNER_PRIVATE_KEY);
const altSigner = privateKeyToAccount(ALT_SIGNER_PRIVATE_KEY);
const tokenAddress =
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const recipientAddress =
  "0x2222222222222222222222222222222222222222" as Address;
const feeRecipientAddress =
  "0x3333333333333333333333333333333333333333" as Address;
const processooorAddress =
  "0x4444444444444444444444444444444444444444" as Address;

const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realRelayer = captureModuleExports(
  await import("../../src/services/relayer.ts"),
);

const publicClientRequestMock = mock(async () => "0x" + "ab".repeat(32) as Hex);
const publicClientWaitForReceiptMock = mock(async () => ({
  status: "success" as const,
  blockNumber: 100n,
}));
const getPublicClientMock = mock(() => ({
  request: publicClientRequestMock,
  waitForTransactionReceipt: publicClientWaitForReceiptMock,
}));
const submitRelayRequestMock = mock(async () => ({
  success: true,
  txHash: ("0x" + "cd".repeat(32)) as Hex,
  timestamp: Date.now(),
  requestId: "relay-1",
}));
const requestQuoteWithExtraGasFallbackMock = mock(async () => ({
  quote: {
    baseFeeBPS: "25",
    feeBPS: "50",
    gasPrice: "1",
    relayerUrl: "https://fastrelay.xyz",
    detail: {
      relayTxCost: { gas: "21000", eth: "1000" },
    },
  },
  extraGas: false,
  downgradedExtraGas: false,
}));

let broadcastEnvelope: typeof import("../../src/services/broadcast.ts").broadcastEnvelope;

function dummyWithdrawProofRaw() {
  return {
    proof: {
      pi_a: [1n, 2n],
      pi_b: [
        [3n, 4n],
        [5n, 6n],
      ],
      pi_c: [7n, 8n],
    },
    publicSignals: [9n, 10n, 11n, 12n, 13n, 14n, 15n, 16n],
  };
}

function dummyRagequitProofRaw() {
  return {
    proof: {
      pi_a: [1n, 2n],
      pi_b: [
        [3n, 4n],
        [5n, 6n],
      ],
      pi_c: [7n, 8n],
    },
    publicSignals: [9n, 10n, 11n, 12n],
  };
}

function buildRelayedWithdrawPreview(options: {
  chainConfig?: typeof chain;
  amount?: bigint;
  feeBPS?: string;
  baseFeeBPS?: string;
  quoteExpiresAt?: string;
  quotedAt?: string;
  extraGas?: boolean;
  relayerHost?: string;
} = {}) {
  const chainConfig = options.chainConfig ?? chain;
  const amount = options.amount ?? 1_000_000_000_000_000_000n;
  const feeBPS = options.feeBPS ?? "50";
  const baseFeeBPS = options.baseFeeBPS ?? "25";
  const quoteExpiresAt = options.quoteExpiresAt ?? new Date(Date.now() + 300_000).toISOString();
  const quotedAt = options.quotedAt ?? new Date(Date.now() - 30_000).toISOString();
  const extraGas = options.extraGas ?? false;
  const relayerHost = options.relayerHost ?? "fastrelay.xyz";
  const feeCommitmentExpiration = Date.parse(quoteExpiresAt);
  const withdrawProofRaw = dummyWithdrawProofRaw();
  const feeCommitment = {
    expiration: Number.isFinite(feeCommitmentExpiration)
      ? feeCommitmentExpiration
      : Date.now() + 300_000,
    withdrawalData: encodeAbiParameters(
      parseAbiParameters(
        "address recipient, address feeRecipient, uint256 relayFeeBPS",
      ),
      [recipientAddress, feeRecipientAddress, BigInt(feeBPS)],
    ),
    asset: tokenAddress,
    amount: amount.toString(),
    extraGas,
    signedRelayerCommitment: ("0x" + "12".repeat(65)) as Hex,
  };

  const preview = buildUnsignedRelayedWithdrawOutput({
    chainId: chainConfig.id,
    chainName: chainConfig.name,
    assetSymbol: "ETH",
    amount,
    from: signer.address,
    entrypoint: chainConfig.entrypoint,
    scope: 99n,
    recipient: recipientAddress,
    selectedCommitmentLabel: 11n,
    selectedCommitmentValue: 12n,
    feeBPS,
    quoteExpiresAt,
    quotedAt,
    baseFeeBPS,
    relayerHost,
    extraGas,
    withdrawal: {
      processooor: processooorAddress,
      data: feeCommitment.withdrawalData,
    },
    proof: toWithdrawSolidityProof(withdrawProofRaw),
    relayerRequest: {
      scope: "99",
      withdrawal: {
        processooor: processooorAddress,
        data: feeCommitment.withdrawalData,
      },
      proof: withdrawProofRaw.proof,
      publicSignals: withdrawProofRaw.publicSignals.map((value) =>
        value.toString()
      ),
      feeCommitment,
    },
  });

  return { preview, feeCommitment };
}

async function signPreviewTransaction(
  account: ReturnType<typeof privateKeyToAccount>,
  preview: {
    chainId: number;
    to: Address;
    value: string;
    data: Hex;
  },
  nonce: number,
): Promise<Hex> {
  return await account.signTransaction({
    chainId: preview.chainId,
    to: preview.to,
    value: BigInt(preview.value),
    data: preview.data,
    nonce,
    gas: 300_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    type: "eip1559",
  });
}

async function signLegacyPreviewTransaction(
  account: ReturnType<typeof privateKeyToAccount>,
  preview: {
    chainId: number;
    to: Address;
    value: string;
    data: Hex;
  },
  nonce: number,
): Promise<Hex> {
  return await account.signTransaction({
    chainId: preview.chainId,
    to: preview.to,
    value: BigInt(preview.value),
    data: preview.data,
    nonce,
    gas: 300_000n,
    gasPrice: 2_000_000_000n,
    type: "legacy",
  });
}

beforeAll(async () => {
  installModuleMocks([
    [
      "../../src/services/sdk.ts",
      () => ({
        ...realSdk,
        getPublicClient: getPublicClientMock,
      }),
    ],
    [
      "../../src/services/relayer.ts",
      () => ({
        ...realRelayer,
        requestQuoteWithExtraGasFallback: requestQuoteWithExtraGasFallbackMock,
        submitRelayRequest: submitRelayRequestMock,
      }),
    ],
  ]);

  ({ broadcastEnvelope } = await import("../../src/services/broadcast.ts?broadcast-service-tests"));
});

beforeEach(() => {
  publicClientRequestMock.mockClear();
  publicClientWaitForReceiptMock.mockClear();
  getPublicClientMock.mockClear();
  submitRelayRequestMock.mockClear();
  requestQuoteWithExtraGasFallbackMock.mockClear();
  publicClientRequestMock.mockImplementation(async () =>
    ("0x" + "ab".repeat(32)) as Hex
  );
  publicClientWaitForReceiptMock.mockImplementation(async () => ({
    status: "success" as const,
    blockNumber: 100n,
  }));
  submitRelayRequestMock.mockImplementation(async () => ({
    success: true,
    txHash: ("0x" + "cd".repeat(32)) as Hex,
    timestamp: Date.now(),
    requestId: "relay-1",
  }));
  requestQuoteWithExtraGasFallbackMock.mockImplementation(async () => ({
    quote: {
      baseFeeBPS: "25",
      feeBPS: "50",
      gasPrice: "1",
      relayerUrl: "https://fastrelay.xyz",
      detail: {
        relayTxCost: { gas: "21000", eth: "1000" },
      },
    },
    extraGas: false,
    downgradedExtraGas: false,
  }));
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  restoreModuleImplementations([
    ["../../src/services/sdk.ts", realSdk],
    ["../../src/services/relayer.ts", realRelayer],
  ]);
});

describe("broadcast service", () => {
  test("rejects bare raw transaction arrays", async () => {
    await expect(
      broadcastEnvelope([
        {
          to: chain.entrypoint,
          data: ZERO_HEX,
          value: "0",
          chainId: chain.id,
          from: null,
          description: "raw",
        },
      ]),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_REQUIRES_ENVELOPE",
    });
  });

  test("rejects malformed envelope roots, metadata, and chain overrides", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });

    await expect(broadcastEnvelope("not-json")).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        success: false,
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        mode: "broadcast",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        operation: "sync",
      } as unknown),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: [],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope(preview, { expectedChain: "sepolia" }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_CHAIN_OVERRIDE_MISMATCH",
    });
  });

  test("rejects malformed transaction payload fields and relayed quote summaries", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const tx = preview.transactions[0]!;
    const { from: _from, ...withoutFrom } = tx;

    await expect(
      broadcastEnvelope({
        ...preview,
        amount: "abc",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: [{ ...withoutFrom }],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: [{ ...tx, to: "not-an-address" }],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: [{ ...tx, data: "xyz" }],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });

    const { preview: relayedPreview } = buildRelayedWithdrawPreview();
    await expect(
      broadcastEnvelope({
        ...relayedPreview,
        quoteSummary: "not-an-object",
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...relayedPreview,
        quoteSummary: {
          ...relayedPreview.quoteSummary,
          extraGas: "yes",
        },
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...relayedPreview,
        withdrawMode: "sideways",
        relayerHost: "fastrelay.xyz",
      } as unknown),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
  });

  test("rejects signed transaction count mismatches", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: [signed, signed],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_SIGNED_TRANSACTION_COUNT_MISMATCH",
    });
  });

  test("rejects missing, malformed, and unparsable signed transactions", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });

    await expect(broadcastEnvelope(preview)).rejects.toMatchObject({
      code: "INPUT_BROADCAST_MISSING_SIGNED_TRANSACTIONS",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: ["nope"],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: ["0x1234"],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_SIGNED_TRANSACTION",
    });
  });

  test("rejects preview chain, target, and value mismatches against signed payloads", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: preview.transactions.map((transaction) => ({
          ...transaction,
          chainId: chain.id + 1,
        })),
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_CHAIN_MISMATCH",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: preview.transactions.map((transaction) => ({
          ...transaction,
          to: recipientAddress,
        })),
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: preview.transactions.map((transaction) => ({
          ...transaction,
          value: "2",
        })),
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
    });
  });

  test("rejects signed transaction calldata mismatches", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const tamperedPreview = {
      ...preview,
      transactions: preview.transactions.map((transaction) => ({
        ...transaction,
        data: "0xdeadbeef" as Hex,
      })),
    };
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    await expect(
      broadcastEnvelope({
        ...tamperedPreview,
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_SIGNED_TRANSACTION_MISMATCH",
    });
  });

  test("rejects recovered signer mismatches for constrained callers", async () => {
    const withdrawProofRaw = dummyWithdrawProofRaw();
    const preview = buildUnsignedDirectWithdrawOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: signer.address,
      poolAddress: chain.entrypoint,
      recipient: recipientAddress,
      selectedCommitmentLabel: 11n,
      selectedCommitmentValue: 12n,
      withdrawal: {
        processooor: processooorAddress,
        data: "0x1234" as Hex,
      },
      proof: toWithdrawSolidityProof(withdrawProofRaw),
    });
    const signed = await signPreviewTransaction(
      altSigner,
      preview.transactions[0]!,
      0,
    );

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_SIGNER_MISMATCH",
    });
  });

  test("rejects mixed-signer bundles", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "USDC",
      amount: 1_000_000n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: tokenAddress,
      precommitment: 42n,
      isNative: false,
    });
    const signedApproval = await signPreviewTransaction(
      signer,
      preview.transactions[0]!,
      0,
    );
    const signedDeposit = await signPreviewTransaction(
      altSigner,
      preview.transactions[1]!,
      1,
    );

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: [signedApproval, signedDeposit],
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_MIXED_SIGNERS",
    });
  });

  test("broadcasts ERC20 bundles sequentially and waits after each submission", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "USDC",
      amount: 1_000_000n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: tokenAddress,
      precommitment: 42n,
      isNative: false,
    });
    const signedApproval = await signPreviewTransaction(
      signer,
      preview.transactions[0]!,
      0,
    );
    const signedDeposit = await signPreviewTransaction(
      signer,
      preview.transactions[1]!,
      1,
    );
    const callOrder: string[] = [];
    publicClientRequestMock.mockImplementation(async ({ params }) => {
      const serialized = params[0] as Hex;
      callOrder.push(`send:${serialized}`);
      return serialized === signedApproval
        ? ("0x" + "11".repeat(32)) as Hex
        : ("0x" + "22".repeat(32)) as Hex;
    });
    publicClientWaitForReceiptMock.mockImplementation(async ({ hash }) => {
      callOrder.push(`wait:${hash}`);
      return {
        status: "success" as const,
        blockNumber:
          hash === ("0x" + "11".repeat(32))
            ? 101n
            : 102n,
      };
    });

    const result = await broadcastEnvelope({
      ...preview,
      success: true,
      signedTransactions: [signedApproval, signedDeposit],
    });

    expect(callOrder).toEqual([
      `send:${signedApproval}`,
      `wait:${"0x" + "11".repeat(32)}`,
      `send:${signedDeposit}`,
      `wait:${"0x" + "22".repeat(32)}`,
    ]);
    expect(result.broadcastMode).toBe("onchain");
    expect(result.sourceOperation).toBe("deposit");
    expect(result.submittedBy?.toLowerCase()).toBe(signer.address.toLowerCase());
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.description).toContain("Approve ERC-20");
    expect(result.transactions[1]?.description).toContain("Deposit USDC");
  });

  test("broadcasts direct withdraw envelopes", async () => {
    const withdrawProofRaw = dummyWithdrawProofRaw();
    const preview = buildUnsignedDirectWithdrawOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: signer.address,
      poolAddress: chain.entrypoint,
      recipient: recipientAddress,
      selectedCommitmentLabel: 11n,
      selectedCommitmentValue: 12n,
      withdrawal: {
        processooor: processooorAddress,
        data: "0x1234" as Hex,
      },
      proof: toWithdrawSolidityProof(withdrawProofRaw),
    });
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    const result = await broadcastEnvelope({
      ...preview,
      success: true,
      signedTransactions: [signed],
    });

    expect(result.broadcastMode).toBe("onchain");
    expect(result.sourceOperation).toBe("withdraw");
    expect(result.transactions).toHaveLength(1);
  });

  test("broadcasts ragequit envelopes", async () => {
    const preview = buildUnsignedRagequitOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: signer.address,
      poolAddress: chain.entrypoint,
      selectedCommitmentLabel: 21n,
      selectedCommitmentValue: 22n,
      proof: toRagequitSolidityProof(dummyRagequitProofRaw()),
    });
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    const result = await broadcastEnvelope({
      ...preview,
      success: true,
      signedTransactions: [signed],
    });

    expect(result.broadcastMode).toBe("onchain");
    expect(result.sourceOperation).toBe("ragequit");
    expect(result.transactions).toHaveLength(1);
  });

  test("supports legacy signed transactions and validate-only onchain broadcasts", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const signed = await signLegacyPreviewTransaction(
      signer,
      preview.transactions[0]!,
      0,
    );

    const result = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        signedTransactions: [signed],
      },
      { validateOnly: true },
    );

    expect(result.validatedOnly).toBe(true);
    expect(result.broadcastMode).toBe("onchain");
    expect(result.submittedBy?.toLowerCase()).toBe(signer.address.toLowerCase());
    expect(result.transactions).toEqual([
      expect.objectContaining({
        index: 0,
        txHash: null,
        status: "validated",
      }),
    ]);
  });

  test("returns submitted onchain transactions immediately when noWait is enabled", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    const result = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        signedTransactions: [signed],
      },
      { noWait: true },
    );

    expect(result.transactions).toEqual([
      expect.objectContaining({
        index: 0,
        txHash: expect.stringMatching(/^0x/),
        blockNumber: null,
        status: "submitted",
      }),
    ]);
    expect(publicClientWaitForReceiptMock).not.toHaveBeenCalled();
  });

  test("surfaces first-transaction submission failures and confirmed onchain reverts", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "ETH",
      amount: 1n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: chain.entrypoint,
      precommitment: 42n,
      isNative: true,
    });
    const signed = await signPreviewTransaction(signer, preview.transactions[0]!, 0);

    publicClientRequestMock.mockRejectedValueOnce(new Error("rpc offline"));
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "RPC_BROADCAST_SUBMISSION_FAILED",
      details: {
        failedAtIndex: 0,
        submittedTransactions: [],
      },
    });

    publicClientWaitForReceiptMock.mockResolvedValueOnce({
      status: "reverted" as const,
      blockNumber: 101n,
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: [signed],
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_BROADCAST_REVERTED",
      details: {
        failedAtIndex: 0,
        submittedTransactions: [
          expect.objectContaining({
            index: 0,
            status: "confirmed",
          }),
        ],
      },
    });
  });

  test("surfaces submitted transaction details on partial bundle failure", async () => {
    const preview = buildUnsignedDepositOutput({
      chainId: chain.id,
      chainName: chain.name,
      assetSymbol: "USDC",
      amount: 1_000_000n,
      from: null,
      entrypoint: chain.entrypoint,
      assetAddress: tokenAddress,
      precommitment: 42n,
      isNative: false,
    });
    const signedApproval = await signPreviewTransaction(
      signer,
      preview.transactions[0]!,
      0,
    );
    const signedDeposit = await signPreviewTransaction(
      signer,
      preview.transactions[1]!,
      1,
    );
    publicClientRequestMock
      .mockResolvedValueOnce(("0x" + "11".repeat(32)) as Hex)
      .mockResolvedValueOnce(("0x" + "22".repeat(32)) as Hex);
    publicClientWaitForReceiptMock
      .mockResolvedValueOnce({
        status: "success" as const,
        blockNumber: 101n,
      })
      .mockRejectedValueOnce(new Error("timed out"));

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        signedTransactions: [signedApproval, signedDeposit],
      }),
    ).rejects.toMatchObject({
      code: "RPC_BROADCAST_CONFIRMATION_TIMEOUT",
      details: {
        failedAtIndex: 1,
        submittedTransactions: [
          expect.objectContaining({
            index: 0,
            status: "confirmed",
          }),
          expect.objectContaining({
            index: 1,
            status: "submitted",
          }),
        ],
      },
    });
  });

  test("rejects expired relayed withdrawal quotes", async () => {
    const { preview } = buildRelayedWithdrawPreview({
      quoteExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "RELAYER_BROADCAST_QUOTE_EXPIRED",
    });
  });

  test("rejects relayer requests that do not match the preview calldata", async () => {
    const { preview } = buildRelayedWithdrawPreview();
    const mismatchedPreview = {
      ...preview,
      relayerRequest: {
        ...(preview.relayerRequest as Record<string, unknown>),
        scope: "100",
      },
    };

    await expect(
      broadcastEnvelope({
        ...mismatchedPreview,
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    });
  });

  test("rejects relayed envelopes without relayerHost when multiple relayers are configured", async () => {
    const { preview } = buildRelayedWithdrawPreview({
      chainConfig: multiRelayerChain,
    });

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_MISSING_RELAYER_HOST",
    });
  });

  test("accepts the default relayer host on single-relayer chains and rejects unknown hosts", async () => {
    const { preview } = buildRelayedWithdrawPreview();

    const noHostResult = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        relayerHost: null,
      },
      { noWait: true },
    );

    expect(submitRelayRequestMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        relayerUrl: "https://fastrelay.xyz",
      }),
    );
    expect(noHostResult.transactions[0]?.status).toBe("submitted");

    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        relayerHost: "unknown.example",
      }),
    ).rejects.toMatchObject({
      code: "RELAYER_BROADCAST_RELAYER_HOST_MISMATCH",
    });
  });

  test("validate-only relayed broadcast warns when the live quote changed", async () => {
    const { preview } = buildRelayedWithdrawPreview();
    requestQuoteWithExtraGasFallbackMock.mockResolvedValueOnce({
      quote: {
        baseFeeBPS: "30",
        feeBPS: "75",
        gasPrice: "1",
        relayerUrl: "https://fastrelay.xyz",
        detail: {
          relayTxCost: { gas: "21000", eth: "1000" },
        },
      },
      extraGas: false,
      downgradedExtraGas: false,
    });

    const result = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      },
      { validateOnly: true },
    );

    expect(result.validatedOnly).toBe(true);
    expect(result.warnings?.map((warning) => warning.code)).toContain("QUOTE_CHANGED");
    expect(result.warnings?.[0]?.message).toContain("Previous fee");
    expect(requestQuoteWithExtraGasFallbackMock).toHaveBeenCalledTimes(1);
  });

  test("validate-only relayed broadcast stays quiet when the live quote is unchanged", async () => {
    const { preview } = buildRelayedWithdrawPreview();

    const result = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      },
      { validateOnly: true },
    );

    expect(result.validatedOnly).toBe(true);
    expect(result.warnings).toBeUndefined();
    expect(requestQuoteWithExtraGasFallbackMock).toHaveBeenCalledTimes(1);
  });

  test("validate-only relayed broadcast warns when quoteSummary is missing", async () => {
    const { preview } = buildRelayedWithdrawPreview();
    const legacyPreview = { ...preview } as typeof preview & { quoteSummary?: unknown };
    delete legacyPreview.quoteSummary;

    const result = await broadcastEnvelope(
      {
        ...legacyPreview,
        success: true,
        relayerHost: "fastrelay.xyz",
      },
      { validateOnly: true },
    );

    expect(result.validatedOnly).toBe(true);
    expect(result.warnings?.map((warning) => warning.code)).toEqual([
      "QUOTE_DELTA_UNAVAILABLE",
    ]);
    expect(requestQuoteWithExtraGasFallbackMock).not.toHaveBeenCalled();
  });

  test("validate-only relayed broadcast warns when the live quote cannot be refreshed", async () => {
    const { preview } = buildRelayedWithdrawPreview();
    requestQuoteWithExtraGasFallbackMock.mockRejectedValueOnce(
      new Error("relayer temporarily unavailable"),
    );

    const result = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      },
      { validateOnly: true },
    );

    expect(result.validatedOnly).toBe(true);
    expect(result.warnings?.map((warning) => warning.code)).toEqual([
      "QUOTE_DELTA_UNAVAILABLE",
    ]);
  });

  test("rejects malformed relayed requests, malformed proofs, and preview mismatches", async () => {
    const { preview } = buildRelayedWithdrawPreview();

    await expect(
      broadcastEnvelope({
        ...preview,
        quoteExpiresAt: "tomorrow-ish",
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        relayerRequest: null,
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        relayerRequest: {
          ...(preview.relayerRequest as Record<string, unknown>),
          withdrawal: "nope",
        },
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        relayerRequest: {
          ...(preview.relayerRequest as Record<string, unknown>),
          feeCommitment: "nope",
        },
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        relayerRequest: {
          ...(preview.relayerRequest as Record<string, unknown>),
          publicSignals: "nope",
        },
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        relayerRequest: {
          ...(preview.relayerRequest as Record<string, unknown>),
          proof: { pi_a: ["bad"] },
        },
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_INVALID_ENVELOPE",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: preview.transactions.map((transaction) => ({
          ...transaction,
          to: tokenAddress,
        })),
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        transactions: preview.transactions.map((transaction) => ({
          ...transaction,
          value: "1",
        })),
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "INPUT_BROADCAST_RELAYER_REQUEST_MISMATCH",
    });
  });

  test("broadcasts relayed withdrawal envelopes without requiring local signer state", async () => {
    const { preview } = buildRelayedWithdrawPreview();
    publicClientWaitForReceiptMock.mockResolvedValueOnce({
      status: "success" as const,
      blockNumber: 222n,
    });

    const result = await broadcastEnvelope({
      ...preview,
      success: true,
      relayerHost: "fastrelay.xyz",
    });

    expect(submitRelayRequestMock).toHaveBeenCalledTimes(1);
    expect(submitRelayRequestMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        scope: 99n,
        relayerUrl: "https://fastrelay.xyz",
      }),
    );
    expect(result.broadcastMode).toBe("relayed");
    expect(result.sourceOperation).toBe("withdraw");
    expect(result.transactions[0]?.blockNumber).toBe("222");
  });

  test("wraps relayer submission failures and surfaces relayed no-wait/confirmation errors", async () => {
    const { preview } = buildRelayedWithdrawPreview();

    submitRelayRequestMock.mockRejectedValueOnce(new Error("relay backend offline"));
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "RELAYER_BROADCAST_SUBMISSION_FAILED",
    });

    submitRelayRequestMock.mockResolvedValueOnce({
      success: true,
      txHash: ("0x" + "ef".repeat(32)) as Hex,
      timestamp: Date.now(),
      requestId: "relay-timeout",
    });
    const noWaitResult = await broadcastEnvelope(
      {
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      },
      { noWait: true },
    );
    expect(noWaitResult.transactions[0]?.status).toBe("submitted");

    submitRelayRequestMock.mockResolvedValueOnce({
      success: true,
      txHash: ("0x" + "ee".repeat(32)) as Hex,
      timestamp: Date.now(),
      requestId: "relay-timeout-2",
    });
    publicClientWaitForReceiptMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "RPC_BROADCAST_CONFIRMATION_TIMEOUT",
      details: {
        failedAtIndex: 0,
      },
    });

    submitRelayRequestMock.mockResolvedValueOnce({
      success: true,
      txHash: ("0x" + "fe".repeat(32)) as Hex,
      timestamp: Date.now(),
      requestId: "relay-revert",
    });
    publicClientWaitForReceiptMock.mockResolvedValueOnce({
      status: "reverted" as const,
      blockNumber: 333n,
    });
    await expect(
      broadcastEnvelope({
        ...preview,
        success: true,
        relayerHost: "fastrelay.xyz",
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_BROADCAST_REVERTED",
      details: {
        failedAtIndex: 0,
      },
    });
  });
});
