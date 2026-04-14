import { describe } from "bun:test";
import { registerWorkflowMockedHarness } from "../helpers/workflow-mocked.harness.ts";
import { registerWorkflowMockedStartTests } from "../helpers/workflow-mocked.start.groups.ts";

describe("workflow service mocked start coverage", () => {
  registerWorkflowMockedHarness();
  registerWorkflowMockedStartTests();
});
