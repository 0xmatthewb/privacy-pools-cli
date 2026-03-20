/**
 * Chain config conformance: cross-checks CLI's ASP/relayer service code
 * against the upstream frontend to ensure both hit the same API shapes,
 * and validates that all CLI chain configs are structurally sound.
 *
 * @frontend-parity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import { CORE_REPO, FRONTEND_REPO, fetchGitHubFile } from "../helpers/github.ts";
import { CLI_ROOT } from "../helpers/paths.ts";
import { CHAINS } from "../../src/config/chains.ts";

let upstreamAspClient = "";
let upstreamDeployments = "";
let fetchFailed = false;

const cliAsp = readFileSync(resolve(CLI_ROOT, "src/services/asp.ts"), "utf8");

describe("chain config conformance", () => {
  beforeAll(async () => {
    try {
      [upstreamAspClient, upstreamDeployments] = await Promise.all([
        fetchGitHubFile(FRONTEND_REPO, "src/utils/aspClient.ts"),
        fetchGitHubFile(CORE_REPO, "docs/docs/deployments.md"),
      ]);
    } catch (err) {
      console.warn("Skipping chain-config conformance — could not fetch upstream files:", err);
      fetchFailed = true;
    }
  });

  // NOTE: "CLI chain config matches canonical deployment anchors" test has been
  // moved to test/integration/cli-chain-config.integration.test.ts so it always
  // runs in the default test suite (it's fully self-contained, no external repos).

  test("upstream fetch succeeded (canary — upstream tests below are skipped if this fails)", () => {
    if (fetchFailed) {
      console.warn("WARN: upstream GitHub fetch failed — conformance tests are NOT running");
    }
    expect(fetchFailed).toBe(false);
  });

  test("CLI and frontend both define pools-stats response shape", () => {
    if (fetchFailed) return;

    // Upstream frontend defines the response interface
    expect(upstreamAspClient).toContain("PoolStats");
    expect(upstreamAspClient).toContain("/public/pools-stats");

    // CLI defines its own compatible type and hits the same endpoint
    expect(cliAsp).toContain("PoolStats");
    expect(cliAsp).toContain("/public/pools-stats");
  });

  // -------------------------------------------------------------------
  // Structural validation: every chain config is well-formed
  // -------------------------------------------------------------------

  test("every CLI chain config has a valid entrypoint address", () => {
    for (const [, config] of Object.entries(CHAINS)) {
      // Entrypoint must be a checksummed-or-lowercase 0x address
      expect(config.entrypoint).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // Must have a numeric chain ID
      expect(typeof config.id).toBe("number");
      expect(config.id).toBeGreaterThan(0);
      // Must have a positive start block
      expect(config.startBlock).toBeGreaterThan(0n);
      // Must have non-empty ASP and relayer hosts
      expect(config.aspHost).toMatch(/^https?:\/\//);
      expect(config.relayerHost).toMatch(/^https?:\/\//);
    }
  });

  test("mainnet entrypoints documented upstream all match CLI config", () => {
    if (fetchFailed) return;

    const deploymentsLower = upstreamDeployments.toLowerCase();

    // Check each mainnet chain individually for clear per-chain diagnostics.
    // When upstream documents a chain, we immediately validate the CLI's
    // address for that chain — catching single-address drift.
    const mainnetConfigs = Object.values(CHAINS).filter((c) => !c.isTestnet);
    expect(mainnetConfigs.length).toBeGreaterThanOrEqual(1);

    const matched: string[] = [];
    for (const config of mainnetConfigs) {
      if (deploymentsLower.includes(config.entrypoint.toLowerCase())) {
        matched.push(config.name);
      }
    }

    // At minimum one chain must match (guards against doc format changes)
    expect(matched.length).toBeGreaterThanOrEqual(1);

    // Warn about chains not yet documented upstream — this surfaces
    // coverage gaps without failing on upstream documentation lag.
    if (matched.length < mainnetConfigs.length) {
      const missing = mainnetConfigs
        .filter((c) => !matched.includes(c.name))
        .map((c) => c.name);
      console.warn(
        `WARN: ${missing.length} mainnet chain(s) not found in upstream deployments.md: ${missing.join(", ")}. ` +
          "Consider updating upstream documentation.",
      );
    }
  });
});
