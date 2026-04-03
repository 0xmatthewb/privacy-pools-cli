import { describe } from "bun:test";
import {
  registerInitCommandInteractiveHarness,
  registerInitGenerateBackupTests,
} from "../helpers/init-command-interactive.harness.ts";

registerInitCommandInteractiveHarness();

describe("init command interactive generate and backup", () => {
  registerInitGenerateBackupTests();
});
