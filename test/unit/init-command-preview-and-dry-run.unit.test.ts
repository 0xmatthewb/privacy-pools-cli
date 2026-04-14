import { describe } from "bun:test";
import {
  registerInitCommandInteractiveHarness,
  registerInitDryRunAndPreviewTests,
} from "../helpers/init-command-interactive.harness.ts";

registerInitCommandInteractiveHarness();

describe("init command dry-run and preview", () => {
  registerInitDryRunAndPreviewTests();
});
