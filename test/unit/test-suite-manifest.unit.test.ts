import { describe, expect, test } from "bun:test";
import {
  ALL_MANIFEST_SUITES,
  QUARANTINED_SUITES,
  COVERAGE_ISOLATED_SUITES,
  ON_DEMAND_TAG_SUITES,
  STABLE_SUITE_TAXONOMY,
} from "../../scripts/test-suite-manifest.mjs";

describe("test suite manifest", () => {
  test("on-demand, isolated, and quarantined suites carry tags, fixture classes, and runtime budgets", () => {
    const suites = [
      ...ON_DEMAND_TAG_SUITES,
      ...COVERAGE_ISOLATED_SUITES,
      ...QUARANTINED_SUITES,
    ];

    expect(suites.length).toBeGreaterThan(0);
    for (const suite of suites) {
      expect(Array.isArray(suite.tags)).toBe(true);
      expect(suite.tags.length).toBeGreaterThan(0);
      expect(typeof suite.fixtureClass).toBe("string");
      expect(suite.fixtureClass.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(suite.budgetMs)).toBe(true);
    }
  });

  test("manifest labels remain unique across non-main suites", () => {
    const labels = ALL_MANIFEST_SUITES.map((suite) => suite.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("quarantined suites are explicitly tagged when present", () => {
    for (const suite of QUARANTINED_SUITES) {
      expect(suite.tags).toContain("quarantined");
    }
  });

  test("expensive and isolated suites carry stable taxonomy tags", () => {
    const stableTags = new Set(STABLE_SUITE_TAXONOMY);

    for (const suite of [...ON_DEMAND_TAG_SUITES, ...COVERAGE_ISOLATED_SUITES]) {
      expect(suite.tags.some((tag) => stableTags.has(tag))).toBe(true);
    }
  });

  test("on-demand suites declare a primary execution lane tag", () => {
    const expectedLaneTags = new Set(["integration", "services"]);

    for (const suite of ON_DEMAND_TAG_SUITES) {
      expect(
        suite.tags.some((tag) => expectedLaneTags.has(tag)),
      ).toBe(true);
    }
  });

  test("isolated suites declare a primary test-layer tag", () => {
    const expectedLayerTags = new Set(["unit", "services"]);

    for (const suite of COVERAGE_ISOLATED_SUITES) {
      expect(
        suite.tags.some((tag) => expectedLayerTags.has(tag)),
      ).toBe(true);
    }
  });
});
