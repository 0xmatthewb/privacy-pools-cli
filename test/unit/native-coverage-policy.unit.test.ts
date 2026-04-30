import { describe, expect, test } from "bun:test";
import {
  classifyNativeCoverageSources,
  NATIVE_COVERAGE_DIAGNOSTICS,
  NATIVE_COVERAGE_FAMILIES,
  NATIVE_COVERAGE_EXCLUDED_SOURCES,
} from "../../scripts/lib/native-coverage-policy.mjs";

describe("native coverage policy", () => {
  test("classifies executable native sources into exactly one ownership family", () => {
    const sampleSources = [
      "native/shell/src/root_argv.rs",
      "native/shell/src/completion.rs",
      "native/shell/src/routing.rs",
      "native/shell/src/bridge.rs",
      "native/shell/src/dispatch.rs",
      "native/shell/src/main.rs",
      "native/shell/src/config.rs",
      "native/shell/src/contract.rs",
      "native/shell/src/error.rs",
      "native/shell/src/http_client.rs",
      "native/shell/src/json.rs",
      "native/shell/src/known_addresses.rs",
      "native/shell/src/output.rs",
      "native/shell/src/read_only_api.rs",
      "native/shell/src/commands/pools/activity/mod.rs",
      "native/shell/src/commands/pools/activity/render.rs",
      "native/shell/src/commands/pools/stats.rs",
      "native/shell/src/commands/pools/query.rs",
      "native/shell/src/commands/pools/rpc_transport.rs",
      "native/shell/src/test_env.rs",
    ];

    const ownership = classifyNativeCoverageSources(sampleSources);

    expect(ownership.unmatched).toEqual([]);
    expect(ownership.multiplyMatched).toEqual([]);
    expect(ownership.matched.get("native/shell/src/root_argv.rs")).toBe(
      "native-root-argv",
    );
    expect(ownership.matched.get("native/shell/src/known_addresses.rs")).toBe(
      "native-core-utils",
    );
    expect(ownership.matched.get("native/shell/src/commands/pools/activity/mod.rs")).toBe(
      "native-activity",
    );
    expect(ownership.matched.get("native/shell/src/commands/pools/query.rs")).toBe(
      "native-pools",
    );
  });

  test("keeps test-only helper sources out of the ownership gate", () => {
    expect(NATIVE_COVERAGE_EXCLUDED_SOURCES).toContain(
      "native/shell/src/test_env.rs",
    );
    const ownership = classifyNativeCoverageSources([
      "native/shell/src/test_env.rs",
    ]);
    expect(ownership.matched.size).toBe(0);
    expect(ownership.unmatched).toEqual([]);
    expect(ownership.multiplyMatched).toEqual([]);
  });

  test("enforces pools ownership while keeping diagnostic breakdowns", () => {
    const poolsFamily = NATIVE_COVERAGE_FAMILIES.find(
      (family) => family.label === "native-pools",
    );
    expect(poolsFamily?.enforced).toBe(true);
    expect(
      NATIVE_COVERAGE_DIAGNOSTICS.some(
        (diagnostic) => diagnostic.label === "native-pools-query",
      ),
    ).toBe(true);
    expect(
      NATIVE_COVERAGE_DIAGNOSTICS.some(
        (diagnostic) => diagnostic.label === "native-pools-rpc",
      ),
    ).toBe(true);
  });
});
