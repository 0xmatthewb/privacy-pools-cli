import { describe } from "bun:test";
import {
  registerAccountReadonlyCommandHandlerHarness,
  registerReadonlyAccountsTests,
} from "../helpers/account-readonly-command-handlers.harness.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("accounts command readonly", () => {
  registerReadonlyAccountsTests();
});
