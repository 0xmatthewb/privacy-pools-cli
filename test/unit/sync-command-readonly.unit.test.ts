import { describe } from "bun:test";
import {
  registerAccountReadonlyCommandHandlerHarness,
  registerReadonlySyncTests,
} from "../helpers/account-readonly-command-handlers.harness.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("sync command readonly", () => {
  registerReadonlySyncTests();
});
