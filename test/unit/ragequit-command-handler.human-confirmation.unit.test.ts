import { describe } from "bun:test";
import {
  registerRagequitCommandHandlerHarness,
  registerRagequitHumanConfirmationTests,
} from "../helpers/ragequit-command-handler.harness.ts";

registerRagequitCommandHandlerHarness();

describe("ragequit command handler human confirmation", () => {
  registerRagequitHumanConfirmationTests();
});
