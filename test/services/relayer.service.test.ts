import { afterEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  decodeValidatedRelayerWithdrawalData,
  getRelayerDetails,
  isUnsupportedExtraGasRelayerError,
  overrideRelayerRetryWaitForTests,
  requestQuote,
  requestQuoteWithExtraGasFallback,
  submitRelayRequest,
} from "../../src/services/relayer.ts";
import { CLIError } from "../../src/utils/errors.ts";
import { encodeRelayerWithdrawalData } from "../helpers/relayer-withdrawal-data.ts";
import {
  createStrictStubRegistry,
  type StrictStubRegistry,
} from "../helpers/strict-stubs.ts";

const chain = CHAINS.mainnet;
const sepolia = CHAINS.sepolia;
const originalFetch = globalThis.fetch;
let strictFetchRegistry: StrictStubRegistry<
  [RequestInfo | URL, RequestInit | undefined],
  Promise<Response>
> | null = null;
const VALID_WITHDRAWAL_DATA = encodeRelayerWithdrawalData({
  recipient: "0x0000000000000000000000000000000000000001",
  feeRecipient: "0x0000000000000000000000000000000000000002",
  relayFeeBPS: 12n,
});

function installStrictFetch(
  name: string,
): StrictStubRegistry<
  [RequestInfo | URL, RequestInit | undefined],
  Promise<Response>
> {
  strictFetchRegistry = createStrictStubRegistry(name);
  globalThis.fetch = strictFetchRegistry.createStub() as typeof fetch;
  return strictFetchRegistry;
}

function buildRelayerDetailsResponse(params: {
  chainId?: number;
  feeBPS?: string;
  minWithdrawAmount?: string;
  feeReceiverAddress?: string;
  assetAddress?: string;
  maxGasPrice?: string;
} = {}) {
  return {
    chainId: params.chainId ?? 1,
    feeBPS: params.feeBPS ?? "12",
    minWithdrawAmount: params.minWithdrawAmount ?? "1000",
    feeReceiverAddress:
      params.feeReceiverAddress ?? "0x0000000000000000000000000000000000000001",
    assetAddress:
      params.assetAddress ?? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    maxGasPrice: params.maxGasPrice ?? "100",
  };
}

function buildRelayerQuoteResponse(params: {
  baseFeeBPS?: string;
  feeBPS?: string;
  gasPrice?: string;
  relayerUrl?: string;
  withdrawalData?: `0x${string}`;
  asset?: string;
  amount?: string;
  extraGas?: boolean;
  signedRelayerCommitment?: `0x${string}`;
  relayTxCost?: { gas: string; eth: string };
  extraGasFundAmount?: { gas: string; eth: string };
  extraGasTxCost?: { gas: string; eth: string };
} = {}) {
  return {
    baseFeeBPS: params.baseFeeBPS ?? "10",
    feeBPS: params.feeBPS ?? "12",
    gasPrice: params.gasPrice ?? "100",
    relayerUrl: params.relayerUrl,
    detail: {
      relayTxCost: params.relayTxCost ?? { gas: "1", eth: "1" },
      ...(params.extraGasFundAmount ? { extraGasFundAmount: params.extraGasFundAmount } : {}),
      ...(params.extraGasTxCost ? { extraGasTxCost: params.extraGasTxCost } : {}),
    },
    feeCommitment: {
      expiration: Date.now() + 60_000,
      withdrawalData: params.withdrawalData ?? VALID_WITHDRAWAL_DATA,
      asset: params.asset ?? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      amount: params.amount ?? "1000",
      extraGas: params.extraGas ?? false,
      signedRelayerCommitment: params.signedRelayerCommitment ?? "0x5678",
    },
  };
}

describe("relayer service", () => {
  afterEach(() => {
    try {
      strictFetchRegistry?.assertConsumed();
    } finally {
      strictFetchRegistry?.reset();
      strictFetchRegistry = null;
      globalThis.fetch = originalFetch;
      overrideRelayerRetryWaitForTests();
      mock.restore();
    }
  });

  test("requestQuote serializes bigint amount as string", async () => {
    let requestBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "12",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
            feeCommitment: {
              expiration: Date.now() + 60_000,
              withdrawalData: VALID_WITHDRAWAL_DATA,
              asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
              amount: "1000",
              extraGas: false,
              signedRelayerCommitment: "0x5678",
            },
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const quote = await requestQuote(chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
      recipient: "0x0000000000000000000000000000000000000001",
    });

    expect(quote.feeBPS).toBe("12");
    expect(requestBody?.amount).toBe("1000");
    expect(requestBody?.chainId).toBe(1);
  });

  test("requestQuote falls back to a secondary relayer host when the primary is unavailable", async () => {
    const fallbackChain = {
      ...chain,
      relayerHost: "https://primary-relayer.test",
      relayerHosts: [
        "https://primary-relayer.test",
        "https://backup-relayer.test",
      ],
    };
    const seenUrls: string[] = [];
    const fetchRegistry = installStrictFetch("relayer.failover-quote");
    fetchRegistry.expectCall(
      "primary-details",
      async (input) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "10" })),
          { status: 200 },
        );
      },
      {
        match: (input) =>
          String(input).startsWith("https://primary-relayer.test/relayer/details"),
      },
    );
    fetchRegistry.expectCall(
      "backup-details",
      async (input) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12" })),
          { status: 200 },
        );
      },
      {
        match: (input) =>
          String(input).startsWith("https://backup-relayer.test/relayer/details"),
      },
    );
    fetchRegistry.expectCall(
      "primary-quote-503",
      async (input) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(JSON.stringify({ message: "busy" }), { status: 503 });
      },
      {
        match: (input) =>
          String(input).startsWith("https://primary-relayer.test/relayer/quote"),
      },
    );
    fetchRegistry.expectCall(
      "backup-quote-200",
      async (input) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify(buildRelayerQuoteResponse({ relayerUrl: "https://backup-relayer.test" })),
          { status: 200 },
        );
      },
      {
        match: (input) =>
          String(input).startsWith("https://backup-relayer.test/relayer/quote"),
      },
    );

    const quote = await requestQuote(fallbackChain as typeof chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
    });

    expect(quote.feeBPS).toBe("12");
    expect(quote.relayerUrl).toBe("https://backup-relayer.test");
    expect(seenUrls[0]).toContain("primary-relayer.test/relayer/details");
    expect(seenUrls.some((url) => url.startsWith("https://backup-relayer.test"))).toBe(true);
  });

  test("getRelayerDetails falls back to a secondary relayer host when the primary is unavailable", async () => {
    const fallbackChain = {
      ...chain,
      relayerHost: "https://primary-relayer.test",
      relayerHosts: [
        "https://primary-relayer.test",
        "https://backup-relayer.test",
      ],
    };

    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith("https://primary-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "busy" }), { status: 503 }),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12" })),
            { status: 200 },
          ),
        );
      }

      throw new Error(`unexpected relayer URL ${url}`);
    }) as typeof fetch;

    const details = await getRelayerDetails(
      fallbackChain as typeof chain,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    );

    expect(details.feeBPS).toBe("12");
    expect(details.minWithdrawAmount).toBe("1000");
    expect(details.relayerUrl).toBe("https://backup-relayer.test");
  });

  test("getRelayerDetails skips invalid relayer candidates and trims duplicate hosts", async () => {
    const fallbackChain = {
      ...chain,
      relayerHost: "https://primary-relayer.test",
      relayerHosts: [
        " https://primary-relayer.test ",
        "https://primary-relayer.test",
        "https://backup-relayer.test  ",
      ],
    };
    const requestedUrls: string[] = [];

    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.startsWith("https://primary-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(JSON.stringify({ feeBPS: "10" }), { status: 200 }),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12" })),
            { status: 200 },
          ),
        );
      }

      throw new Error(`unexpected relayer URL ${url}`);
    }) as typeof fetch;

    const details = await getRelayerDetails(
      fallbackChain as typeof chain,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    );

    expect(details.relayerUrl).toBe("https://backup-relayer.test");
    expect(
      requestedUrls.filter((url) =>
        url.startsWith("https://primary-relayer.test/relayer/details"),
      ),
    ).toHaveLength(1);
  });

  test("requestQuote prefers the cheapest selectable relayer when multiple relayers are healthy", async () => {
    const preferredChain = {
      ...chain,
      relayerHost: "https://primary-relayer.test",
      relayerHosts: [
        "https://primary-relayer.test",
        "https://backup-relayer.test",
      ],
    };
    const seenUrls: string[] = [];

    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);

      if (url.startsWith("https://primary-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "30" })),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12" })),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/quote")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerQuoteResponse({ relayerUrl: "https://backup-relayer.test" })),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://primary-relayer.test/relayer/quote")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerQuoteResponse({ relayerUrl: "https://primary-relayer.test" })),
            { status: 200 },
          ),
        );
      }

      throw new Error(`unexpected relayer URL ${url}`);
    }) as typeof fetch;

    const quote = await requestQuote(preferredChain as typeof chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
      recipient: "0x0000000000000000000000000000000000000001",
    });

    expect(quote.feeBPS).toBe("12");
    expect(quote.relayerUrl).toBe("https://backup-relayer.test");
    expect(seenUrls[0]).toContain("primary-relayer.test/relayer/details");
    expect(seenUrls[1]).toContain("backup-relayer.test/relayer/details");
    expect(seenUrls).toContain("https://backup-relayer.test/relayer/quote");
    expect(seenUrls).not.toContain("https://primary-relayer.test/relayer/quote");
  });

  test("getRelayerDetails trims and deduplicates relayer hosts before querying", async () => {
    const weirdChain = {
      ...chain,
      relayerHost: " https://primary-relayer.test ",
      relayerHosts: [
        " https://primary-relayer.test ",
        "https://primary-relayer.test",
        "   ",
        "\thttps://backup-relayer.test\t",
      ],
    };
    const seenUrls: string[] = [];
    const fetchRegistry = installStrictFetch("relayer.trim-dedupe");
    fetchRegistry.expectCall(
      "primary-details",
      async (input) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "30" })),
          { status: 200 },
        );
      },
      {
        match: (input) =>
          String(input).startsWith("https://primary-relayer.test/relayer/details"),
      },
    );
    fetchRegistry.expectCall(
      "backup-details",
      async (input) => {
        const url = String(input);
        seenUrls.push(url);
        return new Response(
          JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12" })),
          { status: 200 },
        );
      },
      {
        match: (input) =>
          String(input).startsWith("https://backup-relayer.test/relayer/details"),
      },
    );

    const details = await getRelayerDetails(
      weirdChain as typeof chain,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    );

    expect(details.feeBPS).toBe("12");
    expect(details.relayerUrl).toBe("https://backup-relayer.test");
    expect(seenUrls).toEqual([
      "https://primary-relayer.test/relayer/details?chainId=1&assetAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      "https://backup-relayer.test/relayer/details?chainId=1&assetAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    ]);
  });

  test("decodeValidatedRelayerWithdrawalData rejects zero-address recipients", () => {
    const withdrawalData = encodeRelayerWithdrawalData({
      recipient: "0x0000000000000000000000000000000000000000",
      feeRecipient: "0x0000000000000000000000000000000000000002",
      relayFeeBPS: 12n,
    });

    expect(() => {
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData,
            asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            amount: "1000",
            extraGas: false,
            signedRelayerCommitment: "0x5678",
          },
        },
        requestedRecipient: "0x0000000000000000000000000000000000000000",
        quoteFeeBPS: 12n,
      });
    }).toThrow(expect.objectContaining({
      category: "RELAYER",
      message: expect.stringContaining("zero address"),
    }));
  });

  test("decodeValidatedRelayerWithdrawalData rejects zero-address fee recipients", () => {
    const withdrawalData = encodeRelayerWithdrawalData({
      recipient: "0x0000000000000000000000000000000000000001",
      feeRecipient: "0x0000000000000000000000000000000000000000",
      relayFeeBPS: 12n,
    });

    expect(() => {
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData,
            asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            amount: "1000",
            extraGas: false,
            signedRelayerCommitment: "0x5678",
          },
        },
        requestedRecipient: "0x0000000000000000000000000000000000000001",
        quoteFeeBPS: 12n,
      });
    }).toThrow(expect.objectContaining({
      category: "RELAYER",
      message: expect.stringContaining("fee recipient cannot be the zero address"),
    }));
  });

  test("decodeValidatedRelayerWithdrawalData returns the decoded fee data on success", () => {
    const decoded = decodeValidatedRelayerWithdrawalData({
      quote: {
        feeCommitment: {
          expiration: Date.now() + 60_000,
          withdrawalData: VALID_WITHDRAWAL_DATA,
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          amount: "1000",
          extraGas: false,
          signedRelayerCommitment: "0x5678",
        },
      },
      requestedRecipient: "0x0000000000000000000000000000000000000001",
      quoteFeeBPS: 12n,
    });

    expect(decoded).toEqual({
      recipient: "0x0000000000000000000000000000000000000001",
      feeRecipient: "0x0000000000000000000000000000000000000002",
      relayFeeBPS: 12n,
      withdrawalData: VALID_WITHDRAWAL_DATA,
    });
  });

  test("decodeValidatedRelayerWithdrawalData rejects missing fee commitments", () => {
    expect(() => {
      decodeValidatedRelayerWithdrawalData({
        quote: {},
        requestedRecipient: "0x0000000000000000000000000000000000000001",
        quoteFeeBPS: 12n,
      });
    }).toThrow(expect.objectContaining({
      category: "RELAYER",
      message: expect.stringContaining("missing required fee details"),
    }));
  });

  test("decodeValidatedRelayerWithdrawalData rejects recipient mismatches", () => {
    expect(() => {
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: VALID_WITHDRAWAL_DATA,
            asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            amount: "1000",
            extraGas: false,
            signedRelayerCommitment: "0x5678",
          },
        },
        requestedRecipient: "0x0000000000000000000000000000000000000009",
        quoteFeeBPS: 12n,
      });
    }).toThrow(expect.objectContaining({
      category: "RELAYER",
      message: expect.stringContaining("recipient does not match"),
    }));
  });

  test("decodeValidatedRelayerWithdrawalData rejects mismatched relay fee data", () => {
    expect(() => {
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: VALID_WITHDRAWAL_DATA,
            asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            amount: "1000",
            extraGas: false,
            signedRelayerCommitment: "0x5678",
          },
        },
        requestedRecipient: "0x0000000000000000000000000000000000000001",
        quoteFeeBPS: 13n,
      });
    }).toThrow(expect.objectContaining({
      category: "RELAYER",
      message: expect.stringContaining("quoted relay fee"),
    }));
  });

  test("submitRelayRequest uses the relayer url selected during quoting", async () => {
    const fallbackChain = {
      ...chain,
      relayerHost: "https://primary-relayer.test",
      relayerHosts: [
        "https://primary-relayer.test",
        "https://backup-relayer.test",
      ],
    };

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith("https://primary-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "10" })),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12" })),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://primary-relayer.test/relayer/quote")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "busy" }), { status: 503 }),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/quote")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              baseFeeBPS: "10",
              feeBPS: "12",
              gasPrice: "100",
              detail: { relayTxCost: { gas: "1", eth: "1" } },
              feeCommitment: {
                expiration: Date.now() + 60_000,
                withdrawalData: VALID_WITHDRAWAL_DATA,
                asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                amount: "1000",
                extraGas: false,
                signedRelayerCommitment: "0x5678",
              },
            }),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://backup-relayer.test/relayer/request")) {
        const body = JSON.parse(String(init?.body));
        expect(body.chainId).toBe(1);
        expect(url).toBe("https://backup-relayer.test/relayer/request");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              txHash:
                "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              timestamp: Date.now(),
              requestId: "request-1",
            }),
            { status: 200 },
          ),
        );
      }

      throw new Error(`unexpected relayer URL ${url}`);
    }) as typeof fetch;

    const quote = await requestQuote(fallbackChain as typeof chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
    });

    const result = await submitRelayRequest(fallbackChain as typeof chain, {
      scope: 1n,
      withdrawal: {
        processooor: "0x0000000000000000000000000000000000000001",
        data: "0x",
      },
      proof: {
        _pA: ["0", "0"],
        _pB: [["0", "0"], ["0", "0"]],
        _pC: ["0", "0"],
        _pubSignals: [],
      },
      publicSignals: [],
      feeCommitment: quote.feeCommitment,
      relayerUrl: quote.relayerUrl,
    });

    expect(result.txHash).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  test("getRelayerDetails maps HTTP 503 with friendly message", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ message: "busy" }), { status: 503 }))
    ) as typeof fetch;

    await expect(
      getRelayerDetails(chain, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE")
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("capacity"),
    });
  });

  test("requestQuote on sepolia fails over from the primary relayer to the backup relayer", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.startsWith("https://testnet-relayer.privacypools.com/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "10", chainId: sepolia.id })),
            {
              status: 200,
            },
          ),
        );
      }

      if (url.startsWith("https://fastrelay.xyz/relayer/details")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerDetailsResponse({ feeBPS: "12", chainId: sepolia.id })),
            { status: 200 },
          ),
        );
      }

      if (url.startsWith("https://testnet-relayer.privacypools.com/relayer/quote")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "busy" }), {
            status: 503,
            statusText: "Service Unavailable",
          }),
        );
      }

      if (url.startsWith("https://fastrelay.xyz/relayer/quote")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(buildRelayerQuoteResponse({ relayerUrl: "https://fastrelay.xyz" })),
            { status: 200 },
          ),
        );
      }

      throw new Error(`unexpected relayer URL: ${url}`);
    }) as typeof fetch;

    const quote = await requestQuote(sepolia, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
      recipient: "0x0000000000000000000000000000000000000001",
    });

    expect(quote.feeBPS).toBe("12");
    expect(quote.relayerUrl).toBe("https://fastrelay.xyz");
    expect(requestedUrls[0]).toContain("testnet-relayer.privacypools.com/relayer/details");
    expect(requestedUrls.some((url) => url.includes("fastrelay.xyz/relayer/quote"))).toBe(true);
  });

  test("getRelayerDetails retries retryable gateway failures before succeeding", async () => {
    overrideRelayerRetryWaitForTests(async () => {});

    let attempts = 0;
    globalThis.fetch = mock(() => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "bad gateway" }), {
            status: 502,
            statusText: "Bad Gateway",
          })
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            feeReceiverAddress: "0x0000000000000000000000000000000000000001",
            feeBPS: "12",
            minWithdrawAmount: "1000",
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const result = await getRelayerDetails(
      chain,
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    );

    expect(result.feeBPS).toBe("12");
    expect(attempts).toBe(3);
  });

  test("getRelayerDetails wraps exhausted transport retries as RELAYER errors", async () => {
    overrideRelayerRetryWaitForTests(async () => {});

    let attempts = 0;
    globalThis.fetch = mock(() => {
      attempts += 1;
      return Promise.reject(new TypeError("fetch failed"));
    }) as typeof fetch;

    await expect(
      getRelayerDetails(chain, "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE")
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("fetch failed"),
    });

    expect(attempts).toBe(3);
  });

  test("requestQuote accepts large feeBPS (bounds check is caller responsibility)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "99999",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    const quote = await requestQuote(chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
    });

    // Service layer validates format only — feeBPS "99999" is a valid numeric string.
    // The withdraw command is responsible for bounds-checking against pool.maxRelayFeeBPS.
    expect(quote.feeBPS).toBe("99999");
  });

  test("requestQuote honors an explicit relayerUrl without probing relayer details", async () => {
    const seenUrls: string[] = [];

    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);

      if (url === "https://explicit-relayer.test/relayer/quote") {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              buildRelayerQuoteResponse({
                relayerUrl: "https://explicit-relayer.test",
              }),
            ),
            { status: 200 },
          ),
        );
      }

      throw new Error(`unexpected relayer URL ${url}`);
    }) as typeof fetch;

    const quote = await requestQuote(chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
      relayerUrl: "https://explicit-relayer.test",
    });

    expect(quote.relayerUrl).toBe("https://explicit-relayer.test");
    expect(seenUrls).toEqual(["https://explicit-relayer.test/relayer/quote"]);
  });

  test("requestQuoteWithExtraGasFallback downgrades when the relayer rejects extra gas", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requestBodies.push(body);

      if (body.extraGas === true) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ message: "UNSUPPORTED_FEATURE: extra gas" }),
            { status: 400, statusText: "Bad Request" },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify(
            buildRelayerQuoteResponse({
              extraGas: false,
              relayerUrl: "https://relayer.privacypools.com",
            }),
          ),
          { status: 200 },
        ),
      );
    }) as typeof fetch;

    const result = await requestQuoteWithExtraGasFallback(chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: true,
    });

    expect(result.extraGas).toBe(false);
    expect(result.downgradedExtraGas).toBe(true);
    expect(requestBodies.map((body) => body.extraGas)).toEqual([true, false]);
  });

  test("requestQuoteWithExtraGasFallback rethrows non-extra-gas relayer errors", async () => {
    const relayerError = new CLIError(
      "Relayer request failed: capacity",
      "RELAYER",
      "Try again shortly.",
    );
    globalThis.fetch = mock(() => Promise.reject(relayerError)) as typeof fetch;

    await expect(
      requestQuoteWithExtraGasFallback(chain, {
        amount: 1000n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      }),
    ).rejects.toBe(relayerError);
  });

  test("isUnsupportedExtraGasRelayerError only matches relayer unsupported-feature responses", () => {
    expect(
      isUnsupportedExtraGasRelayerError(
        new CLIError(
          "Relayer request failed: UNSUPPORTED_FEATURE: extra gas",
          "RELAYER",
          "extra gas unavailable",
        ),
      ),
    ).toBe(true);
    expect(
      isUnsupportedExtraGasRelayerError(
        new CLIError("Relayer request failed.", "RELAYER", "Try again."),
      ),
    ).toBe(false);
    expect(
      isUnsupportedExtraGasRelayerError(new Error("UNSUPPORTED_FEATURE")),
    ).toBe(false);
  });

  test("requestQuote retries transport failures before succeeding", async () => {
    overrideRelayerRetryWaitForTests(async () => {});

    let attempts = 0;
    globalThis.fetch = mock(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(new TypeError("fetch failed"));
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "12",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const quote = await requestQuote(chain, {
      amount: 1000n,
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      extraGas: false,
    });

    expect(quote.feeBPS).toBe("12");
    expect(attempts).toBe(2);
  });

  test("requestQuote does not retry 503 capacity errors", async () => {
    overrideRelayerRetryWaitForTests(async () => {});

    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ message: "busy" }), { status: 503 }))
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      requestQuote(chain, {
        amount: 1000n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("capacity"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("requestQuote surfaces nested relayer error.message", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "No usable Uniswap V3 pool found",
            },
          }),
          { status: 400, statusText: "Bad Request" }
        )
      )
    ) as typeof fetch;

    await expect(
      requestQuote(chain, {
        amount: 10n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("No usable Uniswap V3 pool found"),
    });
  });

  test("requestQuote rejects malformed feeCommitment in 200 payload", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "12",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
            feeCommitment: {
              expiration: Date.now() + 60_000,
              withdrawalData: VALID_WITHDRAWAL_DATA,
              asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
              amount: "1000",
              extraGas: false,
              // signedRelayerCommitment intentionally missing
            },
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(
      requestQuote(chain, {
        amount: 1000n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("invalid fee commitment"),
    });
  });
  test("requestQuote rejects feeCommitment with mismatched asset", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "12",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
            feeCommitment: {
              expiration: Date.now() + 60_000,
              withdrawalData: VALID_WITHDRAWAL_DATA,
              asset: "0x0000000000000000000000000000000000000001",
              amount: "1000",
              extraGas: false,
              signedRelayerCommitment: "0x5678",
            },
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(
      requestQuote(chain, {
        amount: 1000n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("different asset"),
    });
  });

  test("requestQuote rejects feeCommitment with mismatched amount", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "12",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
            feeCommitment: {
              expiration: Date.now() + 60_000,
              withdrawalData: VALID_WITHDRAWAL_DATA,
              asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
              amount: "999",
              extraGas: false,
              signedRelayerCommitment: "0x5678",
            },
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(
      requestQuote(chain, {
        amount: 1000n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("different withdrawal amount"),
    });
  });

  test("requestQuote rejects feeCommitment with mismatched extraGas", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            baseFeeBPS: "10",
            feeBPS: "12",
            gasPrice: "100",
            detail: { relayTxCost: { gas: "1", eth: "1" } },
            feeCommitment: {
              expiration: Date.now() + 60_000,
              withdrawalData: VALID_WITHDRAWAL_DATA,
              asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
              amount: "1000",
              extraGas: true,
              signedRelayerCommitment: "0x5678",
            },
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(
      requestQuote(chain, {
        amount: 1000n,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        extraGas: false,
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("mismatched extra-gas"),
    });
  });

  test("submitRelayRequest rejects non-success payloads", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            requestId: "abc",
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000001",
          data: "0x",
        },
        proof: { _pA: ["0", "0"], _pB: [["0", "0"], ["0", "0"]], _pC: ["0", "0"], _pubSignals: [] },
        publicSignals: [],
        feeCommitment: {
          expiration: Date.now() + 60_000,
          withdrawalData: VALID_WITHDRAWAL_DATA,
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          amount: "1000",
          extraGas: false,
          signedRelayerCommitment: "0x5678",
        },
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("did not accept"),
    });
  });

  test("submitRelayRequest rejects invalid txHash in success payload", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            txHash: "0x1234",
            timestamp: Date.now(),
            requestId: "abc",
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000001",
          data: "0x",
        },
        proof: { _pA: ["0", "0"], _pB: [["0", "0"], ["0", "0"]], _pC: ["0", "0"], _pubSignals: [] },
        publicSignals: [],
        feeCommitment: {
          expiration: Date.now() + 60_000,
          withdrawalData: VALID_WITHDRAWAL_DATA,
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          amount: "1000",
          extraGas: false,
          signedRelayerCommitment: "0x5678",
        },
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("transaction hash"),
    });
  });

  test("submitRelayRequest returns txHash on valid success payload", async () => {
    const validTxHash =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            txHash: validTxHash,
            timestamp: Date.now(),
            requestId: "relay-123",
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    const result = await submitRelayRequest(chain, {
      scope: 1n,
      withdrawal: {
        processooor: "0x0000000000000000000000000000000000000001",
        data: "0x",
      },
      proof: { _pA: ["0", "0"], _pB: [["0", "0"], ["0", "0"]], _pC: ["0", "0"], _pubSignals: [] },
      publicSignals: [],
      feeCommitment: {
        expiration: Date.now() + 60_000,
        withdrawalData: VALID_WITHDRAWAL_DATA,
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
    });

    expect(result.success).toBe(true);
    expect(result.txHash).toBe(validTxHash);
  });

  test("submitRelayRequest wraps transient network failures as RELAYER errors", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError("fetch failed"))
    ) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000001",
          data: "0x",
        },
        proof: { _pA: ["0", "0"], _pB: [["0", "0"], ["0", "0"]], _pC: ["0", "0"], _pubSignals: [] },
        publicSignals: [],
        feeCommitment: {
          expiration: Date.now() + 60_000,
          withdrawalData: VALID_WITHDRAWAL_DATA,
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          amount: "1000",
          extraGas: false,
          signedRelayerCommitment: "0x5678",
        },
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("fetch failed"),
    });
  });

  test("submitRelayRequest remains single-shot on retryable gateway failures", async () => {
    overrideRelayerRetryWaitForTests(async () => {});

    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "bad gateway" }), {
          status: 502,
          statusText: "Bad Gateway",
        })
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000001",
          data: "0x",
        },
        proof: { _pA: ["0", "0"], _pB: [["0", "0"], ["0", "0"]], _pC: ["0", "0"], _pubSignals: [] },
        publicSignals: [],
        feeCommitment: {
          expiration: Date.now() + 60_000,
          withdrawalData: VALID_WITHDRAWAL_DATA,
          asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
          amount: "1000",
          extraGas: false,
          signedRelayerCommitment: "0x5678",
        },
      })
    ).rejects.toMatchObject({
      category: "RELAYER",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
