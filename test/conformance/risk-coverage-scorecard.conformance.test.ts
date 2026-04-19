import { describe, expect, test } from "bun:test";
import { RISK_COVERAGE_SCORECARD } from "../../scripts/lib/coverage-policy.mjs";

describe("risk coverage scorecard conformance", () => {
  test("keeps the high-risk feature bundle targets pinned", () => {
    expect(RISK_COVERAGE_SCORECARD).toEqual([
      {
        label: "workflow",
        paths: [
          "src/command-shells/flow.ts",
          "src/commands/flow.ts",
          "src/output/flow.ts",
          "src/services/workflow.ts",
        ],
        target: 90,
      },
      {
        label: "init",
        paths: [
          "src/command-shells/init.ts",
          "src/commands/init.ts",
          "src/output/init.ts",
        ],
        target: 90,
      },
      {
        label: "deposit",
        paths: [
          "src/command-shells/deposit.ts",
          "src/commands/deposit.ts",
          "src/output/deposit.ts",
        ],
        target: 90,
      },
      {
        label: "withdraw",
        paths: [
          "src/command-shells/withdraw.ts",
          "src/commands/withdraw.ts",
          "src/output/withdraw.ts",
        ],
        target: 90,
      },
      {
        label: "ragequit",
        paths: [
          "src/command-shells/ragequit.ts",
          "src/commands/ragequit.ts",
          "src/output/ragequit.ts",
        ],
        target: 90,
      },
      {
        label: "accounts",
        paths: [
          "src/command-shells/accounts.ts",
          "src/commands/accounts.ts",
          "src/output/accounts.ts",
          "src/services/account.ts",
        ],
        target: 90,
      },
      { label: "relayer-service", path: "src/services/relayer.ts", target: 90 },
    ]);
  });
});
