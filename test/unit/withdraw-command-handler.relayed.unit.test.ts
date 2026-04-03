import { describe } from "bun:test";
import {
  registerWithdrawCommandHandlerHarness,
  registerWithdrawRelayedFailureAndTimeoutTests,
  registerWithdrawRelayedMidCompletionTests,
  registerWithdrawRelayedPreludeTests,
  registerWithdrawRelayedQuoteRefreshPreludeTests,
  registerWithdrawRelayedQuoteRefreshTests,
  registerWithdrawRelayedUnsignedAndSubmitTests,
} from "../helpers/withdraw-command-handler.harness.ts";

registerWithdrawCommandHandlerHarness();

describe("withdraw command handler relayed", () => {
  registerWithdrawRelayedPreludeTests();
  registerWithdrawRelayedUnsignedAndSubmitTests();
  registerWithdrawRelayedMidCompletionTests();
  registerWithdrawRelayedQuoteRefreshPreludeTests();
  registerWithdrawRelayedFailureAndTimeoutTests();
  registerWithdrawRelayedQuoteRefreshTests();
});
