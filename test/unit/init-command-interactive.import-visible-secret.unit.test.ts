import { describe } from "bun:test";
import {
  registerInitCommandInteractiveHarness,
  registerInitImportVisibleSecretTests,
} from "../helpers/init-command-interactive.harness.ts";

registerInitCommandInteractiveHarness();

describe("init command interactive import and visible secret", () => {
  registerInitImportVisibleSecretTests();
});
