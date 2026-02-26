import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import { CORE_REPO_ROOT, FRONTEND_REPO_ROOT, pathExists } from "../helpers/paths.ts";

const DOCS_ROOT = CORE_REPO_ROOT;
const FRONTEND_ROOT = FRONTEND_REPO_ROOT;
const frontendAspClientPath = `${FRONTEND_ROOT}/src/utils/aspClient.ts`;
const skillsPath = `${DOCS_ROOT}/docs/static/skills.md`;
const externalRefsAvailable =
  pathExists(frontendAspClientPath) && pathExists(skillsPath);
const externalConformanceRequired =
  process.env.PP_EXTERNAL_CONFORMANCE_REQUIRED === "1";
const runExternalConformance = externalRefsAvailable ? test : test.skip;

describe("chain config conformance", () => {
  test("external docs refs are available when required", () => {
    if (externalConformanceRequired) {
      expect(externalRefsAvailable).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  test("CLI chain config matches canonical deployment anchors", () => {
    const expected = {
      ethereum: {
        id: 1,
        entrypoint: "0x6818809eefce719e480a7526d76bd3e561526b46",
        startBlock: "22153709",
        aspHost: "https://api.0xbow.io",
        relayerHost: "https://fastrelay.xyz",
      },
      arbitrum: {
        id: 42161,
        entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
        startBlock: "404391795",
        aspHost: "https://api.0xbow.io",
        relayerHost: "https://fastrelay.xyz",
      },
      optimism: {
        id: 10,
        entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
        startBlock: "144288139",
        aspHost: "https://api.0xbow.io",
        relayerHost: "https://fastrelay.xyz",
      },
      sepolia: {
        id: 11155111,
        entrypoint: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
        startBlock: "8461450",
        aspHost: "https://dw.0xbow.io",
        relayerHost: "https://testnet-relayer.privacypools.com",
      },
      "op-sepolia": {
        id: 11155420,
        entrypoint: "0x54aca0d27500669fa37867233e05423701f11ba1",
        startBlock: "32854673",
        aspHost: "https://dw.0xbow.io",
        relayerHost: "https://testnet-relayer.privacypools.com",
      },
    } as const;

    for (const [name, exp] of Object.entries(expected)) {
      const chain = CHAINS[name];
      expect(chain).toBeDefined();
      expect(chain.id).toBe(exp.id);
      expect(chain.entrypoint.toLowerCase()).toBe(exp.entrypoint);
      expect(chain.startBlock.toString()).toBe(exp.startBlock);
      expect(chain.aspHost).toBe(exp.aspHost);
      expect(chain.relayerHost).toBe(exp.relayerHost);
    }
  });

  runExternalConformance("core docs and frontend include expected pools-stats object shape", () => {
    const frontendAspClient = readFileSync(frontendAspClientPath, "utf8");

    expect(frontendAspClient).toContain("interface PoolStatsResponse");
    expect(frontendAspClient).toContain("pools?: PoolStats[]");
    expect(frontendAspClient).toContain("/public/pools-stats");

    const skills = readFileSync(skillsPath, "utf8");
    expect(skills).toContain("/public/mt-roots");
    expect(skills).toContain("/public/mt-leaves");
    expect(skills).toContain("onchainMtRoot");
  });
});
