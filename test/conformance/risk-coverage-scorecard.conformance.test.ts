import { describe, expect, test } from "bun:test";
import { RISK_COVERAGE_SCORECARD } from "../../scripts/lib/coverage-policy.mjs";

describe("risk coverage scorecard conformance", () => {
  test("keeps the six world-class risk targets pinned", () => {
    expect(RISK_COVERAGE_SCORECARD).toEqual([
      { label: "workflow", path: "src/services/workflow.ts", target: 90 },
      { label: "withdraw", path: "src/commands/withdraw.ts", target: 90 },
      { label: "init", path: "src/commands/init.ts", target: 90 },
      { label: "ragequit", path: "src/commands/ragequit.ts", target: 90 },
      { label: "account", path: "src/services/account.ts", target: 90 },
      { label: "relayer", path: "src/services/relayer.ts", target: 90 },
    ]);
  });
});
