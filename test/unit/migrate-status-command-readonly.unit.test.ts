import { describe } from "bun:test";
import {
  registerAccountReadonlyCommandHandlerHarness,
  registerReadonlyMigrateStatusTests,
} from "../helpers/account-readonly-command-handlers.harness.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("migrate status command readonly", () => {
  registerReadonlyMigrateStatusTests();
});
