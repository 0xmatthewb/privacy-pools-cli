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

  test("docs/reference/accounts.md keeps accounts compact-mode nextActions contracts", () => {
    const reference = readFileSync(join(CLI_ROOT, "docs", "reference", "accounts.md"), "utf8");
    const normalizedReference = reference.replace(/\s+/g, " ");

    expect(reference).toContain("## `accounts`");
    expect(reference).toContain("**JSON variants:**");
    expect(normalizedReference).toContain(
      "--summary: { chain, allChains?, chains?, warnings?, pendingCount, approvedCount, poaRequiredCount, declinedCount, unknownCount, spentCount, exitedCount, balances, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
    );
    expect(normalizedReference).toContain(
      "--pending-only: { chain, allChains?, chains?, warnings?, accounts, pendingCount, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
    );
  });

  test("docs/reference/pools.md keeps the full pools machine contract", () => {
    const reference = readFileSync(join(CLI_ROOT, "docs", "reference", "pools.md"), "utf8");
    const normalizedReference = reference.replace(/\s+/g, " ");

    expect(reference).toContain("## `pools`");
    expect(normalizedReference).toContain(
      "{ chain, chainSummaries?: [{ chain, pools, error }], search, sort, pools: [{ chain?, asset, tokenAddress, pool, scope, decimals, minimumDeposit, vettingFeeBPS, maxRelayFeeBPS, totalInPoolValue, totalInPoolValueUsd, totalDepositsValue, totalDepositsValueUsd, acceptedDepositsValue, acceptedDepositsValueUsd, pendingDepositsValue, pendingDepositsValueUsd, totalDepositsCount, acceptedDepositsCount, pendingDepositsCount, growth24h, pendingGrowth24h, myPoolAccountsCount? }], warnings?, nextActions?: [{ command, reason, when, cliCommand?, args?, options?, parameters?, runnable? }] }",
    );
    expect(reference).toContain(
      "Aggregate registry-backed value, count, and growth fields may be null when upstream data is unavailable for a specific pool or chain.",
    );
  });

  test("docs/reference/status.md keeps only the canonical health-check flags", () => {
    const reference = readFileSync(join(CLI_ROOT, "docs", "reference", "status.md"), "utf8");

    expect(reference).toContain("| `--check [scope]` |");
    expect(reference).toContain("| `--no-check` |");
    expect(reference).not.toContain("`--check-rpc`");
    expect(reference).not.toContain("`--check-asp`");
  });

  test("docs/reference/sync.md explains bare sync and the scoped asset form", () => {
    const reference = readFileSync(join(CLI_ROOT, "docs", "reference", "sync.md"), "utf8");

    expect(reference).toContain(
      "Bare `privacy-pools sync` re-syncs every discovered pool on the selected chain.",
    );
    expect(reference).toContain("privacy-pools sync");
    expect(reference).toContain("privacy-pools sync ETH --agent");
  });
});
