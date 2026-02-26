import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  checkLiveness,
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
      hint: expect.stringContaining("retry"),
    });
  });

  test("checkLiveness returns false on fetch failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("network down"))) as typeof fetch;
    await expect(checkLiveness(chain)).resolves.toBe(false);
  });
});
