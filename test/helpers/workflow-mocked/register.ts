import { afterAll, afterEach, beforeAll, beforeEach, mock } from "bun:test";
import {
  cleanupWorkflowMockEnvironment,
  installWorkflowMocks,
  resetWorkflowMockImplementations,
} from "./runtime.ts";
import { restoreTestTty, setTestTty } from "../tty.ts";

export function registerWorkflowMockedHarness(): void {
  beforeAll(async () => {
    try {
      await installWorkflowMocks();
    } catch (error) {
      cleanupWorkflowMockEnvironment();
      mock.restore();
      throw error;
    }
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    setTestTty();
    resetWorkflowMockImplementations();
  });

  afterEach(() => {
    restoreTestTty();
    cleanupWorkflowMockEnvironment();
  });
}
