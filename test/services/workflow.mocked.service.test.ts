import { describe } from "bun:test";
import { registerWorkflowMockedHarness } from "../helpers/workflow-mocked.harness.ts";
import { registerWorkflowMockedStartTests } from "../helpers/workflow-mocked.start.groups.ts";
import { registerWorkflowMockedWatchLifecycleTests } from "../helpers/workflow-mocked.watch-lifecycle.groups.ts";
import { registerWorkflowMockedWatchWithdrawTests } from "../helpers/workflow-mocked.watch-withdraw.groups.ts";
import { registerWorkflowMockedRagequitTests } from "../helpers/workflow-mocked.ragequit.groups.ts";
import { registerWorkflowMockedInteractiveTests } from "../helpers/workflow-mocked.interactive.groups.ts";

describe("workflow service mocked coverage", () => {
  registerWorkflowMockedHarness();
  registerWorkflowMockedStartTests();
  registerWorkflowMockedWatchLifecycleTests();
  registerWorkflowMockedWatchWithdrawTests();
  registerWorkflowMockedRagequitTests();
  registerWorkflowMockedInteractiveTests();
});
