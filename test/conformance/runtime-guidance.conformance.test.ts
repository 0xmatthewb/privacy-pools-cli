import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLI_ROOT } from "../helpers/paths.ts";
import {
  rootHelpBaseText,
  rootHelpText,
} from "../../src/utils/root-help.ts";

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

describe("runtime guidance conformance", () => {
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

  test("runtime boundary profile keeps the explicit unsupported-bun suite", () => {
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
