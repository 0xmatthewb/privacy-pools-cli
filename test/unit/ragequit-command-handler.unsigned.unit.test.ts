import { describe } from "bun:test";
import {
  registerRagequitCommandHandlerHarness,
  registerRagequitUnsignedTests,
} from "../helpers/ragequit-command-handler.harness.ts";

registerRagequitCommandHandlerHarness();

describe("ragequit command handler unsigned", () => {
  registerRagequitUnsignedTests();
});
