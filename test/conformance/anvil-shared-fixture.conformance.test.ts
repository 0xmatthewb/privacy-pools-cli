import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("shared anvil fixture conformance", () => {
  test("requires an explicit PP_CONTRACTS_ROOT and does not guess a sibling checkout", () => {
    const source = readFileSync(
      join(CLI_ROOT, "scripts", "anvil-shared-fixture.mjs"),
      "utf8",
    );

    expect(source).toContain("PP_CONTRACTS_ROOT is required");
    expect(source).not.toContain('"docs"');
    expect(source).not.toContain('"privacy-pools-core-main"');
  });
});
