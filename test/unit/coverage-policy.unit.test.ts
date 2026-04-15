import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COVERAGE_THRESHOLDS,
  collectCoverageScorecard,
  collectExecutableCoverageLines,
  createCoverageExcludedSources,
  evaluateCoveragePolicy,
  normalizeCoveragePath,
} from "../../scripts/lib/coverage-policy.mjs";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

afterEach(() => {
  cleanupTrackedTempDirs();
});

describe("coverage policy", () => {
  test("coverage thresholds keep the enforced repo buckets and minima", () => {
    expect(COVERAGE_THRESHOLDS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "overall-src", min: 85 }),
        expect.objectContaining({ label: "services", min: 85 }),
        expect.objectContaining({ label: "workflow-engine", min: 85 }),
        expect.objectContaining({ label: "commands", min: 85 }),
        expect.objectContaining({ label: "utils", min: 85 }),
        expect.objectContaining({ label: "output", min: 85 }),
        expect.objectContaining({ label: "command-shells", min: 85 }),
        expect.objectContaining({ label: "bootstrap", min: 85 }),
        expect.objectContaining({ label: "launcher-runtime", min: 85 }),
        expect.objectContaining({
          label: "config",
          min: 95,
          matchers: ["src/config/"],
        }),
      ]),
    );
  });

  test("excluded coverage sources stay limited to generated runtime artifacts", () => {
    const excludedSources = createCoverageExcludedSources(process.cwd());

    expect(
      excludedSources.has(
        normalizeCoveragePath(
          resolve(process.cwd(), "src/utils/command-manifest.ts"),
        ),
      ),
    ).toBe(true);
    expect(
      excludedSources.has(
        normalizeCoveragePath(
          resolve(process.cwd(), "src/services/circuit-checksums.js"),
        ),
      ),
    ).toBe(true);
    expect(
      excludedSources.has(
        normalizeCoveragePath(resolve(process.cwd(), "src/types.ts")),
      ),
    ).toBe(true);
    expect(
      excludedSources.has(
        normalizeCoveragePath(
          resolve(process.cwd(), "src/static-discovery/types.ts"),
        ),
      ),
    ).toBe(true);
    expect(
      excludedSources.has(
        normalizeCoveragePath(resolve(process.cwd(), "src/services/pools.ts")),
      ),
    ).toBe(false);
  });

  test("bootstrap threshold keeps static discovery helpers in the same bucket", () => {
    const bootstrapThreshold = COVERAGE_THRESHOLDS.find(
      (threshold) => threshold.label === "bootstrap",
    );

    expect(bootstrapThreshold).toMatchObject({
      label: "bootstrap",
      min: 85,
    });
    expect(bootstrapThreshold?.matchers).toContain("src/static-discovery.ts");
    expect(bootstrapThreshold?.matchers).toContain("src/static-discovery/");
  });

  test("coverage evaluation flags uninstrumented executable files but ignores excluded artifacts", () => {
    const rootDir = createTrackedTempDir("pp-coverage-policy-");
    mkdirSync(join(rootDir, "src", "utils"), { recursive: true });
    writeFileSync(join(rootDir, "src", "covered.ts"), "export const ok = 1;\n");
    writeFileSync(join(rootDir, "src", "missed.ts"), "export const missed = 1;\n");
    writeFileSync(
      join(rootDir, "src", "utils", "command-manifest.ts"),
      "export const generated = 1;\n",
    );

    const coverageMap = new Map([
      [
        normalizeCoveragePath(resolve(rootDir, "src", "covered.ts")),
        new Map([[1, 1]]),
      ],
    ]);

    const evaluation = evaluateCoveragePolicy({
      rootDir,
      coverageMap,
      thresholds: [{ label: "overall-src", min: 0, matchers: ["src/"] }],
    });

    expect(evaluation.failures).toContain(
      "1 executable src file(s) were missing from LCOV instrumentation",
    );
    expect(evaluation.uninstrumentedSources).toEqual([
      normalizeCoveragePath(resolve(rootDir, "src", "missed.ts")),
    ]);
    expect(evaluation.thresholdResults[0]).toMatchObject({
      label: "overall-src",
      failure: null,
      stats: {
        linesFound: 1,
        linesHit: 1,
        percent: 100,
      },
    });
  });

  test("risk scorecards ignore TypeScript declaration and comment-only lines", () => {
    const rootDir = createTrackedTempDir("pp-coverage-scorecard-");
    const sourcePath = join(rootDir, "src", "commands", "withdraw.ts");
    mkdirSync(join(rootDir, "src", "commands"), { recursive: true });
    writeFileSync(
      sourcePath,
      [
        "interface HelperOptions {",
        "  asset: string;",
        "}",
        "",
        "// Human guidance copy.",
        "export function run(value: string) {",
        "  if (value === \"ok\") {",
        "    return true;",
        "  }",
        "  return false;",
        "}",
        "type Result =",
        "  | { ok: true }",
        "  | { ok: false };",
      ].join("\n"),
    );

    expect([...collectExecutableCoverageLines(sourcePath)]).toEqual([
      6,
      7,
      8,
      10,
    ]);

    const coverageMap = new Map([
      [
        normalizeCoveragePath(resolve(sourcePath)),
        new Map([
          [1, 0],
          [2, 0],
          [3, 0],
          [4, 0],
          [5, 0],
          [6, 1],
          [7, 1],
          [8, 1],
          [9, 0],
          [10, 0],
          [11, 0],
          [12, 0],
          [13, 0],
          [14, 0],
        ]),
      ],
    ]);

    expect(
      collectCoverageScorecard(
        coverageMap,
        [{ label: "withdraw", path: "src/commands/withdraw.ts", target: 70 }],
        { rootDir },
      ),
    ).toEqual([
      expect.objectContaining({
        label: "withdraw",
        total: 4,
        hit: 3,
        percent: 75,
        belowTarget: false,
      }),
    ]);
  });
});
