import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  checkLiveness,
  fetchApprovedLabels,
  fetchDepositsLargerThan,
  fetchMerkleLeaves,
  fetchMerkleRoots,
  fetchPoolsStats,
} from "../../src/services/asp.ts";

const chain = CHAINS.ethereum;
const originalFetch = globalThis.fetch;

describe("asp service", () => {
  beforeEach(() => {
    // no-op
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("sends decimal X-Pool-Scope header to mt-roots/mt-leaves", async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: init?.headers,
      });

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
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      seenUrl = String(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({ eligibleDeposits: 12, totalDeposits: 34, percentage: 35.29 }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

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
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 429, statusText: "Too Many Requests" }))
    ) as typeof fetch;

    await expect(fetchMerkleLeaves(chain, 1n)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("Wait a moment"),
    });
  });

  test("checkLiveness returns false on fetch failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as typeof fetch;
    await expect(checkLiveness(chain)).resolves.toBe(false);
  });
});
