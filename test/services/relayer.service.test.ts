import { afterEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  decodeValidatedRelayerWithdrawalData,
  getRelayerDetails,
  overrideRelayerRetryWaitForTests,
  requestQuote,
  submitRelayRequest,
} from "../../src/services/relayer.ts";
import { encodeRelayerWithdrawalData } from "../helpers/relayer-withdrawal-data.ts";

const chain = CHAINS.mainnet;
const originalFetch = globalThis.fetch;
const VALID_WITHDRAWAL_DATA = encodeRelayerWithdrawalData({
  recipient: "0x0000000000000000000000000000000000000001",
  feeRecipient: "0x0000000000000000000000000000000000000002",
  relayFeeBPS: 12n,
});

describe("relayer service", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    overrideRelayerRetryWaitForTests();
    mock.restore();
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
