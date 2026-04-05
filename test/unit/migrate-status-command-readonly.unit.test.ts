import { describe } from "bun:test";
import { registerAccountReadonlyCommandHandlerHarness } from "../helpers/account-readonly-command-handlers.harness.ts";
import { registerReadonlyMigrateStatusTests } from "../helpers/account-readonly-command-handlers.migrate.groups.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("migrate status command readonly", () => {
  registerReadonlyMigrateStatusTests();
});
