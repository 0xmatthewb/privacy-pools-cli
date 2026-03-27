import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";

const flakeWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "flake.yml"),
  "utf8",
);
const flakeAnvilWorkflow = readFileSync(
  join(CLI_ROOT, ".github", "workflows", "flake-anvil.yml"),
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

  test("anvil flake workflow keeps the heavier shared-state reruns separate", () => {
    expect(packageJson.scripts?.["test:flake:anvil"]).toBe(
      "node scripts/run-anvil-flake-suite.mjs",
    );
    expect(flakeAnvilWorkflow).toContain("Run shared-Anvil flake suite");
    expect(flakeAnvilWorkflow).toContain("run: npm run test:flake:anvil");
    expect(flakeAnvilWorkflow).toContain("Select flake-anvil");
    expect(flakeAnvilWorkflow).toContain("Install Foundry");
    expect(flakeAnvilWorkflow).toContain("Setup Rust");
    expect(flakeAnvilWorkflow).toContain("PP_CONTRACTS_ROOT:");
  });
});
