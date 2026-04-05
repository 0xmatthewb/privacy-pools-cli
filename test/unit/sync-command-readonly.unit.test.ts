import { describe } from "bun:test";
import { registerAccountReadonlyCommandHandlerHarness } from "../helpers/account-readonly-command-handlers.harness.ts";
import { registerReadonlySyncTests } from "../helpers/account-readonly-command-handlers.sync.groups.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("sync command readonly", () => {
  registerReadonlySyncTests();
});
