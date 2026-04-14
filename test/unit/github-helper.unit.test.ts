import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CORE_REPO,
  fetchGitHubFile,
  githubTestInternals,
} from "../helpers/github.ts";
import { cleanupTrackedTempDir, createTrackedTempDir } from "../helpers/temp.ts";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

describe("conformance source helper", () => {
  let tempRoot = "";

  beforeEach(() => {
    tempRoot = createTrackedTempDir("privacy-pools-conformance-");
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    globalThis.fetch = ORIGINAL_FETCH;
    githubTestInternals.clearCaches();
    githubTestInternals.resetExecFileSyncForTests();
    if (tempRoot) {
      cleanupTrackedTempDir(tempRoot);
    }
    mock.restore();
  });

  test("uses explicit local core checkout in strict local mode without network access", async () => {
    const coreRoot = resolve(tempRoot, "core");
    const targetPath = "packages/contracts/src/interfaces/IPrivacyPool.sol";
    mkdirSync(resolve(coreRoot, "packages/contracts/src/interfaces"), {
      recursive: true,
    });
    writeFileSync(resolve(coreRoot, targetPath), "interface IPrivacyPool {}");

    process.env.CONFORMANCE_CORE_ROOT = coreRoot;
    process.env.CONFORMANCE_REQUIRE_LOCAL_SOURCES = "1";

    const fetchSpy = mock(() => {
      throw new Error("network should not be used for strict local reads");
    });
    globalThis.fetch = fetchSpy as typeof fetch;

    await expect(fetchGitHubFile(CORE_REPO, targetPath)).resolves.toBe(
      "interface IPrivacyPool {}",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("cleans up temporary checkout directories when git fallback bootstrap fails", async () => {
    const repo = "octocat/example-repo";
    const targetPath = "packages/contracts/src/interfaces/IPrivacyPool.sol";
    let createdCheckoutDir = "";

    globalThis.fetch = mock(async () => {
      throw new Error("raw fetch unavailable");
    }) as typeof fetch;

    githubTestInternals.setExecFileSyncForTests(((file, args) => {
      expect(file).toBe("git");
      const gitArgs = args as readonly string[];
      if (gitArgs[0] === "init") {
        createdCheckoutDir = gitArgs[2] ?? "";
      }
      throw new Error("git bootstrap failed");
    }) as typeof import("node:child_process").execFileSync);

    await expect(fetchGitHubFile(repo, targetPath)).rejects.toThrow(
      "raw fetch unavailable",
    );

    expect(createdCheckoutDir).not.toBe("");
    expect(existsSync(createdCheckoutDir)).toBe(false);
    expect(githubTestInternals.getCachedCheckoutDirs()).toEqual([]);
  });
});
