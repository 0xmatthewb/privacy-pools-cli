import { describe } from "bun:test";
import {
  registerRagequitCommandHandlerHarness,
  registerRagequitEntrySubmitCompletionTests,
  registerRagequitEntrySubmitTests,
} from "../helpers/ragequit-command-handler.harness.ts";

registerRagequitCommandHandlerHarness();

describe("ragequit command handler entry and submit", () => {
  registerRagequitEntrySubmitTests();
  registerRagequitEntrySubmitCompletionTests();
});
