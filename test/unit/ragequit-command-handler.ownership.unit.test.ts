import { describe } from "bun:test";
import {
  registerRagequitCommandHandlerHarness,
  registerRagequitOwnershipTests,
} from "../helpers/ragequit-command-handler.harness.ts";

registerRagequitCommandHandlerHarness();

describe("ragequit command handler ownership", () => {
  registerRagequitOwnershipTests();
});
