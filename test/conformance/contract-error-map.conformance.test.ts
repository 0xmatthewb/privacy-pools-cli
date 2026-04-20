/**
 * Contract error classification conformance.
 *
 * The CLI maps onchain revert reasons (e.g. NullifierAlreadySpent,
 * PrecommitmentAlreadyUsed) to user-friendly error messages.  If the
 * upstream contracts rename or remove a revert reason, the CLI silently
 * falls back to a generic "UNKNOWN_ERROR", hiding actionable information
 * from the user.
 *
 * This test verifies every key in CONTRACT_ERROR_MAP exists in at least
 * one upstream Solidity interface file.
 *
 * @online
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "bun:test";
import { CORE_REPO, fetchGitHubFile } from "../helpers/github.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

// Read CLI error map keys at module load time
const errorsSource = readFileSync(
  `${CLI_ROOT}/src/utils/errors.ts`,
  "utf8"
);

// Extract all keys from CONTRACT_ERROR_MAP
const keyPattern = /^\s+(\w+):\s*\{/gm;
const errorMapKeys: string[] = [];
// Find the CONTRACT_ERROR_MAP block first
const mapMatch = errorsSource.match(
  /const CONTRACT_ERROR_MAP[^{]*\{([\s\S]*?)\n\};/
);
if (mapMatch) {
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(mapMatch[1])) !== null) {
    errorMapKeys.push(match[1]);
  }
}

let upstreamIPrivacyPool = "";
let upstreamIEntrypoint = "";
let upstreamIState = "";
let fetchFailed = false;

describe("contract error classification conformance", () => {
  beforeAll(async () => {
    try {
      [upstreamIPrivacyPool, upstreamIEntrypoint, upstreamIState] =
        await Promise.all([
          fetchGitHubFile(
            CORE_REPO,
            "packages/contracts/src/interfaces/IPrivacyPool.sol"
          ),
          fetchGitHubFile(
            CORE_REPO,
            "packages/contracts/src/interfaces/IEntrypoint.sol"
          ),
          fetchGitHubFile(
            CORE_REPO,
            "packages/contracts/src/interfaces/IState.sol"
          ),
        ]);
    } catch (err) {
      console.warn(
        "Skipping contract error map conformance — could not read source-of-truth files:",
        err
      );
      fetchFailed = true;
    }
  });

  test("CONTRACT_ERROR_MAP has entries to validate", () => {
    expect(errorMapKeys.length).toBeGreaterThanOrEqual(5);
  });

  test("source-of-truth reads succeeded (canary — all tests below are skipped if this fails)", () => {
    if (fetchFailed) {
      console.warn("WARN: source-of-truth reads failed — conformance tests are NOT running");
    }
    expect(fetchFailed).toBe(false);
  });

  test("every CONTRACT_ERROR_MAP key exists in upstream Solidity interfaces", () => {
    if (fetchFailed) return;

    const allUpstream =
      upstreamIPrivacyPool + upstreamIEntrypoint + upstreamIState;

    for (const key of errorMapKeys) {
      expect(allUpstream).toContain(key);
    }
  });
});
