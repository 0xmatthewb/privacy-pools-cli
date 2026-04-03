import { describe } from "bun:test";
import {
  registerWithdrawCommandHandlerHarness,
  registerWithdrawInteractiveAssetSelectionTests,
  registerWithdrawInteractiveCompletionTests,
  registerWithdrawInteractiveReviewTests,
} from "../helpers/withdraw-command-handler.harness.ts";

registerWithdrawCommandHandlerHarness();

describe("withdraw command handler interactive", () => {
  registerWithdrawInteractiveReviewTests();
  registerWithdrawInteractiveAssetSelectionTests();
  registerWithdrawInteractiveCompletionTests();
});
