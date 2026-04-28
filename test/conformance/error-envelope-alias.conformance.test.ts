import { describe, expect, test } from "bun:test";
import { commandEnvelopeSchemas } from "../../src/types/envelopes/commands.ts";
import { parseJsonOutput, runCli } from "../helpers/cli.ts";
import { expectJsonEnvelope } from "../helpers/contract-assertions.ts";
import {
  argvForMode,
  assertSafeInvocationInventoryCoverage,
  invokableSafeInvocationRows,
  loadSafeInvocationRows,
} from "../helpers/safe-invocations.ts";

describe("error envelope alias conformance", () => {
  const rows = loadSafeInvocationRows();

  test("safe invocation inventory covers every static command path", () => {
    assertSafeInvocationInventoryCoverage(rows);
  });

  for (const row of invokableSafeInvocationRows(rows)) {
    for (const mode of row.modes ?? []) {
      test(`${row.command} ${mode} envelope aliases and schema`, () => {
        expect(row.network === false || row.mockedNetwork === true).toBe(true);
        const result = runCli(argvForMode(row, mode), {
          timeoutMs: 20_000,
          env: {
            PRIVACY_POOLS_NO_UPDATE_CHECK: "1",
          },
        });
        expect(result.timedOut).toBe(false);

        const json = parseJsonOutput<Record<string, unknown>>(result.stdout);
        commandEnvelopeSchemas[row.command].parse(json);

        if (json.success === true) {
          expect(json).not.toHaveProperty("errorCode");
          expect(json).not.toHaveProperty("error");
          return;
        }

        expectJsonEnvelope(json as never, { success: false });
      });
    }
  }
});
