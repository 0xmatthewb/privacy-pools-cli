import { describe } from "bun:test";
import { registerAccountReadonlyCommandHandlerHarness } from "../helpers/account-readonly-command-handlers.harness.ts";
import { registerReadonlyAccountsTests } from "../helpers/account-readonly-command-handlers.accounts.groups.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("accounts command readonly", () => {
  registerReadonlyAccountsTests();
});
