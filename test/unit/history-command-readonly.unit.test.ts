import { describe } from "bun:test";
import { registerAccountReadonlyCommandHandlerHarness } from "../helpers/account-readonly-command-handlers.harness.ts";
import { registerReadonlyHistoryTests } from "../helpers/account-readonly-command-handlers.history.groups.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("history command readonly", () => {
  registerReadonlyHistoryTests();
});
