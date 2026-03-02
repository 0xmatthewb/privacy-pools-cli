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
    "runs 120 deterministic rounds with parseable JSON outputs",
    () => {
    const home = createTempHome();
    const init = initSeededHome(home, "mainnet");
    expect(init.status).toBe(0);

    const commandMatrix: string[][] = [
      ["--json", "status"],
      ["--json", "deposit", "0.01", "--yes"],
      ["--json", "withdraw", "0.01", "--yes"],
      ["--json", "ragequit", "--yes"],
    ];

    const rounds = 120;
    let ok = 0;

    for (let i = 0; i < rounds; i++) {
      const args = commandMatrix[i % commandMatrix.length];
      const result = runCli(args, { home, timeoutMs: 20_000 });

      // Every round must complete without timeout and return JSON on stdout.
      expect(result.timedOut).toBe(false);
      const json = parseJsonOutput<{
        success?: boolean;
        schemaVersion?: string;
        error?: { category?: string };
      }>(result.stdout);
      expect(typeof json).toBe("object");
      expect(json).not.toBeNull();
      // Commands against offline services will fail — verify structured error
      if (json.success === false) {
        expect(typeof json.error?.category).toBe("string");
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
