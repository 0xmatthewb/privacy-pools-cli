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
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

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
    // Without --chain it fetches all-mainnets and fails at ASP (not INPUT).
    const result = runCli(
      ["--json", "stats"],
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

  test("stats global --chain rejects with INPUT error", () => {
    const result = runCli(
      ["--json", "--chain", "mainnet", "stats", "global"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("--chain");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. ASP-offline error envelopes
// ──────────────────────────────────────────────────────────────────────────────

describe("stats ASP-offline error envelopes", () => {
  test("stats --json (global, default) with ASP offline returns error envelope", () => {
    const result = runCli(
      ["--json", "stats"],
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
      ["--json", "stats", "global"],
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

  test("stats pool --json --asset ETH with ASP+RPC offline returns RPC error envelope", () => {
    const result = runCli(
      ["--json", "--chain", "mainnet", "stats", "pool", "--asset", "ETH"],
      { home: createTempHome(), timeoutMs: 10_000, env: {
        ...OFFLINE_ASP_ENV,
        PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
      }}
    );
    // Pool resolution falls through ASP → KNOWN_POOLS → on-chain RPC (also offline) → exit 3
    expect(result.status).toBe(3);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      error: { category: string; code: string; hint: string; retryable: boolean };
    }>(result.stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_POOL_RESOLUTION_FAILED");
    expect(json.error.code).toBe("RPC_POOL_RESOLUTION_FAILED");
    expect(json.error.category).toBe("RPC");
    expect(json.error.hint).toContain("retry");
    expect(json.error.retryable).toBe(true);
    expect(result.stderr.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Human-mode output stream separation
// ──────────────────────────────────────────────────────────────────────────────

describe("stats human-mode output contracts", () => {
  test("stats human-mode error (ASP offline): stderr has Error, stdout is empty", () => {
    const result = runCli(
      ["stats"],
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
      ["--agent", "stats"],
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
      ["--agent", "stats", "global"],
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
      ["--quiet", "stats"],
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
      ["--json", "stats", "global"],
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
        retryable: boolean;
      };
    }>(result.stdout);

    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.errorMessage).toContain("--asset");
    expect(json.error.code).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("--asset");
    expect(json.error.hint).toContain("privacy-pools stats pool --asset ETH");
    expect(json.error.retryable).toBe(false);
  });
});
