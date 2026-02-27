import { afterEach, describe, expect, mock, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  checkLiveness,
  fetchPoolsStats,
} from "../../src/services/asp.ts";
import { CLIError } from "../../src/utils/errors.ts";

const chain = CHAINS.sepolia;
const originalFetch = globalThis.fetch;

describe("ASP service error handling", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("checkLiveness returns true for healthy response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), { status: 200 })
      )
    ) as typeof fetch;

    const result = await checkLiveness(chain);
    expect(result).toBe(true);
  });

  test("checkLiveness returns false for non-ok response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 500 }))
    ) as typeof fetch;

    const result = await checkLiveness(chain);
    expect(result).toBe(false);
  });

  test("checkLiveness returns false for non-ok status in body", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "unhealthy" }), { status: 200 })
      )
    ) as typeof fetch;

    const result = await checkLiveness(chain);
    expect(result).toBe(false);
  });

  test("checkLiveness returns false on network error", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("ECONNREFUSED"))
    ) as typeof fetch;

    const result = await checkLiveness(chain);
    expect(result).toBe(false);
  });

  test("fetchPoolsStats throws CLIError on 404", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", { status: 404, statusText: "Not Found" })
      )
    ) as typeof fetch;

    await expect(fetchPoolsStats(chain)).rejects.toMatchObject({
      category: "ASP",
      message: expect.stringContaining("resource not found"),
    });
  });

  test("fetchPoolsStats throws CLIError on 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", { status: 429, statusText: "Too Many Requests" })
      )
    ) as typeof fetch;

    await expect(fetchPoolsStats(chain)).rejects.toMatchObject({
      category: "ASP",
      hint: expect.stringContaining("Wait a moment"),
    });
  });

  test("fetchPoolsStats throws CLIError on 500", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
    ) as typeof fetch;

    try {
      await fetchPoolsStats(chain);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).category).toBe("ASP");
    }
  });

  test("fetchPoolsStats throws CLIError on 400", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("{}", { status: 400, statusText: "Bad Request" })
      )
    ) as typeof fetch;

    try {
      await fetchPoolsStats(chain);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).category).toBe("ASP");
    }
  });
});
