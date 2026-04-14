import { describe } from "bun:test";
import { registerWorkflowMockedHarness } from "../helpers/workflow-mocked.harness.ts";
import { registerWorkflowMockedWatchWithdrawTests } from "../helpers/workflow-mocked.watch-withdraw.groups.ts";

describe("workflow service mocked watch withdraw coverage", () => {
  registerWorkflowMockedHarness();
  registerWorkflowMockedWatchWithdrawTests();
});
