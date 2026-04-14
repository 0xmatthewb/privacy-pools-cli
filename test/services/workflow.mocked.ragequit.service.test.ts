import { describe } from "bun:test";
import { registerWorkflowMockedHarness } from "../helpers/workflow-mocked.harness.ts";
import { registerWorkflowMockedRagequitTests } from "../helpers/workflow-mocked.ragequit.groups.ts";

describe("workflow service mocked ragequit coverage", () => {
  registerWorkflowMockedHarness();
  registerWorkflowMockedRagequitTests();
});
