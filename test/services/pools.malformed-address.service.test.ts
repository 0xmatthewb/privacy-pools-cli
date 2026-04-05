/**
 * Regression test for BUG-2: resolvePool address-validation bypass.
 *
 * The original code used `startsWith("0x") && length === 42` which
 * accepted strings with non-hex characters (e.g. "0xGGGG...").  These
 * would pass the guard, get cast to `Address`, and produce confusing
 * RPC errors downstream instead of falling through to symbol lookup.
 *
 * The fix uses `/^0x[0-9a-fA-F]{40}$/` to reject malformed addresses.
 * This test ensures non-hex 42-char strings are treated as symbols,
 * not addresses.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeAbiParameters } from "viem";
import type { Address } from "viem";
import { CHAINS } from "../../src/config/chains.ts";
import {
  resetPoolsServiceCachesForTests,
  resolvePool,
} from "../../src/services/pools.ts";
import { resetSdkServiceCachesForTests } from "../../src/services/sdk.ts";
import { CLIError } from "../../src/utils/errors.ts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

const ENTRYPOINT = "0x00000000000000000000000000000000000000e1" as Address;
const POOL = "0x00000000000000000000000000000000000000a1" as Address;

/**
 * Starts a mock that tracks whether the RPC address-resolution path was hit.
 * The ASP endpoint returns an empty pool list so symbol lookup always fails.
 */
function startMockServer(chainId: number): Promise<MockServer & { addressPathHit: () => boolean }> {
  let hitAddressPath = false;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";

    // ASP stats — empty pools so symbol lookup fails
    if (req.method === "GET" && url === `/${chainId}/public/pools-stats`) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ pools: [] }));
      return;
    }

    // RPC
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const json = JSON.parse(body);
        const call = json?.params?.[0] ?? {};
        const data = String(call.data ?? "").toLowerCase();

        // assetConfig selector — means the address path was taken
        if (data.startsWith("0xd6dbaf58")) {
          hitAddressPath = true;
          const result = encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
            [POOL, 1000000000000000n, 50n, 250n]
          );
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
          return;
        }

        // eth_blockNumber (health probe)
        if (json?.method === "eth_blockNumber") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result: "0x1" }));
          return;
        }

        // Default: return empty
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result: "0x" }));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("bind failed");
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((r, j) => server.close((e) => e ? j(e) : r())),
        addressPathHit: () => hitAddressPath,
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("resolvePool malformed address rejection", () => {
  const toClose: Array<MockServer & { addressPathHit: () => boolean }> = [];

  afterEach(async () => {
    resetSdkServiceCachesForTests();
    resetPoolsServiceCachesForTests();
    while (toClose.length > 0) await toClose.pop()!.close();
  });

  test("non-hex 42-char string does NOT enter the address resolution path", async () => {
    const server = await startMockServer(31370);
    toClose.push(server);

    const cfg = {
      ...CHAINS.mainnet,
      id: 31370,
      entrypoint: ENTRYPOINT,
      aspHost: server.url,
    };

    // "0x" + 40 chars that include non-hex letters (G, Z, etc.)
    const malformed = "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG";
    expect(malformed).toHaveLength(42);
    expect(malformed.startsWith("0x")).toBe(true);

    try {
      await resolvePool(cfg, malformed, server.url);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const e = err as CLIError;
      // Should be INPUT (symbol not found), NOT RPC (address resolution failure)
      expect(e.category).toBe("INPUT");
    }

    // The address-resolution RPC call should never have been made
    expect(server.addressPathHit()).toBe(false);
  });

  test("valid hex address still enters the address resolution path", async () => {
    const server = await startMockServer(31371);
    toClose.push(server);

    const cfg = {
      ...CHAINS.mainnet,
      id: 31371,
      entrypoint: ENTRYPOINT,
      aspHost: server.url,
    };

    const validAddress = "0x00000000000000000000000000000000000000b1";

    // This will hit the address path (may fail downstream, that's fine)
    try {
      await resolvePool(cfg, validAddress, server.url);
    } catch {
      // Expected — mock doesn't fully implement SCOPE(), etc.
    }

    expect(server.addressPathHit()).toBe(true);
  });

  test("mixed-case hex address is accepted (EIP-55 checksum format)", async () => {
    const server = await startMockServer(31372);
    toClose.push(server);

    const cfg = {
      ...CHAINS.mainnet,
      id: 31372,
      entrypoint: ENTRYPOINT,
      aspHost: server.url,
    };

    const checksummed = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

    try {
      await resolvePool(cfg, checksummed, server.url);
    } catch {
      // Expected — mock doesn't fully implement the pool
    }

    // Mixed-case hex should still be treated as an address
    expect(server.addressPathHit()).toBe(true);
  });
});
