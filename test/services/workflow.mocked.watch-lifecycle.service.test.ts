import { describe } from "bun:test";
import { registerWorkflowMockedHarness } from "../helpers/workflow-mocked.harness.ts";
import { registerWorkflowMockedWatchLifecycleTests } from "../helpers/workflow-mocked.watch-lifecycle.groups.ts";

describe("workflow service mocked watch lifecycle coverage", () => {
  registerWorkflowMockedHarness();
  registerWorkflowMockedWatchLifecycleTests();
});
