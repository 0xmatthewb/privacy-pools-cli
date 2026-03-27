import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const flakeWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "flake.yml"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};

describe("flake workflow conformance", () => {
  test("flake workflow runs the repo's full flake contract", () => {
    expect(packageJson.scripts?.["test:flake"]).toBeTruthy();
    expect(packageJson.scripts?.["test:flake"]).toBe(
      "node scripts/run-flake-suite.mjs",
    );
    expect(flakeWorkflow).toContain("Run flake suite");
    expect(flakeWorkflow).toContain("run: npm run test:flake");
    expect(flakeWorkflow).toContain("Setup Rust");
    expect(flakeWorkflow).toContain("dtolnay/rust-toolchain@stable");
    expect(flakeWorkflow).toContain("PP_FLAKE_SEED:");
    expect(flakeWorkflow).not.toContain("Run randomized suite");
    expect(flakeWorkflow).not.toContain("Re-run stateful suites");
  });
});
