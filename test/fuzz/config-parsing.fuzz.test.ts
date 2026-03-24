import { describe, expect, test } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { CLIError } from "../../src/utils/errors.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

/**
 * Fuzz test for config/env parsing.
 *
 * Tests loadConfig by writing random config.json files to temp directories
 * and verifying that the parser either produces valid output or throws CLIError
 * (never a raw TypeError/SyntaxError).
 *
 * We import loadConfig dynamically per iteration to bypass the module-level cache.
 */

function makeTempConfigDir(): string {
  const dir = createTrackedTempDir("pp-fuzz-cfg-");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfigFile(dir: string, content: string): void {
  writeFileSync(join(dir, "config.json"), content, "utf-8");
}

async function withTempConfigHome<T>(
  dir: string,
  run: () => Promise<T>,
): Promise<T> {
  const savedHome = process.env.PRIVACY_POOLS_HOME;
  process.env.PRIVACY_POOLS_HOME = dir;
  try {
    return await run();
  } finally {
    if (savedHome === undefined) delete process.env.PRIVACY_POOLS_HOME;
    else process.env.PRIVACY_POOLS_HOME = savedHome;
  }
}

describe("config parsing fuzz", () => {
  test("malformed JSON config files throw CLIError, never raw errors", async () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xCCCCCCCC);

    // Malformed JSON strings
    const malformedJsons: string[] = [
      "",
      "{",
      "}",
      "[",
      "null",
      "42",
      '"just a string"',
      "true",
      "false",
      "{,}",
      '{"defaultChain":}',
      "{{}}",
      '{"defaultChain": "mainnet"',  // unclosed
      '\x00\x01\x02',
      '{"a": undefined}',
    ];

    // Add random garbage strings
    for (let i = 0; i < 20; i++) {
      const len = 1 + rng.nextInt(100);
      let s = "";
      for (let j = 0; j < len; j++) {
        s += String.fromCharCode(rng.nextInt(128));
      }
      malformedJsons.push(s);
    }

    for (const content of malformedJsons) {
      const dir = makeTempConfigDir();
      writeConfigFile(dir, content);

      await withTempConfigHome(dir, async () => {
        const configMod = await import(`../../src/services/config.ts?v=${Date.now()}-${rng.nextUInt32()}`);
        let error: unknown;
        try {
          configMod.loadConfig();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(CLIError);
        expect((error as CLIError).category).toBe("INPUT");
      });
    }
  });

  test("structurally invalid config objects throw CLIError", async () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xDDDDDDDD);

    // Valid JSON but invalid config structures
    const invalidConfigs: unknown[] = [
      // Missing defaultChain
      {},
      { rpcOverrides: {} },
      // defaultChain wrong type
      { defaultChain: 42 },
      { defaultChain: null },
      { defaultChain: true },
      { defaultChain: [] },
      { defaultChain: {} },
      // defaultChain empty
      { defaultChain: "" },
      { defaultChain: "  " },
      // rpcOverrides wrong type
      { defaultChain: "mainnet", rpcOverrides: "not-object" },
      { defaultChain: "mainnet", rpcOverrides: 42 },
      { defaultChain: "mainnet", rpcOverrides: true },
      // rpcOverrides with invalid values
      { defaultChain: "mainnet", rpcOverrides: { "1": 42 } },
      { defaultChain: "mainnet", rpcOverrides: { "1": null } },
      { defaultChain: "mainnet", rpcOverrides: { "1": "" } },
      { defaultChain: "mainnet", rpcOverrides: { "1": "  " } },
      // rpcOverrides with non-integer keys
      { defaultChain: "mainnet", rpcOverrides: { "abc": "https://rpc.example.com" } },
      { defaultChain: "mainnet", rpcOverrides: { "1.5": "https://rpc.example.com" } },
      { defaultChain: "mainnet", rpcOverrides: { "NaN": "https://rpc.example.com" } },
      { defaultChain: "mainnet", rpcOverrides: { "Infinity": "https://rpc.example.com" } },
    ];

    // Add random object structures
    for (let i = 0; i < 15; i++) {
      const obj: Record<string, unknown> = {};
      const keyCount = rng.nextInt(5);
      for (let j = 0; j < keyCount; j++) {
        const keyLen = 1 + rng.nextInt(10);
        let key = "";
        for (let k = 0; k < keyLen; k++) {
          key += String.fromCharCode(97 + rng.nextInt(26));
        }
        const valType = rng.nextInt(5);
        switch (valType) {
          case 0: obj[key] = rng.nextInt(1000); break;
          case 1: obj[key] = `val-${rng.nextUInt32()}`; break;
          case 2: obj[key] = null; break;
          case 3: obj[key] = rng.nextInt(2) === 0; break;
          case 4: obj[key] = [rng.nextInt(10)]; break;
        }
      }
      invalidConfigs.push({
        defaultChain: rng.nextInt(1000),
        rpcOverrides: obj,
      });
    }

    for (const config of invalidConfigs) {
      const dir = makeTempConfigDir();
      writeConfigFile(dir, JSON.stringify(config));

      await withTempConfigHome(dir, async () => {
        const configMod = await import(`../../src/services/config.ts?v=${Date.now()}-${rng.nextUInt32()}`);
        let error: unknown;
        try {
          configMod.loadConfig();
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(CLIError);
        expect((error as CLIError).category).toBe("INPUT");
      });
    }
  });

  test("valid configs load without error", async () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xEEEEEEEE);

    for (let i = 0; i < 20; i++) {
      const chains = ["mainnet", "sepolia", "arbitrum", "optimism", "op-sepolia"];
      const chain = chains[rng.nextInt(chains.length)];

      const rpcOverrides: Record<string, string> = {};
      const overrideCount = rng.nextInt(4);
      const chainIds = [1, 42161, 10, 11155111, 11155420];
      for (let j = 0; j < overrideCount; j++) {
        const chainId = chainIds[rng.nextInt(chainIds.length)];
        rpcOverrides[String(chainId)] = `https://rpc-${rng.nextUInt32()}.example.com`;
      }

      const config = { defaultChain: chain, rpcOverrides };
      const dir = makeTempConfigDir();
      writeConfigFile(dir, JSON.stringify(config));

      await withTempConfigHome(dir, async () => {
        const configMod = await import(`../../src/services/config.ts?v=${Date.now()}-${rng.nextUInt32()}`);
        const loaded = configMod.loadConfig();
        expect(loaded.defaultChain).toBe(chain);
        expect(loaded.rpcOverrides).toEqual(rpcOverrides);
      });
    }
  });
});
