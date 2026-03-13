/**
 * Resilience tests — HTTP failure modes for ASP and Relayer services.
 *
 * Existing service tests cover happy paths and a few status codes.
 * This file systematically tests what happens when external services:
 *   - Time out or are unreachable
 *   - Return malformed / empty / unparseable responses
 *   - Return unexpected status codes
 *   - Return 200 with invalid payloads
 *
 * Note: classifyError tests live in test/unit/errors-extended.unit.test.ts
 * and test/fuzz/error-classification.fuzz.test.ts.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  checkLiveness,
  fetchApprovedLabels,
  fetchGlobalEvents,
  fetchGlobalStatistics,
  fetchMerkleLeaves,
  fetchMerkleRoots,
  fetchPoolEvents,
  fetchPoolsStats,
  fetchPoolStatistics,
  overrideAspRetryWaitForTests,
} from "../../src/services/asp.ts";
import {
  getRelayerDetails,
  overrideRelayerRetryWaitForTests,
  requestQuote,
  submitRelayRequest,
} from "../../src/services/relayer.ts";
import { CLIError } from "../../src/utils/errors.ts";

const chain = CHAINS.mainnet;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  overrideAspRetryWaitForTests(async () => {});
  overrideRelayerRetryWaitForTests(async () => {});
});

afterEach(() => {
  overrideAspRetryWaitForTests();
  overrideRelayerRetryWaitForTests();
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const VALID_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
const VALID_TX_HASH =
  "0x" + "ab".repeat(32) as `0x${string}`;

function mockResponse(body: unknown, status = 200): typeof fetch {
  return mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))
  ) as typeof fetch;
}

function mockText(text: string, status = 200): typeof fetch {
  return mock(() =>
    Promise.resolve(new Response(text, { status }))
  ) as typeof fetch;
}

function mockNetworkError(message: string): typeof fetch {
  return mock(() => Promise.reject(new Error(message))) as typeof fetch;
}

/** Minimal valid relayer submitRelayRequest params. */
const RELAY_PARAMS = {
  scope: 1n,
  withdrawal: {
    processooor: "0x0000000000000000000000000000000000000001" as const,
    data: "0x" as const,
  },
  proof: {
    _pA: ["0", "0"],
    _pB: [["0", "0"], ["0", "0"]],
    _pC: ["0", "0"],
    _pubSignals: [],
  },
  publicSignals: [] as string[],
  feeCommitment: {
    expiration: Date.now() + 60_000,
    withdrawalData: "0x1234" as `0x${string}`,
    asset: VALID_ADDRESS,
    amount: "1000",
    extraGas: false as boolean,
    signedRelayerCommitment: "0x5678" as `0x${string}`,
  },
};

const QUOTE_PARAMS = {
  amount: 1000n,
  asset: VALID_ADDRESS,
  extraGas: false,
};

/* ------------------------------------------------------------------ */
/*  ASP — Network failures                                            */
/* ------------------------------------------------------------------ */

describe("resilience: ASP network failures", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  // NOTE: ASP service functions do NOT wrap raw fetch rejections in CLIError.
  // The classifyError utility handles that at the command handler level.
  // These tests verify the raw errors propagate with correct messages.

  test("fetchMerkleRoots rejects on network error", async () => {
    globalThis.fetch = mockNetworkError("fetch failed");
    await expect(fetchMerkleRoots(chain, 1n)).rejects.toThrow("fetch failed");
  });

  test("fetchMerkleLeaves rejects on ECONNREFUSED", async () => {
    globalThis.fetch = mockNetworkError("ECONNREFUSED");
    await expect(fetchMerkleLeaves(chain, 1n)).rejects.toThrow("ECONNREFUSED");
  });

  test("fetchPoolEvents rejects on timeout", async () => {
    globalThis.fetch = mockNetworkError("The operation was aborted");
    await expect(fetchPoolEvents(chain, 1n, 1, 10)).rejects.toThrow("aborted");
  });

  test("fetchGlobalEvents rejects on network error", async () => {
    globalThis.fetch = mockNetworkError("network down");
    await expect(fetchGlobalEvents(chain, 1, 10)).rejects.toThrow("network down");
  });

  test("fetchPoolsStats rejects on network error", async () => {
    globalThis.fetch = mockNetworkError("fetch failed");
    await expect(fetchPoolsStats(chain)).rejects.toThrow("fetch failed");
  });

  test("fetchPoolStatistics rejects on network error", async () => {
    globalThis.fetch = mockNetworkError("ECONNREFUSED");
    await expect(fetchPoolStatistics(chain, 1n)).rejects.toThrow("ECONNREFUSED");
  });

  test("fetchGlobalStatistics rejects on network error", async () => {
    globalThis.fetch = mockNetworkError("timeout");
    await expect(fetchGlobalStatistics(chain)).rejects.toThrow("timeout");
  });

  test("fetchApprovedLabels degrades to null on network error", async () => {
    globalThis.fetch = mockNetworkError("ECONNREFUSED");
    await expect(fetchApprovedLabels(chain, 1n)).resolves.toBeNull();
  });

  test("checkLiveness returns false on timeout", async () => {
    globalThis.fetch = mockNetworkError("The operation was aborted");
    await expect(checkLiveness(chain)).resolves.toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  ASP — Malformed responses (200 with bad body)                     */
/* ------------------------------------------------------------------ */

describe("resilience: ASP malformed responses", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  // NOTE: res.json() on non-JSON bodies throws SyntaxError, not CLIError.
  // The classifyError utility handles wrapping at the command handler level.

  test("fetchMerkleRoots rejects on non-JSON 200 response", async () => {
    globalThis.fetch = mockText("this is not json");
    await expect(fetchMerkleRoots(chain, 1n)).rejects.toThrow();
  });

  test("fetchMerkleLeaves rejects on empty 200 response", async () => {
    globalThis.fetch = mockText("");
    await expect(fetchMerkleLeaves(chain, 1n)).rejects.toThrow();
  });

  test("fetchMerkleRoots rejects on HTML error page", async () => {
    globalThis.fetch = mockText("<html><body>502 Bad Gateway</body></html>");
    await expect(fetchMerkleRoots(chain, 1n)).rejects.toThrow();
  });

  test("fetchApprovedLabels degrades to null on non-JSON response", async () => {
    globalThis.fetch = mockText("server error");
    await expect(fetchApprovedLabels(chain, 1n)).resolves.toBeNull();
  });

  test("fetchApprovedLabels returns empty Set on empty aspLeaves", async () => {
    globalThis.fetch = mockResponse({ aspLeaves: [], stateTreeLeaves: [] });
    await expect(fetchApprovedLabels(chain, 1n)).resolves.toEqual(new Set());
  });

  test("checkLiveness returns false on non-JSON body", async () => {
    globalThis.fetch = mockText("OK");
    await expect(checkLiveness(chain)).resolves.toBe(false);
  });

  test("checkLiveness returns false on missing status field", async () => {
    globalThis.fetch = mockResponse({});
    await expect(checkLiveness(chain)).resolves.toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  ASP — Status codes not already covered by asp.service.test.ts     */
/* ------------------------------------------------------------------ */

describe("resilience: ASP uncommon HTTP status codes", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("maps 403 to rate-limit error", async () => {
    globalThis.fetch = mockResponse({}, 403);
    await expect(fetchMerkleRoots(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("Wait a moment"),
    });
  });

  test("maps 502 to generic ASP error", async () => {
    globalThis.fetch = mockResponse({}, 502);
    await expect(fetchMerkleRoots(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("network connection"),
      retryable: true,
    });
  });

  test("maps 503 to generic ASP error", async () => {
    globalThis.fetch = mockResponse({}, 503);
    await expect(fetchPoolsStats(chain)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("network connection"),
      retryable: true,
    });
  });

  test("fetchGlobalEvents maps 429 to rate-limit error", async () => {
    globalThis.fetch = mockResponse({}, 429);
    await expect(fetchGlobalEvents(chain, 1, 10)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("Wait a moment"),
    });
  });

  test("fetchGlobalStatistics maps 500 to generic ASP error", async () => {
    globalThis.fetch = mockResponse({}, 500);
    await expect(fetchGlobalStatistics(chain)).rejects.toMatchObject({
      category: "ASP",
      retryable: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Relayer — Network failures                                        */
/* ------------------------------------------------------------------ */

describe("resilience: Relayer network failures", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("getRelayerDetails rejects on network error", async () => {
    globalThis.fetch = mockNetworkError("fetch failed");
    await expect(
      getRelayerDetails(chain, VALID_ADDRESS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("fetch failed"),
    });
  });

  test("requestQuote rejects on timeout", async () => {
    globalThis.fetch = mockNetworkError("The operation was aborted");
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("aborted"),
    });
  });

  test("submitRelayRequest rejects on ECONNREFUSED", async () => {
    globalThis.fetch = mockNetworkError("ECONNREFUSED");
    await expect(
      submitRelayRequest(chain, RELAY_PARAMS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("ECONNREFUSED"),
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Relayer — Malformed responses                                     */
/* ------------------------------------------------------------------ */

describe("resilience: Relayer malformed responses", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  // NOTE: res.json() on non-JSON bodies throws SyntaxError, not CLIError.
  test("getRelayerDetails rejects on non-JSON 200 response", async () => {
    globalThis.fetch = mockText("not json");
    await expect(
      getRelayerDetails(chain, VALID_ADDRESS)
    ).rejects.toThrow();
  });

  test("requestQuote rejects when feeBPS is missing", async () => {
    globalThis.fetch = mockResponse({ gasPrice: "100" });
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("unexpected quote"),
    });
  });

  test("requestQuote rejects when feeBPS is non-numeric string", async () => {
    globalThis.fetch = mockResponse({ feeBPS: "abc" });
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
    });
  });

  test("requestQuote rejects when feeBPS is a number instead of string", async () => {
    globalThis.fetch = mockResponse({ feeBPS: 12 });
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
    });
  });

  test("requestQuote rejects feeCommitment with non-hex withdrawalData", async () => {
    globalThis.fetch = mockResponse({
      feeBPS: "12",
      feeCommitment: {
        expiration: Date.now() + 60_000,
        withdrawalData: "not-hex",
        asset: VALID_ADDRESS,
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
    });
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("invalid fee commitment"),
    });
  });

  test("requestQuote rejects feeCommitment with non-finite expiration", async () => {
    globalThis.fetch = mockResponse({
      feeBPS: "12",
      feeCommitment: {
        expiration: Infinity,
        withdrawalData: "0x1234",
        asset: VALID_ADDRESS,
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
    });
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
    });
  });

  test("requestQuote rejects feeCommitment with invalid asset address", async () => {
    globalThis.fetch = mockResponse({
      feeBPS: "12",
      feeCommitment: {
        expiration: Date.now() + 60_000,
        withdrawalData: "0x1234",
        asset: "0xshort",
        amount: "1000",
        extraGas: false,
        signedRelayerCommitment: "0x5678",
      },
    });
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
    });
  });

  test("submitRelayRequest rejects on empty JSON body", async () => {
    globalThis.fetch = mockResponse({});
    await expect(
      submitRelayRequest(chain, RELAY_PARAMS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("did not accept"),
    });
  });

  test("submitRelayRequest rejects on success:true with short txHash", async () => {
    globalThis.fetch = mockResponse({
      success: true,
      txHash: "0xabc",
      timestamp: Date.now(),
      requestId: "r1",
    });
    await expect(
      submitRelayRequest(chain, RELAY_PARAMS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("transaction hash"),
    });
  });

  test("submitRelayRequest rejects on success:true with non-hex txHash", async () => {
    globalThis.fetch = mockResponse({
      success: true,
      txHash: "0x" + "zz".repeat(32),
      timestamp: Date.now(),
      requestId: "r1",
    });
    await expect(
      submitRelayRequest(chain, RELAY_PARAMS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("transaction hash"),
    });
  });

  test("submitRelayRequest accepts valid 66-char hex txHash", async () => {
    globalThis.fetch = mockResponse({
      success: true,
      txHash: VALID_TX_HASH,
      timestamp: Date.now(),
      requestId: "r1",
    });
    const result = await submitRelayRequest(chain, RELAY_PARAMS);
    expect(result.txHash).toBe(VALID_TX_HASH);
  });
});

/* ------------------------------------------------------------------ */
/*  Relayer — HTTP error status codes                                 */
/* ------------------------------------------------------------------ */

describe("resilience: Relayer HTTP error statuses", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("maps 422 to fee-commitment-expired for requestQuote", async () => {
    globalThis.fetch = mockResponse({ message: "expired" }, 422);
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("fee commitment expired"),
    });
  });

  test("maps 422 to fee-commitment-expired for submitRelayRequest", async () => {
    globalThis.fetch = mockResponse({ message: "expired" }, 422);
    await expect(
      submitRelayRequest(chain, RELAY_PARAMS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("fee commitment expired"),
    });
  });

  test("maps 503 to at-capacity for requestQuote", async () => {
    globalThis.fetch = mockResponse({ message: "busy" }, 503);
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("capacity"),
    });
  });

  test("maps 400 with message to RELAYER error preserving message", async () => {
    globalThis.fetch = mockResponse(
      { message: "Amount below minimum" },
      400
    );
    await expect(requestQuote(chain, QUOTE_PARAMS)).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("Amount below minimum"),
    });
  });

  test("maps 500 with no body to RELAYER error using statusText", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("not json", {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
    ) as typeof fetch;

    await expect(
      getRelayerDetails(chain, VALID_ADDRESS)
    ).rejects.toMatchObject({
      category: "RELAYER",
      message: expect.stringContaining("Internal Server Error"),
    });
  });

  test("maps 401 to generic RELAYER error", async () => {
    globalThis.fetch = mockResponse({ message: "Unauthorized" }, 401);
    await expect(
      getRelayerDetails(chain, VALID_ADDRESS)
    ).rejects.toMatchObject({
      category: "RELAYER",
    });
  });
});
