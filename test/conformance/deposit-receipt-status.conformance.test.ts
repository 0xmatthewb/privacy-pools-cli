import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("deposit confirmation conformance", () => {
  test("deposit command checks transaction receipt status before success output", () => {
    const source = readFileSync(
      `${CLI_ROOT}/src/commands/deposit.ts`,
      "utf8"
    );

    expect(source).toContain('if (receipt.status !== "success")');
    expect(source).toContain("Deposit transaction reverted");
  });
});
