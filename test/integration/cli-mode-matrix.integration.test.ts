/**
 * Parameterized mode matrix tests.
 *
 * Tests every command across all 4 output modes (human, --json, --agent, --quiet)
 * to ensure consistent behavior:
 *   - JSON mode: parseable JSON on stdout, empty stderr
 *   - Agent mode: parseable JSON on stdout, empty stderr
 *   - Quiet mode: empty stdout
 *   - Human mode: stderr has content, stdout is empty (for error paths)
 *
 * Uses an offline ASP to trigger deterministic error paths without network access.
 * Commands that need init use seeded homes; public commands use bare temp homes.
 */

import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const OFFLINE_ASP_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

function seededHome(chain: string = "sepolia"): string {
  const home = createTempHome();
  initSeededHome(home, chain);
  return home;
}

// ─── Public commands (no init required) ──────────────────────────────────────

interface ModeTestCase {
  command: string;
  args: string[];
  needsInit: boolean;
  /** Expected exit code (non-zero since ASP is offline or no pools) */
  expectedExitNonZero: boolean;
}

const PUBLIC_COMMANDS: ModeTestCase[] = [
  { command: "status",   args: ["status"],                                  needsInit: false, expectedExitNonZero: false },
  { command: "activity", args: ["--chain", "mainnet", "activity"],          needsInit: false, expectedExitNonZero: true },
  { command: "stats",    args: ["--chain", "mainnet", "stats"],             needsInit: false, expectedExitNonZero: true },
  { command: "pools",    args: ["--chain", "sepolia", "pools"],             needsInit: false, expectedExitNonZero: true },
];

const INIT_COMMANDS: ModeTestCase[] = [
  { command: "balance",  args: ["balance"],               needsInit: true,  expectedExitNonZero: true },
  { command: "accounts", args: ["accounts"],              needsInit: true,  expectedExitNonZero: true },
  { command: "history",  args: ["history"],               needsInit: true,  expectedExitNonZero: true },
  { command: "sync",     args: ["sync"],                  needsInit: true,  expectedExitNonZero: true },
];

const ALL_COMMANDS = [...PUBLIC_COMMANDS, ...INIT_COMMANDS];

// ─── Mode matrix ─────────────────────────────────────────────────────────────

describe("output mode matrix", () => {
  for (const tc of ALL_COMMANDS) {
    describe(`${tc.command}`, () => {
      const home = tc.needsInit ? seededHome() : createTempHome();
      const baseOpts = { home, timeoutMs: 15_000, env: OFFLINE_ASP_ENV };

      test("--json: parseable JSON on stdout, empty stderr", () => {
        const result = runCli(["--json", ...tc.args], baseOpts);

        if (tc.expectedExitNonZero) {
          expect(result.status).not.toBe(null);
          expect(result.status).not.toBe(0);
        }

        const json = parseJsonOutput<{ schemaVersion: string; success: boolean }>(result.stdout);
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(typeof json.success).toBe("boolean");
        expect(result.stderr.trim()).toBe("");
      });

      test("--agent: parseable JSON on stdout, empty stderr", () => {
        const result = runCli(["--agent", ...tc.args], baseOpts);

        if (tc.expectedExitNonZero) {
          expect(result.status).not.toBe(null);
          expect(result.status).not.toBe(0);
        }

        const json = parseJsonOutput<{ schemaVersion: string; success: boolean }>(result.stdout);
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(typeof json.success).toBe("boolean");
        expect(result.stderr.trim()).toBe("");
      });

      test("--quiet: empty stdout", () => {
        const result = runCli(["--quiet", ...tc.args], baseOpts);
        expect(result.stdout.trim()).toBe("");
      });

      test("human mode: correct stream separation", () => {
        const result = runCli(tc.args, baseOpts);

        if (tc.expectedExitNonZero) {
          // error path: stderr has error, stdout empty
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Error");
          expect(result.stdout.trim()).toBe("");
        } else {
          // success path (e.g. status): exits 0, output on stderr, stdout empty
          expect(result.status).toBe(0);
          expect(result.stderr.length).toBeGreaterThan(0);
          expect(result.stdout.trim()).toBe("");
        }
      });
    });
  }
});
