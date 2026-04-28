import { describe, expect, test } from "bun:test";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRootProgram } from "../../src/program.ts";
import { guideText } from "../../src/utils/help.ts";
import {
  rootHelpBaseText,
  rootHelpFooter,
  rootHelpFooterPlain,
  rootHelpText,
  styleCommanderHelp,
} from "../../src/utils/root-help.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

const NATIVE_MANIFEST_PATH = join(
  CLI_ROOT,
  "native",
  "shell",
  "generated",
  "manifest.json",
);
const README_PATH = join(CLI_ROOT, "README.md");
const AGENT_GUIDE_PATH = join(CLI_ROOT, "AGENTS.md");
const MAN_PAGE_PATH = join(CLI_ROOT, "docs", "man", "privacy-pools.1");

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

function readmeRootCommands(): string[] {
  const text = readFileSync(README_PATH, "utf8");
  const section = text.match(/^## Commands\n([\s\S]*?)(?:\n## |\n$)/m)?.[1] ?? "";
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)]
    .map((match) => match[1])
    .sort();
}

function manRootCommands(): string[] {
  const text = readFileSync(MAN_PAGE_PATH, "utf8");
  const section = text.match(/^\.SH COMMANDS\n([\s\S]*?)^\.SH GLOBAL OPTIONS/m)?.[1] ?? "";
  return [...section.matchAll(/^\.B (.+)$/gm)]
    .map((match) => match[1].replace(/\\-/g, "-").trim())
    .filter((command) => command && !command.includes(" "))
    .sort();
}

describe("root help static conformance", () => {
  test("static root help text matches the live commander root help", async () => {
    const program = await createRootProgram("0.0.0");
    const liveBaseHelp = program.helpInformation().trimEnd();

    expect(rootHelpBaseText()).toBe(liveBaseHelp);
    expect(rootHelpText()).toBe(`${liveBaseHelp}\n${rootHelpFooterPlain()}`);
  });

  test("native manifest root help stays aligned with the current static help source", () => {
    const originalLevel = chalk.level;
    chalk.level = 3;
    const manifest = JSON.parse(readFileSync(NATIVE_MANIFEST_PATH, "utf8")) as {
      rootHelp: string;
      structuredRootHelp: string;
    };

    try {
      expect(stripAnsi(manifest.rootHelp)).toBe(
        stripAnsi(`${styleCommanderHelp(rootHelpBaseText())}\n${rootHelpFooter()}`),
      );
      expect(manifest.structuredRootHelp).toBe(rootHelpText());
    } finally {
      chalk.level = originalLevel;
    }
  });

  test("styled root help footer pads command groups without collisions", () => {
    const styledRootHelp = stripAnsi(styleCommanderHelp(rootHelpBaseText()));
    expect(styledRootHelp).toContain("  Getting started");
    expect(styledRootHelp).toContain("  Transactions");
    expect(styledRootHelp).not.toContain("Getting startedinit");
    expect(styledRootHelp).not.toContain("Transactionsflow");
  });

  test("README and man page enumerate every runtime root command", async () => {
    const program = await createRootProgram("0.0.0", { styledHelp: false });
    const runtimeRootCommands = program.commands.map((command) => command.name()).sort();

    expect(readmeRootCommands()).toEqual(runtimeRootCommands);
    expect(manRootCommands()).toEqual(runtimeRootCommands);
  });

  test("runtime-facing docs and help stay free of Bun install or execution examples", () => {
    const forbiddenRuntimeExamples = [
      "bun add -g privacy-pools-cli",
      "bun src/index.ts",
      "bun run src/index.ts",
      "bunx privacy-pools-cli",
    ];

    const runtimeFacingTexts = [
      readFileSync(README_PATH, "utf8"),
      readFileSync(AGENT_GUIDE_PATH, "utf8"),
      rootHelpBaseText(),
      rootHelpText(),
      guideText(),
    ];

    for (const text of runtimeFacingTexts) {
      for (const pattern of forbiddenRuntimeExamples) {
        expect(text).not.toContain(pattern);
      }
    }
  });
});
