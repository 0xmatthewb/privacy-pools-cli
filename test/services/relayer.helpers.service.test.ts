import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
} from "viem";
import { CHAINS } from "../../src/config/chains.ts";
import {
  decodeValidatedRelayerWithdrawalData,
  fetchRelayerResponseWithFailover,
  fetchSelectableRelayerDetailsCandidates,
  getRelayerHosts,
  getRelayerDetails,
  isValidRelayerDetailsResponse,
  overrideRelayerRetryWaitForTests,
  relayerTransportError,
  relayerUnavailableError,
  requestQuote,
  requestQuoteWithExtraGasFallback,
  submitRelayRequest,
  shouldFailoverToNextRelayer,
  sortRelayerCandidates,
  validateRelayerQuoteResponse,
} from "../../src/services/relayer.ts";
import { CLIError } from "../../src/utils/errors.ts";

const originalFetch = globalThis.fetch;
const chain = CHAINS.mainnet;
const assetAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const relayerWithdrawalParams = parseAbiParameters(
  "address recipient, address feeRecipient, uint256 relayFeeBPS",
);

function buildDetails(overrides: Record<string, unknown> = {}) {
  return {
    chainId: chain.id,
    feeBPS: "12",
    minWithdrawAmount: "1000",
    feeReceiverAddress: "0x0000000000000000000000000000000000000001",
    assetAddress,
    maxGasPrice: "100",
    ...overrides,
  };
}

function buildQuoteBody(overrides: Record<string, unknown> = {}) {
  return {
    baseFeeBPS: "10",
    feeBPS: "12",
    gasPrice: "100",
    detail: {
      relayTxCost: { gas: "1", eth: "1" },
    },
    feeCommitment: {
      expiration: Date.now() + 60_000,
      withdrawalData: "0x1234",
      asset: assetAddress,
      amount: "1000",
      extraGas: false,
      signedRelayerCommitment: "0x5678",
    },
    ...overrides,
  };
}

function buildWithdrawalData(params: {
  recipient?: Address;
  feeRecipient?: Address;
  relayFeeBPS?: bigint;
}) {
  return encodeAbiParameters(relayerWithdrawalParams, [
    params.recipient ?? "0x0000000000000000000000000000000000000002",
    params.feeRecipient ?? "0x0000000000000000000000000000000000000003",
    params.relayFeeBPS ?? 12n,
  ]);
}

describe("relayer helper coverage", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    overrideRelayerRetryWaitForTests();
    mock.restore();
  });

  test("isValidRelayerDetailsResponse accepts canonical payloads and rejects malformed ones", () => {
    expect(isValidRelayerDetailsResponse(buildDetails())).toBe(true);
    expect(isValidRelayerDetailsResponse(null)).toBe(false);
    expect(
      isValidRelayerDetailsResponse(
        buildDetails({ feeReceiverAddress: "not-an-address" }),
      ),
    ).toBe(false);
    expect(
      isValidRelayerDetailsResponse(buildDetails({ maxGasPrice: "12.5" })),
    ).toBe(false);
  });

  test("sortRelayerCandidates prefers lower fees and then stable order", () => {
    const cheap = {
      relayerUrl: "https://cheap.example",
      details: buildDetails({ feeBPS: "10" }),
      feeBPS: 10n,
      order: 1,
    };
    const expensive = {
      relayerUrl: "https://expensive.example",
      details: buildDetails({ feeBPS: "12" }),
      feeBPS: 12n,
      order: 0,
    };
    const tiedEarlier = { ...cheap, relayerUrl: "https://early.example", order: 0 };

    expect(sortRelayerCandidates(cheap, expensive)).toBeLessThan(0);
    expect(sortRelayerCandidates(expensive, cheap)).toBeGreaterThan(0);
    expect(sortRelayerCandidates(cheap, tiedEarlier)).toBeGreaterThan(0);
  });

  test("getRelayerHosts trims blanks and deduplicates configured relayer hosts", () => {
    expect(
      getRelayerHosts({
        ...chain,
        relayerHost: "https://fallback.example",
        relayerHosts: [
          " https://primary.example ",
          "",
          "https://primary.example",
          "https://secondary.example",
        ],
      }),
    ).toEqual([
      "https://primary.example",
      "https://secondary.example",
    ]);
  });

  test("getRelayerHosts falls back to the primary relayer host", () => {
    expect(
      getRelayerHosts({
        ...chain,
        relayerHost: "https://primary-only.example",
        relayerHosts: [],
      }),
    ).toEqual(["https://primary-only.example"]);
  });

  test("shouldFailoverToNextRelayer matches retryable relayer capacity guidance only", () => {
    expect(
      shouldFailoverToNextRelayer(
        new CLIError(
          "Relayer: service at capacity.",
          "RELAYER",
          "The relayer is busy. Wait a moment and try again.",
        ),
      ),
    ).toBe(true);
    expect(
      shouldFailoverToNextRelayer(
        new CLIError("Recipient invalid.", "INPUT", "Fix the address."),
      ),
    ).toBe(false);
    expect(shouldFailoverToNextRelayer(new TypeError("fetch failed"))).toBe(true);
    expect(
      shouldFailoverToNextRelayer(
        new CLIError("Relayer quote rejected.", "RELAYER", "Fix the request."),
      ),
    ).toBe(false);
  });

  test("shouldFailoverToNextRelayer recognizes temporary relayer outages and rejects unrelated cli errors", () => {
    expect(
      shouldFailoverToNextRelayer(
        new CLIError(
          "Relayer temporarily down.",
          "RELAYER",
          "Temporary network connection issue.",
        ),
      ),
    ).toBe(true);
    expect(
      shouldFailoverToNextRelayer(
        new CLIError(
          "Relayer request failed.",
          "RELAYER",
          "Retry with another host.",
        ),
      ),
    ).toBe(true);
    expect(
      shouldFailoverToNextRelayer(
        new CLIError("Bad input", "INPUT", "Fix the request."),
      ),
    ).toBe(false);
  });

  test("relayerUnavailableError and relayerTransportError sanitize diagnostics", () => {
    expect(relayerUnavailableError("unknown error").message).toBe(
      "Relayer request failed.",
    );
    expect(relayerTransportError(new Error("socket hang up")).message).toContain(
      "socket hang up",
    );
    expect(relayerTransportError("opaque failure").message).toContain(
      "network error",
    );
  });

  test("validateRelayerQuoteResponse accepts canonical extra-gas cost details", () => {
    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          detail: {
            relayTxCost: { gas: "1", eth: "1" },
            extraGasFundAmount: { gas: "2", eth: "3" },
            extraGasTxCost: { gas: "4", eth: "5" },
          },
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: "0x1234",
            asset: assetAddress,
            amount: "1000",
            extraGas: true,
            signedRelayerCommitment: "0x5678",
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: true,
        },
      }),
    ).not.toThrow();
  });

  test("validateRelayerQuoteResponse rejects malformed extra-gas cost details", () => {
    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          detail: {
            relayTxCost: { gas: "1", eth: "1" },
            extraGasFundAmount: { gas: "oops", eth: "3" },
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned an unexpected quote response.");
  });

  test("validateRelayerQuoteResponse rejects malformed and mismatched fee commitments", () => {
    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: "0x1234",
            asset: assetAddress,
            amount: "1000",
            extraGas: false,
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned an invalid fee commitment.");

    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: "0x1234",
            asset: "0x0000000000000000000000000000000000000009",
            amount: "1000",
            extraGas: false,
            signedRelayerCommitment: "0x5678",
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned a fee commitment for a different asset.");

    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: "0x1234",
            asset: assetAddress,
            amount: "2000",
            extraGas: false,
            signedRelayerCommitment: "0x5678",
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned a fee commitment for a different withdrawal amount.");

    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          feeCommitment: {
            expiration: Date.now() + 60_000,
            withdrawalData: "0x1234",
            asset: assetAddress,
            amount: "1000",
            extraGas: true,
            signedRelayerCommitment: "0x5678",
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned a fee commitment with mismatched extra-gas setting.");
  });

  test("validateRelayerQuoteResponse rejects malformed fee commitment fields", () => {
    for (const malformedFeeCommitment of [
      {
        expiration: Number.POSITIVE_INFINITY,
        withdrawalData: "0x1234",
        asset: assetAddress,
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
      {
        expiration: Date.now() + 60_000,
        withdrawalData: "not-hex",
        asset: assetAddress,
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
      {
        expiration: Date.now() + 60_000,
        withdrawalData: "0x1234",
        asset: assetAddress,
        amount: "10.5",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
      {
        expiration: Date.now() + 60_000,
        withdrawalData: "0x1234",
        asset: assetAddress,
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "not-hex",
      },
    ]) {
      expect(() =>
        validateRelayerQuoteResponse({
          body: buildQuoteBody({
            feeCommitment: malformedFeeCommitment,
          }),
          request: {
            amount: 1000n,
            asset: assetAddress,
            extraGas: false,
          },
        }),
      ).toThrow("Relayer returned an invalid fee commitment.");
    }
  });

  test("validateRelayerQuoteResponse rejects malformed core quote payloads", () => {
    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          gasPrice: "oops",
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned an unexpected quote response.");

    expect(() =>
      validateRelayerQuoteResponse({
        body: buildQuoteBody({
          detail: {
            relayTxCost: { gas: "oops", eth: "1" },
          },
        }),
        request: {
          amount: 1000n,
          asset: assetAddress,
          extraGas: false,
        },
      }),
    ).toThrow("Relayer returned an unexpected quote response.");
  });

  test("getRelayerDetails uses the single configured relayer host when no fallback list is present", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("https://single-relayer.example/relayer/details");
      return Promise.resolve(
        new Response(JSON.stringify(buildDetails()), { status: 200 }),
      );
    }) as typeof fetch;

    const details = await getRelayerDetails(
      {
        ...chain,
        relayerHost: "https://single-relayer.example",
        relayerHosts: [],
      },
      assetAddress,
    );

    expect(details.relayerUrl).toBe("https://single-relayer.example");
  });

  test("fetchSelectableRelayerDetailsCandidates skips malformed candidates and returns the cheapest healthy relayers", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.includes("https://bad.example")) {
        return Promise.resolve(
          new Response(JSON.stringify({ feeBPS: "12" }), { status: 200 }),
        );
      }
      if (url.includes("https://wrong-chain.example")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildDetails({ chainId: chain.id + 1 })), {
            status: 200,
          }),
        );
      }
      if (url.includes("https://healthy-a.example")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildDetails({ feeBPS: "18" })), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(buildDetails({ feeBPS: "9" })), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    const candidates = await fetchSelectableRelayerDetailsCandidates(
      {
        ...chain,
        relayerHosts: [
          "https://bad.example",
          "https://wrong-chain.example",
          "https://healthy-a.example",
          "https://healthy-b.example",
        ],
      },
      assetAddress,
    );

    expect(candidates.map((candidate) => candidate.relayerUrl)).toEqual([
      "https://healthy-b.example",
      "https://healthy-a.example",
    ]);
    expect(seenUrls).toHaveLength(4);
  });

  test("fetchSelectableRelayerDetailsCandidates skips relayers that answer for the wrong asset", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("https://wrong-asset.example")) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              buildDetails({
                assetAddress:
                  "0x0000000000000000000000000000000000000009",
              }),
            ),
            { status: 200 },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify(buildDetails({ feeBPS: "7" })), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    const candidates = await fetchSelectableRelayerDetailsCandidates(
      {
        ...chain,
        relayerHosts: [
          "https://wrong-asset.example",
          "https://healthy.example",
        ],
      },
      assetAddress,
    );

    expect(candidates.map((candidate) => candidate.relayerUrl)).toEqual([
      "https://healthy.example",
    ]);
  });

  test("fetchSelectableRelayerDetailsCandidates stops on non-failover errors", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "recipient invalid" }), {
          status: 400,
          statusText: "Bad Request",
        }),
      )
    ) as typeof fetch;

    await expect(
      fetchSelectableRelayerDetailsCandidates(
        {
          ...chain,
          relayerHosts: [
            "https://first.example",
            "https://second.example",
          ],
        },
        assetAddress,
      ),
    ).rejects.toThrow("recipient invalid");
  });

  test("fetchSelectableRelayerDetailsCandidates rethrows the last retryable error when every relayer fails", async () => {
    overrideRelayerRetryWaitForTests(async () => undefined);
    globalThis.fetch = mock((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "gateway timeout" }), {
          status: 504,
          statusText: "Gateway Timeout",
        }),
      ),
    ) as typeof fetch;

    await expect(
      fetchSelectableRelayerDetailsCandidates(
        {
          ...chain,
          relayerHosts: [
            "https://busy-a.example",
            "https://busy-b.example",
          ],
        },
        assetAddress,
      ),
    ).rejects.toThrow("Relayer request failed");
  });

  test("fetchRelayerResponseWithFailover retries across relayers and preserves the last retryable failure", async () => {
    overrideRelayerRetryWaitForTests(async () => undefined);
    globalThis.fetch = mock((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "gateway timeout" }), {
          status: 504,
          statusText: "Gateway Timeout",
        }),
      )
    ) as typeof fetch;

    await expect(
      fetchRelayerResponseWithFailover(
        {
          ...chain,
          relayerHosts: [
            "https://first.example",
            "https://second.example",
          ],
        },
        "/relayer/details?chainId=1&assetAddress=0x1",
      ),
    ).rejects.toThrow("Relayer request failed: Gateway Timeout");
  });

  test("fetchRelayerResponseWithFailover stops immediately on non-failover relayer errors", async () => {
    overrideRelayerRetryWaitForTests(async () => undefined);
    globalThis.fetch = mock((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "unsupported recipient" }), {
          status: 400,
          statusText: "Bad Request",
        }),
      )
    ) as typeof fetch;

    await expect(
      fetchRelayerResponseWithFailover(
        {
          ...chain,
          relayerHosts: [
            "https://first.example",
            "https://second.example",
          ],
        },
        "/relayer/quote",
      ),
    ).rejects.toThrow("Relayer request failed: unsupported recipient");
  });

  test("fetchRelayerResponseWithFailover returns the first healthy fallback relayer", async () => {
    overrideRelayerRetryWaitForTests(async () => undefined);
    const seenUrls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.includes("https://first.example")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "gateway timeout" }), {
            status: 504,
            statusText: "Gateway Timeout",
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify(buildDetails()), { status: 200 }),
      );
    }) as typeof fetch;

    const result = await fetchRelayerResponseWithFailover(
      {
        ...chain,
        relayerHosts: [
          "https://first.example",
          "https://second.example",
        ],
      },
      "/relayer/details?chainId=1&assetAddress=0x1",
    );

    expect(result.relayerUrl).toBe("https://second.example");
    expect(await result.response.json()).toMatchObject(buildDetails());
    expect(seenUrls).toEqual([
      "https://first.example/relayer/details?chainId=1&assetAddress=0x1",
      "https://first.example/relayer/details?chainId=1&assetAddress=0x1",
      "https://first.example/relayer/details?chainId=1&assetAddress=0x1",
      "https://second.example/relayer/details?chainId=1&assetAddress=0x1",
    ]);
  });

  test("requestQuote honors an explicit relayerUrl without probing relayer details first", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seenUrls.push(url);
      expect(init?.method).toBe("POST");
      return Promise.resolve(
        new Response(JSON.stringify(buildQuoteBody()), { status: 200 }),
      );
    }) as typeof fetch;

    const quote = await requestQuote(chain, {
      amount: 1000n,
      asset: assetAddress,
      extraGas: false,
      relayerUrl: "https://quote-only.example",
    });

    expect(quote.relayerUrl).toBe("https://quote-only.example");
    expect(seenUrls).toEqual(["https://quote-only.example/relayer/quote"]);
  });

  test("requestQuote posts the requested recipient for single-host relayers", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Promise.resolve(
        new Response(JSON.stringify(buildQuoteBody()), { status: 200 }),
      );
    }) as typeof fetch;

    const quote = await requestQuote(
      {
        ...chain,
        relayerHost: "https://single.example",
        relayerHosts: [],
      },
      {
        amount: 1000n,
        asset: assetAddress,
        extraGas: false,
        recipient: "0x0000000000000000000000000000000000000004",
      },
    );

    expect(quote.relayerUrl).toBe("https://single.example");
    expect(requestBody).toMatchObject({
      recipient: "0x0000000000000000000000000000000000000004",
    });
  });

  test("getRelayerDetails uses the cheapest healthy relayer when multiple hosts are configured", async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("https://a.example")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildDetails({ feeBPS: "25" })), {
            status: 200,
          }),
        );
      }
      if (url.includes("https://b.example")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildDetails({ feeBPS: "9" })), {
            status: 200,
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify(buildDetails({ feeBPS: "12" })), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    const details = await getRelayerDetails(
      {
        ...chain,
        relayerHosts: [
          "https://a.example",
          "https://b.example",
          "https://c.example",
        ],
      },
      assetAddress,
    );

    expect(details.relayerUrl).toBe("https://b.example");
    expect(details.feeBPS).toBe("9");
  });

  test("requestQuoteWithExtraGasFallback downgrades unsupported extra gas once and rethrows unrelated errors", async () => {
    const requestBodies: Array<{ extraGas?: boolean }> = [];
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        extraGas?: boolean;
      };
      requestBodies.push(body);
      if (requestBodies.length === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
            }),
            { status: 400, statusText: "Bad Request" },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(buildQuoteBody()), { status: 200 }),
      );
    }) as typeof fetch;

    const downgraded = await requestQuoteWithExtraGasFallback(chain, {
      amount: 1000n,
      asset: assetAddress,
      extraGas: true,
      relayerUrl: "https://single-relayer.example",
    });

    expect(downgraded.extraGas).toBe(false);
    expect(downgraded.downgradedExtraGas).toBe(true);
    expect(requestBodies).toEqual([
      expect.objectContaining({ extraGas: true }),
      expect.objectContaining({ extraGas: false }),
    ]);

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "recipient invalid" }), {
          status: 400,
          statusText: "Bad Request",
        }),
      ),
    ) as typeof fetch;

    await expect(
      requestQuoteWithExtraGasFallback(chain, {
        amount: 1000n,
        asset: assetAddress,
        extraGas: true,
        relayerUrl: "https://single-relayer.example",
      }),
    ).rejects.toThrow("recipient invalid");
  });

  test("requestQuoteWithExtraGasFallback does not retry when extra gas is already disabled", async () => {
    let calls = 0;
    globalThis.fetch = mock(() => {
      calls += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            message: "Relayer returned UNSUPPORTED_FEATURE for extra gas.",
          }),
          { status: 400, statusText: "Bad Request" },
        ),
      );
    }) as typeof fetch;

    await expect(
      requestQuoteWithExtraGasFallback(chain, {
        amount: 1000n,
        asset: assetAddress,
        extraGas: false,
        relayerUrl: "https://single-relayer.example",
      }),
    ).rejects.toThrow("UNSUPPORTED_FEATURE");

    expect(calls).toBe(1);
  });

  test("requestQuoteWithExtraGasFallback keeps extra gas enabled when the first quote succeeds", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            buildQuoteBody({
              feeCommitment: {
                expiration: Date.now() + 60_000,
                withdrawalData: "0x1234",
                asset: assetAddress,
                amount: "1000",
                extraGas: true,
                signedRelayerCommitment: "0x5678",
              },
            }),
          ),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    const result = await requestQuoteWithExtraGasFallback(chain, {
      amount: 1000n,
      asset: assetAddress,
      extraGas: true,
      relayerUrl: "https://single-relayer.example",
    });

    expect(result.extraGas).toBe(true);
    expect(result.downgradedExtraGas).toBe(false);
  });

  test("requestQuote fails over from an expensive relayer to a cheaper healthy relayer", async () => {
    const seenUrls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      seenUrls.push(url);
      if (url.includes("https://details-b.example/relayer/quote")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildQuoteBody()), { status: 200 }),
        );
      }
      if (url.includes("https://details-a.example/relayer/quote")) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: "service at capacity" }), {
            status: 503,
            statusText: "Service Unavailable",
          }),
        );
      }
      if (url.includes("https://details-a.example")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildDetails({ feeBPS: "25" })), {
            status: 200,
          }),
        );
      }
      if (url.includes("https://details-b.example")) {
        return Promise.resolve(
          new Response(JSON.stringify(buildDetails({ feeBPS: "10" })), {
            status: 200,
          }),
        );
      }
      throw new Error(`Unexpected relayer url: ${url}`);
    }) as typeof fetch;

    const quote = await requestQuote(
      {
        ...chain,
        relayerHosts: [
          "https://details-a.example",
          "https://details-b.example",
        ],
      },
      {
        amount: 1000n,
        asset: assetAddress,
        extraGas: false,
      },
    );

    expect(quote.relayerUrl).toBe("https://details-b.example");
    expect(seenUrls).not.toContain("https://details-a.example/relayer/quote");
    expect(seenUrls).toContain("https://details-b.example/relayer/quote");
  });

  test("decodeValidatedRelayerWithdrawalData validates the signed recipient, fee recipient, and fee bps", () => {
    const requestedRecipient =
      "0x0000000000000000000000000000000000000002" as Address;
    const feeRecipient =
      "0x0000000000000000000000000000000000000003" as Address;

    expect(
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            withdrawalData: buildWithdrawalData({
              recipient: requestedRecipient,
              feeRecipient,
              relayFeeBPS: 12n,
            }),
          },
        },
        requestedRecipient,
        quoteFeeBPS: 12n,
      }),
    ).toEqual({
      recipient: requestedRecipient,
      feeRecipient,
      relayFeeBPS: 12n,
      withdrawalData: buildWithdrawalData({
        recipient: requestedRecipient,
        feeRecipient,
        relayFeeBPS: 12n,
      }),
    });

    expect(() =>
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            withdrawalData: buildWithdrawalData({
              recipient:
                "0x0000000000000000000000000000000000000004" as Address,
            }),
          },
        },
        requestedRecipient,
        quoteFeeBPS: 12n,
      }),
    ).toThrow("recipient does not match");

    expect(() =>
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            withdrawalData: buildWithdrawalData({
              recipient: requestedRecipient,
              relayFeeBPS: 15n,
            }),
          },
        },
        requestedRecipient,
        quoteFeeBPS: 12n,
      }),
    ).toThrow("fee data does not match");

    expect(() =>
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            withdrawalData: buildWithdrawalData({
              recipient:
                "0x0000000000000000000000000000000000000000" as Address,
            }),
          },
        },
        requestedRecipient:
          "0x0000000000000000000000000000000000000000" as Address,
        quoteFeeBPS: 12n,
      }),
    ).toThrow("recipient cannot be the zero address");

    expect(() =>
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            withdrawalData: buildWithdrawalData({
              recipient: requestedRecipient,
              feeRecipient:
                "0x0000000000000000000000000000000000000000" as Address,
            }),
          },
        },
        requestedRecipient,
        quoteFeeBPS: 12n,
      }),
    ).toThrow("fee recipient cannot be the zero address");
  });

  test("decodeValidatedRelayerWithdrawalData rejects malformed withdrawal data payloads", () => {
    expect(() =>
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: {
            withdrawalData: "0x1234",
          },
        },
        requestedRecipient:
          "0x0000000000000000000000000000000000000002",
        quoteFeeBPS: 12n,
      }),
    ).toThrow("Relayer returned malformed withdrawal data.");
  });

  test("decodeValidatedRelayerWithdrawalData rejects missing fee commitments", () => {
    expect(() =>
      decodeValidatedRelayerWithdrawalData({
        quote: {
          feeCommitment: undefined,
        },
        requestedRecipient:
          "0x0000000000000000000000000000000000000002",
        quoteFeeBPS: 12n,
      }),
    ).toThrow("missing required fee details");
  });

  test("submitRelayRequest accepts valid tx hashes and rejects incomplete relayer responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            txHash: "0x" + "44".repeat(32),
          }),
          { status: 200 },
        ),
      ),
    ) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000005",
          data: "0x1234",
        },
        proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
        publicSignals: ["9", "10"],
        feeCommitment: buildQuoteBody().feeCommitment as never,
      }),
    ).resolves.toEqual({
      success: true,
      txHash: "0x" + "44".repeat(32),
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, txHash: "0x1234" }), {
          status: 200,
        }),
      ),
    ) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000005",
          data: "0x1234",
        },
        proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
        publicSignals: ["9", "10"],
        feeCommitment: buildQuoteBody().feeCommitment as never,
      }),
    ).rejects.toThrow("missing a valid transaction hash");
  });

  test("submitRelayRequest wraps transient transport failures and rejects non-success payloads", async () => {
    globalThis.fetch = mock(() => Promise.reject(new TypeError("fetch failed"))) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000005",
          data: "0x1234",
        },
        proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
        publicSignals: ["9", "10"],
        feeCommitment: buildQuoteBody().feeCommitment as never,
      }),
    ).rejects.toThrow("Relayer request failed");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false }), { status: 200 }),
      ),
    ) as typeof fetch;

    await expect(
      submitRelayRequest(chain, {
        scope: 1n,
        withdrawal: {
          processooor: "0x0000000000000000000000000000000000000005",
          data: "0x1234",
        },
        proof: { pi_a: ["1", "2"], pi_b: [["3", "4"], ["5", "6"]], pi_c: ["7", "8"] },
        publicSignals: ["9", "10"],
        feeCommitment: buildQuoteBody().feeCommitment as never,
      }),
    ).rejects.toThrow("did not accept the withdrawal request");
  });
});
