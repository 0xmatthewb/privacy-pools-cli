import { describe } from "bun:test";
import {
  registerWithdrawCommandHandlerHarness,
  registerWithdrawQuoteTests,
} from "../helpers/withdraw-command-handler.harness.ts";

registerWithdrawCommandHandlerHarness();

describe("withdraw command handler quote", () => {
  registerWithdrawQuoteTests();
});
