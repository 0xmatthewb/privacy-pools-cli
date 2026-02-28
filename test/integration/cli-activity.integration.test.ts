/**
 * Integration tests for the `activity` command.
 *
 * Covers:
 *   - JSON-mode envelope contracts (global activity)
 *   - Human-mode output stream separation
 *   - --quiet / --agent silent-mode suppression
 *   - Input validation (page, limit)
 *   - Error envelopes when ASP is unreachable
 *
 * Note: `activity` is a public read-only command that works without `init`.
 * It only needs a valid chain config (which has built-in defaults).
 * ASP connection failures are classified as UNKNOWN (exit 1), not ASP (exit 4),
 * because the fetch error from the public endpoints doesn't carry ASP metadata.
 */

import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

function seededHome(chain: string = "sepolia"): string {
  const home = createTempHome();
  initSeededHome(home, chain);
  return home;
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Input validation
// ──────────────────────────────────────────────────────────────────────────────

describe("activity input validation", () => {
  test("activity --json --page 0 fails with INPUT error", () => {
    const result = runCli(
      ["--json", "activity", "--page", "0", "--chain", "sepolia"],
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
    expect(json.error.message).toContain("--page");
    expect(result.stderr.trim()).toBe("");
  });

  test("activity --json --page -1 fails with INPUT error", () => {
    const result = runCli(
      ["--json", "activity", "--page", "-1", "--chain", "sepolia"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });

  test("activity --json --limit 0 fails with INPUT error", () => {
    const result = runCli(
      ["--json", "activity", "--limit", "0", "--chain", "sepolia"],
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
    expect(json.error.message).toContain("--limit");
    expect(result.stderr.trim()).toBe("");
  });

  test("activity --json --page abc fails with INPUT error", () => {
    const result = runCli(
      ["--json", "activity", "--page", "abc", "--chain", "sepolia"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      error: { category: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. ASP-offline error envelopes
// ──────────────────────────────────────────────────────────────────────────────

describe("activity ASP-offline error envelopes", () => {
  test("activity --json (global) with ASP offline returns error envelope", () => {
    const result = runCli(
      ["--json", "--chain", "ethereum", "activity"],
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

  test("activity --json --asset ETH with ASP offline returns ASP error envelope", () => {
    const result = runCli(
      ["--json", "--chain", "ethereum", "activity", "--asset", "ETH"],
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

describe("activity human-mode output contracts", () => {
  test("activity human-mode error (ASP offline): stderr has Error, stdout is empty", () => {
    const result = runCli(
      ["--chain", "ethereum", "activity"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error");
    expect(result.stdout.trim()).toBe("");
  });

  test("activity works without init (public read-only command)", () => {
    // Activity is a public endpoint — it should NOT require init.
    // With offline ASP it fails at the network level, but exit code proves
    // it got past config loading without an INPUT error.
    const result = runCli(
      ["--json", "--chain", "sepolia", "activity"],
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
// 4. --agent mode (JSON + quiet + yes)
// ──────────────────────────────────────────────────────────────────────────────

describe("activity --agent mode", () => {
  test("--agent activity (global, ASP offline): JSON error on stdout, stderr empty", () => {
    const result = runCli(
      ["--agent", "--chain", "ethereum", "activity"],
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

  test("--agent activity with --page/--limit flags: JSON error on stdout, stderr empty", () => {
    const result = runCli(
      ["--agent", "--chain", "ethereum", "activity", "--page", "2", "--limit", "5"],
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
// 5. --quiet suppression (regression: activity.ts silent-mode fix)
// ──────────────────────────────────────────────────────────────────────────────

describe("activity --quiet suppression", () => {
  test("activity --quiet (ASP offline): error still exits non-zero, stdout empty", () => {
    const result = runCli(
      ["--quiet", "--chain", "ethereum", "activity"],
      { home: createTempHome(), timeoutMs: 10_000, env: OFFLINE_ASP_ENV }
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Error envelope field completeness
// ──────────────────────────────────────────────────────────────────────────────

describe("activity error envelope completeness", () => {
  test("INPUT error (invalid --page) has all envelope fields", () => {
    const result = runCli(
      ["--json", "activity", "--page", "0", "--chain", "sepolia"],
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

  test("ASP-offline error has all envelope fields", () => {
    const result = runCli(
      ["--json", "--chain", "ethereum", "activity"],
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
});
