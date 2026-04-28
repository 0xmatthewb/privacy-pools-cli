import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonOutput, runCli } from "../helpers/cli.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

interface ModeFlagCase {
  name: string;
  argv: string[];
  status: number;
  stdout?: "empty";
  stderr?: "empty";
  stderrContains?: string[];
  json?: Record<string, unknown>;
}

const CASES = JSON.parse(
  readFileSync(join(CLI_ROOT, "test", "fixtures", "mode-flag-cases.json"), "utf8"),
) as ModeFlagCase[];

describe("mode and flag matrix conformance", () => {
  for (const matrixCase of CASES) {
    test(matrixCase.name, () => {
      const result = runCli(matrixCase.argv, { timeoutMs: 10_000 });

      expect(result.timedOut).toBe(false);
      expect(result.status).toBe(matrixCase.status);
      if (matrixCase.stdout === "empty") {
        expect(result.stdout).toBe("");
      }
      if (matrixCase.stderr === "empty") {
        expect(result.stderr).toBe("");
      }
      for (const expected of matrixCase.stderrContains ?? []) {
        expect(result.stderr).toContain(expected);
      }
      if (matrixCase.json) {
        expect(parseJsonOutput(result.stdout)).toEqual(
          expect.objectContaining(matrixCase.json),
        );
      }
    });
  }
});
