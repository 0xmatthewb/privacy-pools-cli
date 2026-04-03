import { describe } from "bun:test";
import {
  registerAccountReadonlyCommandHandlerHarness,
  registerReadonlyHistoryTests,
} from "../helpers/account-readonly-command-handlers.harness.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("history command readonly", () => {
  registerReadonlyHistoryTests();
});
