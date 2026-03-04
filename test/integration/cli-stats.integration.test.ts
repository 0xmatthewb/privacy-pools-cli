/**
 * Integration tests for the `stats` command.
 *
 * Covers:
 *   - JSON-mode envelope contracts (global + pool stats)
 *   - Human-mode output stream separation
 *   - --agent mode (JSON + quiet + yes)
 *   - Input validation (missing --asset for pool subcommand)
 *   - Error envelopes when ASP is unreachable
 *
 * Note: `stats` is a public read-only command that works without `init`.
 * It only needs a valid chain config (which has built-in defaults).
 * ASP connection failures are classified as UNKNOWN (exit 1), not ASP (exit 4),
 * because the fetch error from the public endpoints doesn't carry ASP metadata.
 */

import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

function seededHome(chain: string = "sepolia"): string {
  const home = createTempHome();
  mustInitSeededHome(home, chain);
  return home;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Input validation
// ──────────────────────────────────────────────────────────────────────────────

describe("stats input validation", () => {
  test("stats pool --json without --asset fails with INPUT error", () => {
    const result = runCli(
      ["--json", "stats", "pool", "--chain", "sepolia"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("--asset");
    expect(result.stderr.trim()).toBe("");
  });

  test("stats works without init (public read-only command)", () => {
    // stats (global) is a public endpoint — it should NOT require init.
    const result = runCli(
      ["--json", "--chain", "sepolia", "stats"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    // If it required init, it would exit 2 with INPUT. Instead it tries to
    // fetch and fails with a connection error (exit 1).
    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    // NOT INPUT — proves it passed config/init gate
    expect(json.error.category).not.toBe("INPUT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. ASP-offline error envelopes
// ──────────────────────────────────────────────────────────────────────────────

describe("stats ASP-offline error envelopes", () => {
  test("stats --json (global, default) with ASP offline returns error envelope", () => {
    const result = runCli(
      ["--json", "--chain", "mainnet", "stats"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string; code: string; message: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(typeof json.errorCode).toBe("string");
    expect(typeof json.errorMessage).toBe("string");
    expect(typeof json.error.category).toBe("string");
    expect(result.stderr.trim()).toBe("");
  });

  test("stats global --json with ASP offline returns error envelope", () => {
    const result = runCli(
      ["--json", "--chain", "mainnet", "stats", "global"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(result.stderr.trim()).toBe("");
  });

  test("stats pool --json --asset ETH with ASP offline returns ASP error envelope", () => {
    const result = runCli(
      ["--json", "--chain", "mainnet", "stats", "pool", "--asset", "ETH"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    // Pool resolution goes through resolvePool → ASP client → classified as ASP error
    expect(result.status).toBe(4);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("ASP");
    expect(result.stderr.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Human-mode output stream separation
// ──────────────────────────────────────────────────────────────────────────────

describe("stats human-mode output contracts", () => {
  test("stats human-mode error (ASP offline): stderr has Error, stdout is empty", () => {
    const result = runCli(
      ["--chain", "mainnet", "stats"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error");
    expect(result.stdout.trim()).toBe("");
  });

  test("stats pool human-mode without --asset: stderr has Error, stdout is empty", () => {
    const result = runCli(
      ["stats", "pool", "--chain", "sepolia"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Error");
    expect(result.stdout.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. --agent mode (JSON + quiet + yes)
// ──────────────────────────────────────────────────────────────────────────────

describe("stats --agent mode", () => {
  test("--agent stats (global, ASP offline): JSON error on stdout, stderr empty", () => {
    const result = runCli(
      ["--agent", "--chain", "mainnet", "stats"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
  });

  test("--agent stats pool without --asset: JSON INPUT error on stdout, stderr empty", () => {
    const result = runCli(
      ["--agent", "stats", "pool", "--chain", "sepolia"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("--asset");
  });

  test("--agent stats global (ASP offline): JSON error on stdout, stderr empty", () => {
    const result = runCli(
      ["--agent", "--chain", "mainnet", "stats", "global"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. --quiet suppression
// ──────────────────────────────────────────────────────────────────────────────

describe("stats --quiet suppression", () => {
  test("stats --quiet (ASP offline): error still exits non-zero, stdout is empty", () => {
    const result = runCli(
      ["--quiet", "--chain", "mainnet", "stats"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Error envelope field completeness
// ──────────────────────────────────────────────────────────────────────────────

describe("stats error envelope completeness", () => {
  test("stats global ASP-offline error has all envelope fields", () => {
    const result = runCli(
      ["--json", "--chain", "mainnet", "stats", "global"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: {
        code: string;
        category: string;
        message: string;
      };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(typeof json.errorCode).toBe("string");
    expect(typeof json.errorMessage).toBe("string");
    expect(typeof json.error.code).toBe("string");
    expect(typeof json.error.category).toBe("string");
    expect(typeof json.error.message).toBe("string");
  });

  test("stats pool INPUT error has all envelope fields", () => {
    const result = runCli(
      ["--json", "stats", "pool", "--chain", "sepolia"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: {
        code: string;
        category: string;
        message: string;
        hint: string;
      };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(typeof json.errorCode).toBe("string");
    expect(typeof json.errorMessage).toBe("string");
    expect(typeof json.error.code).toBe("string");
    expect(json.error.category).toBe("INPUT");
    expect(typeof json.error.message).toBe("string");
    expect(typeof json.error.hint).toBe("string");
  });
});
