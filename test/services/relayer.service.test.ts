import { afterEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  getRelayerDetails,
  requestQuote,
  submitRelayRequest,
} from "../../src/services/relayer.ts";

const chain = CHAINS.ethereum;
const originalFetch = globalThis.fetch;

describe("relayer service", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
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
              withdrawalData: "0x1234",
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
    // The withdraw command checks parsedFeeBPS > pool.maxRelayFeeBPS (withdraw.ts:726).
    expect(quote.feeBPS).toBe("99999");
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
              withdrawalData: "0x1234",
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
          withdrawalData: "0x1234",
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
          withdrawalData: "0x1234",
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
        withdrawalData: "0x1234",
        asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
    });

    expect(result.success).toBe(true);
    expect(result.txHash).toBe(validTxHash);
  });
});
