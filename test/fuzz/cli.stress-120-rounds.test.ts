import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const STRESS_ENABLED = process.env.PP_STRESS_ENABLED === "1";
const stressTest = STRESS_ENABLED ? test : test.skip;

describe("CLI stress audit", () => {
  stressTest(
    "runs 120 deterministic rounds with parseable JSON outputs and correct error classification",
    () => {
    const home = createTempHome();
    const init = initSeededHome(home, "mainnet");
    expect(init.status).toBe(0);

    // Each lane has full arguments and expected error behavior.
    // In an offline test env, `status` succeeds (local config check),
    // while deposit/withdraw/ragequit fail on RPC/ASP/RELAYER errors
    // (not on early INPUT validation).
    const commandMatrix: {
      args: string[];
      label: string;
      expectedCategory?: string;
      expectedCode?: string;
    }[] = [
      {
        args: ["--json", "status"],
        label: "status",
        // status may succeed or fail depending on connectivity
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
      },
    ];

    const rounds = 120;
    let ok = 0;

    for (let i = 0; i < rounds; i++) {
      const lane = commandMatrix[i % commandMatrix.length];
      const result = runCli(lane.args, { home, timeoutMs: 20_000 });

      // Every round must complete without timeout and return JSON on stdout.
      expect(result.timedOut).toBe(false);
      const json = parseJsonOutput<{
        success?: boolean;
        schemaVersion?: string;
        error?: { category?: string; code?: string };
      }>(result.stdout);
      expect(typeof json).toBe("object");
      expect(json).not.toBeNull();

      // Assert exit code is non-null (process completed)
      expect(result.status).not.toBeNull();

      if (json.success === false) {
        // Verify structured error
        expect(typeof json.error?.category).toBe("string");
        expect(typeof json.error?.code).toBe("string");

        // Verify expected error category when specified
        if (lane.expectedCategory) {
          expect(json.error?.category).toBe(lane.expectedCategory);
        }
        if (lane.expectedCode) {
          expect(json.error?.code).toBe(lane.expectedCode);
        }
      }

      if (json.schemaVersion) {
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      }
      ok++;
    }

    expect(ok).toBe(rounds);
    },
    120_000
  );
});
