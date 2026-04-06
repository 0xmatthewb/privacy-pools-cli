import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

/**
 * Hermetic offline env overrides.
 *
 * Forces all network-dependent paths (RPC, ASP, relayer) to connect
 * to a closed loopback port, so commands fail fast with structured
 * errors instead of hanging on real network I/O.
 *
 * This file lives outside the default suite on purpose. Run it explicitly
 * with `npm run test:stress` when you want the longer deterministic audit.
 */
const OFFLINE_ENV = {
  PP_RPC_URL: "http://127.0.0.1:9",
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
  PRIVACY_POOLS_RELAYER_HOST: "http://127.0.0.1:9",
};
const STRESS_AUDIT_ROUNDS = 120;
const STRESS_AUDIT_TIMEOUT_MS = 15 * 60_000;

describe("CLI stress audit", () => {
  test(
    "runs 120 deterministic rounds with parseable JSON outputs and correct error classification",
    () => {
    const home = createTempHome();
    const init = initSeededHome(home, "mainnet");
    expect(init.status).toBe(0);

    // Each lane has full arguments and expected error behavior.
    // With OFFLINE_ENV, `status` succeeds (local config check only),
    // while deposit/withdraw/ragequit now fail closed during symbol-based
    // pool resolution with a structured INPUT error plus the documented
    // ASP-offline hint before any RPC-backed contract reads can begin.
    const commandMatrix: {
      args: string[];
      label: string;
      expectedCategory?: string;
      expectedSuccess?: boolean;
    }[] = [
      {
        args: ["--json", "status"],
        label: "status",
        expectedSuccess: true,
      },
      {
        args: ["--json", "deposit", "0.01", "--asset", "ETH", "--yes"],
        label: "deposit",
        expectedCategory: "INPUT",
      },
      {
        args: [
          "--json", "withdraw", "0.01", "--asset", "ETH",
          "--to", "0x0000000000000000000000000000000000000001",
          "--yes",
        ],
        label: "withdraw",
        expectedCategory: "INPUT",
      },
      {
        args: ["--json", "ragequit", "--asset", "ETH", "--yes"],
        label: "ragequit",
        expectedCategory: "INPUT",
      },
      {
        args: ["--json", "status", "--check"],
        label: "status --check",
        expectedSuccess: true,
      },
    ];

    const rounds = STRESS_AUDIT_ROUNDS;
    let ok = 0;

    for (let i = 0; i < rounds; i++) {
      const lane = commandMatrix[i % commandMatrix.length];
      const result = runCli(lane.args, {
        home,
        timeoutMs: 15_000,
        env: OFFLINE_ENV,
      });

      // Every round must complete without timeout and keep machine-mode stderr silent.
      expect(result.timedOut).toBe(false);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        success?: boolean;
        schemaVersion?: string;
        error?: { category?: string; code?: string };
      }>(result.stdout);
      expect(typeof json).toBe("object");
      expect(json).not.toBeNull();

      // Assert exit code is non-null (process completed)
      expect(result.status).not.toBeNull();

      if (lane.expectedSuccess) {
        expect(result.status).toBe(0);
        expect(json.success).toBe(true);
      } else {
        expect(result.status).not.toBe(0);
      }

      if (json.success === false) {
        // Verify structured error
        expect(typeof json.error?.category).toBe("string");
        expect(typeof json.error?.code).toBe("string");

        // Verify expected error category when specified
        if (lane.expectedCategory) {
          expect(json.error?.category).toBe(lane.expectedCategory);
        }
      }

      if (json.schemaVersion) {
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      }
      ok++;

      if ((i + 1) % 20 === 0) {
        console.log(`stress audit progress: ${i + 1}/${rounds}`);
      }
    }

    expect(ok).toBe(rounds);
    },
    STRESS_AUDIT_TIMEOUT_MS
  );
});
