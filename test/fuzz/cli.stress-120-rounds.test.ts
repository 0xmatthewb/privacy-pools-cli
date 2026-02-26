import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

describe("CLI stress audit", () => {
  test(
    "runs 120 deterministic rounds with parseable JSON outputs",
    () => {
    const home = createTempHome();
    const init = initSeededHome(home, "ethereum");
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
      const json = parseJsonOutput<{ success?: boolean }>(result.stdout);
      expect(typeof json).toBe("object");
      ok++;
    }

    expect(ok).toBe(rounds);
    },
    120_000
  );
});
