import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  rootHelpBaseText,
  rootHelpText,
} from "../../src/utils/root-help.ts";

const README_PATH = join(CLI_ROOT, "README.md");
const AGENTS_PATH = join(CLI_ROOT, "AGENTS.md");
const REFERENCE_PATH = join(CLI_ROOT, "docs", "reference.md");
const RUNTIME_UPGRADES_PATH = join(CLI_ROOT, "docs", "runtime-upgrades.md");
const NATIVE_MANIFEST_PATH = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "manifest.json",
);

function expectNoBunRuntimeGuidance(text: string): void {
  expect(text).not.toMatch(/\bbun\b/i);
}

describe("runtime guidance conformance", () => {
  test("runtime-facing docs omit bun install or execution guidance", () => {
    expectNoBunRuntimeGuidance(readFileSync(README_PATH, "utf8"));
    expectNoBunRuntimeGuidance(readFileSync(AGENTS_PATH, "utf8"));
    expectNoBunRuntimeGuidance(readFileSync(RUNTIME_UPGRADES_PATH, "utf8"));
  });

  test("root help and packaged guide stay node-only", () => {
    expectNoBunRuntimeGuidance(rootHelpBaseText());
    expectNoBunRuntimeGuidance(rootHelpText());

    const manifest = JSON.parse(readFileSync(NATIVE_MANIFEST_PATH, "utf8")) as {
      rootHelp: string;
      guideHumanText: string;
    };

    expectNoBunRuntimeGuidance(manifest.rootHelp);
    expectNoBunRuntimeGuidance(manifest.guideHumanText);
  });

  test("generated reference keeps bun out of user-facing command guidance", () => {
    const reference = readFileSync(REFERENCE_PATH, "utf8");
    const runtimeFacingSections =
      reference.split("### Runtime Requirements")[0] ?? reference;

    expectNoBunRuntimeGuidance(runtimeFacingSections);
  });
});
