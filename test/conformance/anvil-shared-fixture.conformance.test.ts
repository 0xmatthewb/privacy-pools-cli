import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("shared anvil fixture conformance", () => {
  test("uses the repo-local fixture and does not mutate an external contracts checkout", () => {
    const source = readFileSync(
      join(CLI_ROOT, "scripts", "anvil-shared-fixture.mjs"),
      "utf8",
    );

    expect(source).toContain('"test"');
    expect(source).toContain('"fixtures"');
    expect(source).toContain('"anvil-contract-artifacts"');
    expect(source).not.toContain("PP_CONTRACTS_ROOT");
    expect(source).not.toContain("yarn --frozen-lockfile");
    expect(source).not.toContain("remappings.txt");
    expect(source).not.toContain("symlinkSync");
    expect(source).not.toContain("forge build");
  });
});
