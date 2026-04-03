import { describe } from "bun:test";
import {
  registerInitCancelInvalidTests,
  registerInitCommandInteractiveHarness,
} from "../helpers/init-command-interactive.harness.ts";

registerInitCommandInteractiveHarness();

describe("init command interactive cancel and invalid", () => {
  registerInitCancelInvalidTests();
});
