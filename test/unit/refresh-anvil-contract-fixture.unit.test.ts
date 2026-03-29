import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  refreshAnvilContractFixture,
  REQUIRED_UPSTREAM_ARTIFACTS,
  TEST_TOKEN_ARTIFACT_DESTINATION,
} from "../../scripts/refresh-anvil-contract-fixture.mjs";
import { createTrackedTempDir } from "../helpers/temp.ts";

const tempRoots: string[] = [];

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
      } else {
        files.push(relative(root, absolutePath).replaceAll("\\", "/"));
      }
    }
  }

  return files.sort();
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop()!, { recursive: true, force: true });
  }
});

describe("refresh anvil contract fixture", () => {
  test("copies the required upstream artifact set into the fixture layout", () => {
    const root = createTrackedTempDir("pp-anvil-fixture-");
    tempRoots.push(root);

    const contractsRoot = join(root, "contracts");
    const fixtureRoot = join(root, "fixture");

    for (const artifact of REQUIRED_UPSTREAM_ARTIFACTS) {
      writeJson(join(contractsRoot, artifact.source), {
        contractName: artifact.destination,
      });
    }

    refreshAnvilContractFixture({
      contractsRoot,
      fixtureRoot,
      buildMintableUsdTokenArtifactImpl: () => ({
        contractName: "MintableUsdToken",
      }),
    });

    const expectedFiles = [
      ...REQUIRED_UPSTREAM_ARTIFACTS.map((artifact) => artifact.destination),
      TEST_TOKEN_ARTIFACT_DESTINATION,
    ].sort();

    expect(listFiles(fixtureRoot)).toEqual(expectedFiles);

    for (const artifact of REQUIRED_UPSTREAM_ARTIFACTS) {
      const destinationPath = join(fixtureRoot, artifact.destination);
      expect(existsSync(destinationPath)).toBe(true);
      expect(JSON.parse(readFileSync(destinationPath, "utf8"))).toEqual({
        contractName: artifact.destination,
      });
    }

    expect(
      JSON.parse(
        readFileSync(join(fixtureRoot, TEST_TOKEN_ARTIFACT_DESTINATION), "utf8"),
      ),
    ).toEqual({
      contractName: "MintableUsdToken",
    });
  });

  test("fails closed when an expected upstream artifact is missing", () => {
    const root = createTrackedTempDir("pp-anvil-fixture-");
    tempRoots.push(root);

    const contractsRoot = join(root, "contracts");
    const fixtureRoot = join(root, "fixture");

    for (const artifact of REQUIRED_UPSTREAM_ARTIFACTS.slice(1)) {
      writeJson(join(contractsRoot, artifact.source), {
        contractName: artifact.destination,
      });
    }

    expect(() =>
      refreshAnvilContractFixture({
        contractsRoot,
        fixtureRoot,
        buildMintableUsdTokenArtifactImpl: () => ({
          contractName: "MintableUsdToken",
        }),
      }),
    ).toThrow(
      `${REQUIRED_UPSTREAM_ARTIFACTS[0]!.source} is missing at ${join(
        contractsRoot,
        REQUIRED_UPSTREAM_ARTIFACTS[0]!.source,
      )}`,
    );
  });
});
