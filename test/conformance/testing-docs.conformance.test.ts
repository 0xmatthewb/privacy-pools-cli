import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const testingDocs = readFileSync(
  join(CLI_ROOT, "docs", "testing.md"),
  "utf8",
);

describe("testing docs conformance", () => {
  test("keep isolation policy in the manifest instead of a hand-maintained suite inventory", () => {
    expect(testingDocs).toContain("The authoritative isolation map lives in");
    expect(testingDocs).not.toContain("Current default isolated suites:");
    expect(testingDocs).not.toContain("Current coverage-only isolated suites:");
  });

  test("describe the repo-local anvil fixture instead of an external contracts root", () => {
    expect(testingDocs).toContain("test/fixtures/anvil-contract-artifacts");
    expect(testingDocs).toContain("npm run anvil:fixture:refresh");
    expect(testingDocs).not.toContain("PP_CONTRACTS_ROOT");
  });
});
