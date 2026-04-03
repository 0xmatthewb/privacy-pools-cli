import { describe } from "bun:test";
import {
  registerWithdrawCommandHandlerHarness,
  registerWithdrawDirectCompletionTests,
  registerWithdrawDirectPostSaveTests,
  registerWithdrawDirectPreludeTests,
  registerWithdrawDirectUnsignedAndSubmitTests,
} from "../helpers/withdraw-command-handler.harness.ts";

registerWithdrawCommandHandlerHarness();

describe("withdraw command handler direct", () => {
  registerWithdrawDirectPreludeTests();
  registerWithdrawDirectUnsignedAndSubmitTests();
  registerWithdrawDirectCompletionTests();
  registerWithdrawDirectPostSaveTests();
});
