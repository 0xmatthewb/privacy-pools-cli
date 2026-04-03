import { describe } from "bun:test";
import {
  registerWithdrawCommandHandlerHarness,
  registerWithdrawValidationAccountSelectionTests,
  registerWithdrawValidationPostQuoteTests,
  registerWithdrawValidationPreludeTests,
} from "../helpers/withdraw-command-handler.harness.ts";

registerWithdrawCommandHandlerHarness();

describe("withdraw command handler validation", () => {
  registerWithdrawValidationPreludeTests();
  registerWithdrawValidationAccountSelectionTests();
  registerWithdrawValidationPostQuoteTests();
});
