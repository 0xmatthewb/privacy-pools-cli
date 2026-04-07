import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("docs generation drift detection", () => {
  test("docs/reference.md matches generated output", () => {
    if (!existsSync(join(CLI_ROOT, "dist", "program.js"))) {
      throw new Error(
        "dist/program.js not found. Run `npm run build` before running conformance tests.",
      );
    }

    const result = spawnSync("node", ["scripts/generate-reference.mjs", "--check"], {
      cwd: CLI_ROOT,
      timeout: 30_000,
      env: buildChildProcessEnv(),
    });

    const stderr = result.stderr?.toString() ?? "";
    if (result.status !== 0) {
      throw new Error(
        `docs/reference.md is out of date. Run \`npm run docs:generate\` to regenerate.\n${stderr}`,
      );
    }
    expect(result.status).toBe(0);
  });

  test("docs/reference.md keeps accounts compact-mode nextActions contracts", () => {
    const reference = readFileSync(join(CLI_ROOT, "docs", "reference.md"), "utf8");
    const normalizedReference = reference.replace(/\s+/g, " ");

    expect(reference).toContain("### `accounts`");
    expect(reference).toContain("**JSON variants:**");
    expect(normalizedReference).toContain(
      "--summary: { chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poiRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
    );
    expect(normalizedReference).toContain(
      "--pending-only: { chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
    );
  });

  test("docs/reference.md keeps the full pools machine contract", () => {
    const reference = readFileSync(join(CLI_ROOT, "docs", "reference.md"), "utf8");
    const normalizedReference = reference.replace(/\s+/g, " ");

    expect(reference).toContain("### `pools`");
    expect(normalizedReference).toContain(
      "{ chain?, allChains?, chains?, search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h }], warnings?, nextActions?: [{ command, reason, when, cliCommand, args?, options?, runnable? }] }",
    );
  });
});
