import { describe } from "bun:test";
import { registerWorkflowMockedHarness } from "../helpers/workflow-mocked.harness.ts";
import { registerWorkflowMockedInteractiveTests } from "../helpers/workflow-mocked.interactive.groups.ts";

describe("workflow service mocked interactive coverage", () => {
  registerWorkflowMockedHarness();
  registerWorkflowMockedInteractiveTests();
});
