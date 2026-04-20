import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  buildLoadedAspDepositReviewState,
  checkLiveness,
  fetchApprovedLabels,
  fetchDepositsLargerThan,
  fetchGlobalStatistics,
  fetchMerkleLeaves,
  fetchMerkleRoots,
  fetchPoolsStats,
  formatIncompleteAspReviewDataMessage,
  overrideAspRetryWaitForTests,
} from "../../src/services/asp.ts";
import {
  createStrictStubRegistry,
  type StrictStubRegistry,
} from "../helpers/strict-stubs.ts";

const chain = CHAINS.mainnet;
const originalFetch = globalThis.fetch;
let strictFetchRegistry: StrictStubRegistry<
  [RequestInfo | URL, RequestInit | undefined],
  Promise<Response>
> | null = null;

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

describe("asp service", () => {
  beforeEach(() => {
    overrideAspRetryWaitForTests(async () => {});
  });

  afterEach(() => {
    try {
      strictFetchRegistry?.assertConsumed();
    } finally {
      strictFetchRegistry?.reset();
      strictFetchRegistry = null;
      globalThis.fetch = originalFetch;
      overrideAspRetryWaitForTests();
      mock.restore();
    }
  });

  test("sends decimal X-Pool-Scope header to mt-roots/mt-leaves", async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    const fetchRegistry = installStrictFetch("asp.scope-headers");
    fetchRegistry.expectCall(
      "mt-roots",
      async (input, init) => {
        calls.push({
          url: String(input),
          headers: init?.headers,
        });

        return new Response(
          JSON.stringify({
            mtRoot: "1",
            createdAt: "2026-01-01T00:00:00.000Z",
            onchainMtRoot: "1",
            aspLeaves: [],
            stateTreeLeaves: [],
          }),
          { status: 200 },
        );
      },
      {
        match: (input) => String(input).includes("/public/mt-roots"),
      },
    );
    fetchRegistry.expectCall(
      "mt-leaves",
      async (input, init) => {
        calls.push({
          url: String(input),
          headers: init?.headers,
        });

        return new Response(
          JSON.stringify({
            mtRoot: "1",
            createdAt: "2026-01-01T00:00:00.000Z",
            onchainMtRoot: "1",
            aspLeaves: [],
            stateTreeLeaves: [],
          }),
          { status: 200 },
        );
      },
      {
        match: (input) => String(input).includes("/public/mt-leaves"),
      },
    );

    await fetchMerkleRoots(chain, 123456789n);
    await fetchMerkleLeaves(chain, 123456789n);

    expect(calls.length).toBe(2);
    expect(calls[0].url).toContain(`/1/public/mt-roots`);
    expect(calls[1].url).toContain(`/1/public/mt-leaves`);

    for (const call of calls) {
      const headers = new Headers(call.headers);
      expect(headers.get("X-Pool-Scope")).toBe("123456789");
    }
  });

  test("fetchPoolsStats accepts object payload returned by ASP", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ pools: [{ tokenSymbol: "ETH" }] }), {
          status: 200,
        })
      )
    ) as typeof fetch;

    const payload = await fetchPoolsStats(chain);
    expect(payload).toEqual({ pools: [{ tokenSymbol: "ETH" }] });
  });

  test("fetchDepositsLargerThan calls endpoint with amount query", async () => {
    let seenUrl = "";
    const fetchRegistry = installStrictFetch("asp.deposits-larger-than");
    fetchRegistry.expectCall(
      "deposits-larger-than",
      async (input) => {
        seenUrl = String(input);
        return new Response(
          JSON.stringify({ eligibleDeposits: 12, totalDeposits: 34, percentage: 35.29 }),
          { status: 200 },
        );
      },
      {
        match: (input) => String(input).includes("/public/deposits-larger-than"),
      },
    );

    const payload = await fetchDepositsLargerThan(chain, 777n, 123n);
    expect(seenUrl).toContain("/1/public/deposits-larger-than?amount=123");
    expect(payload).toEqual({
      eligibleDeposits: 12,
      totalDeposits: 34,
      percentage: 35.29,
    });
  });

  test("fetchApprovedLabels returns label set and degrades to null on failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ aspLeaves: ["1", "2", "3"], stateTreeLeaves: [] }), {
          status: 200,
        })
      )
    ) as typeof fetch;

    await expect(fetchApprovedLabels(chain, 1n)).resolves.toEqual(new Set(["1", "2", "3"]));

    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as typeof fetch;
    await expect(fetchApprovedLabels(chain, 1n)).resolves.toBeNull();
  });

  test("fetchApprovedLabels normalizes hex and decimal leaves to canonical decimal strings", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            aspLeaves: ["0x01", "2", "0x2", "0x0003"],
            stateTreeLeaves: [],
          }),
          { status: 200 }
        )
      )
    ) as typeof fetch;

    await expect(fetchApprovedLabels(chain, 1n)).resolves.toEqual(new Set(["1", "2", "3"]));
  });

  test("formats context-specific incomplete review warnings", () => {
    expect(formatIncompleteAspReviewDataMessage("accounts")).toContain("--pending-only");
    expect(formatIncompleteAspReviewDataMessage("pool-detail")).toContain("unknown");
    expect(formatIncompleteAspReviewDataMessage("ragequit", "mainnet")).toContain(
      "privacy-pools accounts --chain mainnet",
    );
  });

  test("buildLoadedAspDepositReviewState flags omitted review rows as incomplete", () => {
    const state = buildLoadedAspDepositReviewState(
      ["1", "2"],
      new Set(["1"]),
      new Map([["1", "approved"]]),
    );

    expect(state.reviewStatuses).toEqual(new Map([["1", "approved"]]));
    expect(state.hasIncompleteReviewData).toBe(true);
  });

  test("maps 400 errors to ASP category with version/sync hint", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      return Promise.resolve(new Response("{}", { status: 400, statusText: "Bad Request" }));
    }) as typeof fetch;

    await expect(fetchMerkleRoots(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("out of date"),
    });
    expect(callCount).toBe(1);
  });

  test("maps 404 errors to ASP category", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 404, statusText: "Not Found" }))
    ) as typeof fetch;

    await expect(fetchMerkleRoots(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      message: expect.stringContaining("resource not found"),
    });
  });

  test("maps 429 errors to ASP category with retry hint", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      return Promise.resolve(new Response("{}", { status: 429, statusText: "Too Many Requests" }));
    }) as typeof fetch;

    await expect(fetchMerkleLeaves(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("Wait a moment"),
    });
    expect(callCount).toBe(1);
  });

  test("checkLiveness returns false on fetch failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as typeof fetch;
    await expect(checkLiveness(chain)).resolves.toBe(false);
  });

  test("retries on 5xx errors and eventually succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      if (callCount < 3) {
        return Promise.resolve(new Response("{}", { status: 500 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mtRoot: "1",
            createdAt: "2026-01-01T00:00:00.000Z",
            onchainMtRoot: "1",
            aspLeaves: [],
            stateTreeLeaves: [],
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const result = await fetchMerkleRoots(chain, 1n);
    expect(result).toHaveProperty("mtRoot");
    expect(callCount).toBe(3);
  });

  test("retries on network errors and eventually succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      if (callCount < 2) {
        return Promise.reject(new Error("fetch failed: ECONNREFUSED"));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ pools: [] }), { status: 200 })
      );
    }) as typeof fetch;

    const result = await fetchPoolsStats(chain);
    expect(result).toEqual({ pools: [] });
    expect(callCount).toBe(2);
  });

  test("does not retry on 403 rate limits", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      return Promise.resolve(new Response("{}", { status: 403 }));
    }) as typeof fetch;

    await expect(fetchGlobalStatistics(chain)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("Wait a moment"),
    });
    expect(callCount).toBe(1);
  });

  test("throws after exhausting all retries on persistent 5xx", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      return Promise.resolve(new Response("{}", { status: 500 }));
    }) as typeof fetch;

    await expect(fetchMerkleRoots(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      message: expect.stringContaining("Could not reach"),
      retryable: true,
    });
    expect(callCount).toBe(4);
  });

  test("retries global ASP endpoints on 5xx errors", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount += 1;
      if (callCount < 3) {
        return Promise.resolve(new Response("{}", { status: 502 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            allTime: null,
            last24h: null,
            cacheTimestamp: null,
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const result = await fetchGlobalStatistics(chain);
    expect(result).toEqual({
      allTime: null,
      last24h: null,
      cacheTimestamp: null,
    });
    expect(callCount).toBe(3);
  });
});
