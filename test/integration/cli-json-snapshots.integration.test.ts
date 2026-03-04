/**
 * Snapshot tests for JSON output envelopes.
 *
 * Captures the structure (keys and types) of JSON success and error envelopes
 * for key commands. Uses structural snapshots rather than exact-value snapshots
 * to avoid fragility from timestamps, addresses, or version strings.
 *
 * To update snapshots after intentional changes:
 *   bun test --update-snapshots test/integration/cli-json-snapshots.integration.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

/**
 * Extract the "shape" of a JSON object — keys with their typeof values.
 * This lets us snapshot the structure without fragile exact values.
 */
function jsonShape(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const shape: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val === null) {
      shape[fullKey] = "null";
    } else if (Array.isArray(val)) {
      shape[fullKey] = `array(${val.length})`;
    } else if (typeof val === "object") {
      Object.assign(shape, jsonShape(val as Record<string, unknown>, fullKey));
    } else {
      shape[fullKey] = typeof val;
    }
  }
  return shape;
}

describe("JSON envelope structure snapshots", () => {
  test("status --json success envelope shape", () => {
    const result = runCli(["--json", "status"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("status --json (initialized) success envelope shape", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "--rpc-url", "http://127.0.0.1:9", "status"],
      { home, timeoutMs: 10_000, env: OFFLINE_ASP_ENV },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("capabilities --json success envelope shape", () => {
    const result = runCli(["--json", "capabilities"], {
      home: createTempHome(),
      timeoutMs: 10_000,
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("activity --json error envelope shape (ASP offline)", () => {
    const result = runCli(["--json", "--chain", "mainnet", "activity"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(1);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("stats --json error envelope shape (ASP offline)", () => {
    const result = runCli(["--json", "stats"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(1);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("pools --json error envelope shape (ASP offline)", () => {
    const result = runCli(["--json", "--chain", "sepolia", "pools"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    // pools with offline ASP returns non-zero
    expect(result.status).not.toBe(0);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("INPUT error envelope shape (stats pool without --asset)", () => {
    const result = runCli(["--json", "stats", "pool", "--chain", "sepolia"], {
      home: createTempHome(),
      timeoutMs: 10_000,
      env: OFFLINE_ASP_ENV,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("accounts --json envelope shape (initialized, offline)", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(["--json", "accounts"], {
      home,
      timeoutMs: 15_000,
      env: OFFLINE_ASP_ENV,
    });

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("history --json envelope shape (initialized, offline)", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(["--json", "history"], {
      home,
      timeoutMs: 15_000,
      env: OFFLINE_ASP_ENV,
    });

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });

  test("init --json success envelope shape", () => {
    const result = runCli(
      [
        "--json", "init",
        "--mnemonic", "test test test test test test test test test test test junk",
        "--private-key", "0x1111111111111111111111111111111111111111111111111111111111111111",
        "--default-chain", "sepolia",
        "--yes",
      ],
      { home: createTempHome(), timeoutMs: 30_000 },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
    expect(jsonShape(json)).toMatchSnapshot();
  });
});
