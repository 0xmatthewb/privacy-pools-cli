import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { CORE_REPO_ROOT, FRONTEND_REPO_ROOT, pathExists } from "../helpers/paths.ts";

const DOCS_ROOT = CORE_REPO_ROOT;
const FRONTEND_ROOT = FRONTEND_REPO_ROOT;
const frontendAspClientPath = `${FRONTEND_ROOT}/src/utils/aspClient.ts`;
const skillsPath = `${DOCS_ROOT}/docs/static/skills.md`;

// Gate on the frontend client (stable source-code path) rather than
// skills.md (docs path that may move between upstream releases).
const hasFrontendRef = pathExists(frontendAspClientPath);
const hasSkillsRef = pathExists(skillsPath);
const externalConformanceRequired =
  process.env.PP_EXTERNAL_CONFORMANCE_REQUIRED === "1";
const runExternalConformance = hasFrontendRef ? test : test.skip;

describe("chain config conformance", () => {
  test("external docs refs are available when required", () => {
    if (externalConformanceRequired) {
      if (!hasFrontendRef) {
        throw new Error(
          "PP_EXTERNAL_CONFORMANCE_REQUIRED=1 but external repo paths are not set or repos not found.\n"
          + "Set PP_CORE_REPO_ROOT and PP_FRONTEND_REPO_ROOT before running, e.g.:\n"
          + "  PP_CORE_REPO_ROOT=/path/to/privacy-pools-core "
          + "PP_FRONTEND_REPO_ROOT=/path/to/privacy-pools-website "
          + "bun run test:release"
        );
      }
      expect(hasFrontendRef).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  // NOTE: "CLI chain config matches canonical deployment anchors" test has been
  // moved to test/integration/cli-chain-config.integration.test.ts so it always
  // runs in the default test suite (it's fully self-contained, no external repos).

  runExternalConformance("core docs and frontend include expected pools-stats object shape", () => {
    const frontendAspClient = readFileSync(frontendAspClientPath, "utf8");

    expect(frontendAspClient).toContain("interface PoolStatsResponse");
    expect(frontendAspClient).toContain("pools?: PoolStats[]");
    expect(frontendAspClient).toContain("/public/pools-stats");

    // Skills-content checks are conditional — file may not exist in current upstream.
    if (hasSkillsRef) {
      const skills = readFileSync(skillsPath, "utf8");
      expect(skills).toContain("/public/mt-roots");
      expect(skills).toContain("/public/mt-leaves");
      expect(skills).toContain("onchainMtRoot");
    }
  });
});
