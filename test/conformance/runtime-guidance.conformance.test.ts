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
const CLAUDE_PATH = join(CLI_ROOT, "CLAUDE.md");
const CHANGELOG_PATH = join(CLI_ROOT, "CHANGELOG.md");
const REFERENCE_PATH = join(CLI_ROOT, "docs", "reference.md");
const RUNTIME_UPGRADES_PATH = join(CLI_ROOT, "docs", "runtime-upgrades.md");
const SKILL_PATH = join(CLI_ROOT, "skills", "privacy-pools-cli", "SKILL.md");
const SKILL_REFERENCE_PATH = join(
  CLI_ROOT,
  "skills",
  "privacy-pools-cli",
  "reference.md",
);
const NATIVE_MANIFEST_PATH = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "manifest.json",
);

function expectNoBunRuntimeCommands(text: string): void {
  const forbiddenPatterns = [
    /\bbun add -g\b/i,
    /\bbun install\b/i,
    /\bbun run (?:dev|start|build|typecheck|docs:(?:generate|check|preview))\b/i,
    /\bbun\s+(?:src\/index\.ts|dist\/index\.js)\b/i,
    /\bBun global installs\b/i,
  ];

  for (const pattern of forbiddenPatterns) {
    expect(text).not.toMatch(pattern);
  }
}

function expectNoBunInstallOrVerificationCommands(text: string): void {
  const forbiddenPatterns = [
    /\bbun add -g\b/i,
    /\bbun install\b/i,
    /\bbun run\b/i,
    /\bbun test\b/i,
  ];

  for (const pattern of forbiddenPatterns) {
    expect(text).not.toMatch(pattern);
  }
}

function expectNoMaintainerBunRuntimeCommands(text: string): void {
  const forbiddenPatterns = [
    /bun install/i,
    /bun run build/i,
    /bun run dev/i,
    /bun run start/i,
    /bun run typecheck/i,
    /bun run docs:(?:generate|check|preview)/i,
    /uses bun\.lock/i,
  ];

  for (const pattern of forbiddenPatterns) {
    expect(text).not.toMatch(pattern);
  }
}

describe("runtime guidance conformance", () => {
  test("runtime-facing docs omit bun install or execution guidance", () => {
    expectNoBunRuntimeCommands(readFileSync(README_PATH, "utf8"));
    expectNoBunRuntimeCommands(readFileSync(AGENTS_PATH, "utf8"));
    expectNoBunRuntimeCommands(readFileSync(RUNTIME_UPGRADES_PATH, "utf8"));
    expectNoBunRuntimeCommands(readFileSync(SKILL_PATH, "utf8"));
    expectNoBunRuntimeCommands(readFileSync(SKILL_REFERENCE_PATH, "utf8"));
  });

  test("repo contributor docs keep build and runtime guidance node-only", () => {
    expectNoMaintainerBunRuntimeCommands(readFileSync(CLAUDE_PATH, "utf8"));
  });

  test("root help and packaged guide stay node-only", () => {
    expectNoBunRuntimeCommands(rootHelpBaseText());
    expectNoBunRuntimeCommands(rootHelpText());

    const manifest = JSON.parse(readFileSync(NATIVE_MANIFEST_PATH, "utf8")) as {
      rootHelp: string;
      guideHumanText: string;
      capabilitiesHumanText?: string;
      commandHelp?: Record<string, string>;
    };

    expectNoBunRuntimeCommands(manifest.rootHelp);
    expectNoBunRuntimeCommands(manifest.guideHumanText);
    expectNoBunRuntimeCommands(manifest.capabilitiesHumanText ?? "");

    for (const helpText of Object.values(manifest.commandHelp ?? {})) {
      expectNoBunRuntimeCommands(helpText);
    }
  });

  test("generated reference keeps bun out of user-facing command guidance", () => {
    const reference = readFileSync(REFERENCE_PATH, "utf8");
    const runtimeFacingSections =
      reference.split("### Runtime Requirements")[0] ?? reference;

    expectNoBunRuntimeCommands(runtimeFacingSections);
  });

  test("shipped changelog omits bun-based install and verification commands", () => {
    expectNoBunInstallOrVerificationCommands(readFileSync(CHANGELOG_PATH, "utf8"));
  });

  test("runtime boundary profile includes the explicit unsupported-Bun integration suite", () => {
    const packageJson = JSON.parse(
      readFileSync(join(CLI_ROOT, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:runtime:boundary"]).toContain(
      "scripts/run-test-suite.mjs",
    );
    expect(packageJson.scripts?.["test:runtime:boundary"]).toContain(
      "./test/integration/cli-bun-runtime.integration.test.ts",
    );
    expect(packageJson.scripts?.["test:runtime:boundary"]).toContain(
      "./test/unit/launcher-runtime.unit.test.ts",
    );
  });
});
