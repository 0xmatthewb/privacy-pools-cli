import { describe, expect, test } from "bun:test";
import {
  DEPRECATION_CODE_REGISTRY,
  DEPRECATION_INVENTORY,
  type DeprecationMode,
} from "../../src/utils/deprecations.ts";
import { COMMAND_CATALOG } from "../../src/utils/command-catalog.ts";
import { parseJsonOutput, runCli } from "../helpers/cli.ts";

function argvForMode(argv: readonly string[], mode: DeprecationMode): string[] {
  if (mode === "human") return [...argv];
  return [...argv, mode === "json" ? "--json" : "--agent"];
}

describe("deprecation stream conformance", () => {
  test("deprecation codes are registered in the deprecation inventory", () => {
    for (const entry of DEPRECATION_INVENTORY) {
      expect(DEPRECATION_CODE_REGISTRY.has(entry.code)).toBe(true);
    }
  });

  test("catalog deprecated surfaces are represented in the deprecation inventory", () => {
    const represented = new Set(
      DEPRECATION_INVENTORY.flatMap((entry) => [entry.from, entry.to]),
    );

    for (const [path, metadata] of Object.entries(COMMAND_CATALOG)) {
      if (metadata.deprecated) {
        expect(represented.has(path)).toBe(true);
      }
      for (const alias of metadata.aliases ?? []) {
        if (["recents", "stats", "stats global"].includes(alias)) {
          expect(represented.has(alias)).toBe(true);
        }
      }
    }
  });

  for (const entry of DEPRECATION_INVENTORY) {
    if (entry.testExcludedReason) continue;

    for (const [mode, expectation] of Object.entries(entry.expectations) as Array<
      [DeprecationMode, NonNullable<(typeof entry.expectations)[DeprecationMode]>]
    >) {
      test(`${entry.id} emits ${expectation.shape} in ${mode}`, () => {
        expect(entry.testArgv).toBeDefined();
        const result = runCli(argvForMode(entry.testArgv!, mode), {
          env: {
            PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
          },
        });
        expect(result.status).toBe(0);

        if (expectation.stream === "stderr") {
          expect(result.stderr).toContain(entry.message);
          expect(result.stdout).not.toContain(entry.message);
          return;
        }

        expect(result.stderr).not.toContain(entry.message);
        const payload = parseJsonOutput<{
          deprecationWarning?: {
            code?: string;
            message?: string;
            replacementCommand?: string;
          };
        }>(result.stdout);
        expect(payload.deprecationWarning).toEqual({
          code: entry.code,
          message: entry.message,
          replacementCommand: entry.replacementCommand,
        });
      });
    }
  }
});
