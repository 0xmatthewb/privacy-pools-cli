import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  allNonOptionTokens,
  firstNonOptionToken,
  hasLongFlag,
  hasShortFlag,
  isWelcomeFlagOnlyInvocation,
  isWelcomeShortFlagBundle,
  normalizeJsonFieldSelectionArgv,
  parseRootArgv,
  parseValidatedRootPrelude,
  readLongOptionValue,
  readShortOptionValue,
  rootArgvSlice,
} from "../../src/utils/root-argv.ts";

const ORIGINAL_ENV = {
  PRIVACY_POOLS_AGENT: process.env.PRIVACY_POOLS_AGENT,
  PRIVACY_POOLS_QUIET: process.env.PRIVACY_POOLS_QUIET,
  PRIVACY_POOLS_YES: process.env.PRIVACY_POOLS_YES,
  PRIVACY_POOLS_NO_PROGRESS: process.env.PRIVACY_POOLS_NO_PROGRESS,
};

const rootArgvCases = JSON.parse(
  readFileSync(resolve(process.cwd(), "test/fixtures/root-argv-cases.json"), "utf8"),
);

describe("root argv parsing", () => {
  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  for (const testCase of rootArgvCases) {
    test(`matches shared root argv parity fixture: ${testCase.name}`, () => {
      const parsed = parseRootArgv(testCase.argv);
      const prelude = parseValidatedRootPrelude(testCase.argv);

      expect(rootArgvSlice(testCase.argv)).toEqual(testCase.expected.rootArgvSlice);
      expect({
        firstCommandToken: parsed.firstCommandToken ?? null,
        nonOptionTokens: parsed.nonOptionTokens,
        formatFlagValue: parsed.formatFlagValue,
        isAgent: parsed.isAgent,
        isCsvMode: parsed.isCsvMode,
        isStructuredOutputMode: parsed.isStructuredOutputMode,
        isHelpLike: parsed.isHelpLike,
        isVersionLike: parsed.isVersionLike,
        isRootHelpInvocation: parsed.isRootHelpInvocation,
        isQuiet: parsed.isQuiet,
        isWelcome: parsed.isWelcome,
        globalChain: prelude?.globalOpts.chain ?? null,
        globalRpcUrl: prelude?.globalOpts.rpcUrl ?? null,
      }).toEqual({
        firstCommandToken: testCase.expected.firstCommandToken,
        nonOptionTokens: testCase.expected.nonOptionTokens,
        formatFlagValue: testCase.expected.formatFlagValue,
        isAgent: testCase.expected.isAgent,
        isCsvMode: testCase.expected.isCsvMode,
        isStructuredOutputMode: testCase.expected.isStructuredOutputMode,
        isHelpLike: testCase.expected.isHelpLike,
        isVersionLike: testCase.expected.isVersionLike,
        isRootHelpInvocation: testCase.expected.isRootHelpInvocation,
        isQuiet: testCase.expected.isQuiet,
        isWelcome: testCase.expected.isWelcome,
        globalChain: testCase.expected.globalChain,
        globalRpcUrl: testCase.expected.globalRpcUrl,
      });
    });
  }

  test("invalid output formats are still detected without breaking machine mode", () => {
    const parsed = parseRootArgv(["--json", "--output", "yaml", "guide"]);

    expect(parsed.formatFlagValue).toBe("yaml");
    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isWelcome).toBe(false);
  });

  test("--json-fields implies structured JSON output", () => {
    const argv = ["--json-fields", "structuredExamples", "describe", "withdraw"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
    expect(prelude?.globalOpts.jsonFields).toBe("structuredExamples");
    expect(prelude?.globalOpts.json).toBe(true);
  });

  test("--json <fields> after the command name selects structured fields", () => {
    const argv = ["describe", "withdraw", "--json", "structuredExamples"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
    expect(prelude?.globalOpts.jsonFields).toBe("structuredExamples");
    expect(prelude?.globalOpts.json).toBe(true);
  });

  test("--json=<fields> after the command name selects structured fields", () => {
    const argv = ["describe", "withdraw", "--json=structuredExamples"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
    expect(prelude?.globalOpts.jsonFields).toBe("structuredExamples");
    expect(prelude?.globalOpts.json).toBe(true);
  });

  test("--jmes implies structured JSON output and is parsed into globals", () => {
    const argv = ["--jmes", "nextActions", "status"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
    expect(prelude?.globalOpts.jmes).toBe("nextActions");
  });

  test("--web is parsed into globals without changing machine mode", () => {
    const argv = ["--web", "status"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isMachineMode).toBe(false);
    expect(prelude?.globalOpts.web).toBe(true);
  });

  test("--jq compatibility alias implies structured JSON output", () => {
    const argv = ["--jq=nextActions", "status"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
    expect(prelude?.globalOpts.jq).toBe("nextActions");
  });

  test("env fallbacks affect parsed root modes before command execution", () => {
    process.env.PRIVACY_POOLS_AGENT = "1";
    process.env.PRIVACY_POOLS_QUIET = "1";

    const parsed = parseRootArgv(["capabilities"]);
    const prelude = parseValidatedRootPrelude(["capabilities"]);

    expect(parsed.isAgent).toBe(true);
    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isQuiet).toBe(true);
    expect(prelude?.globalOpts.agent).toBe(true);
    expect(prelude?.globalOpts.quiet).toBe(true);
  });

  test("--template implies structured output and is parsed into globals", () => {
    const argv = ["--template", "{{command}}", "describe", "withdraw"];
    const parsed = parseRootArgv(argv);
    const prelude = parseValidatedRootPrelude(argv);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
    expect(prelude?.globalOpts.template).toBe("{{command}}");
    expect(prelude?.globalOpts.json).toBe(true);
  });

  test("--stream-json implies structured output for command-level parse errors", () => {
    const parsed = parseRootArgv(["deposit", "--stream-json"]);

    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isMachineMode).toBe(true);
  });

  test("normalizes command-level JSON field selection without consuming root option values", () => {
    expect(
      normalizeJsonFieldSelectionArgv([
        "--chain",
        "mainnet",
        "describe",
        "withdraw",
        "--json",
        "structuredExamples",
        "--",
        "--json",
        "literal",
      ]),
    ).toEqual([
      "--chain",
      "mainnet",
      "describe",
      "withdraw",
      "--json-fields",
      "structuredExamples",
      "--",
      "--json",
      "literal",
    ]);

    const argv = ["-qv", "-o", "csv", "accounts", "--no-header"];
    expect(rootArgvSlice(argv)).toEqual(argv);
    expect(hasShortFlag(argv, "q")).toBe(true);
    expect(hasShortFlag(argv, "v")).toBe(true);
    expect(hasLongFlag(argv, "--no-header")).toBe(true);
    expect(readShortOptionValue(argv, "-o")).toBe("csv");
    expect(readLongOptionValue(["--timeout=9", "status"], "--timeout")).toBe("9");
    expect(allNonOptionTokens(argv)).toEqual(["accounts"]);
    expect(firstNonOptionToken(["--profile", "ops", "status"])).toBe("status");
  });

  test("welcome-only detection and env fallbacks cover quiet yes and progress modes", () => {
    process.env.PRIVACY_POOLS_YES = "true";
    process.env.PRIVACY_POOLS_NO_PROGRESS = "on";

    expect(isWelcomeShortFlagBundle("-qvy")).toBe(true);
    expect(isWelcomeShortFlagBundle("-qx")).toBe(false);
    expect(isWelcomeFlagOnlyInvocation([])).toBe(true);
    expect(isWelcomeFlagOnlyInvocation(["--no-banner", "--timeout", "5"])).toBe(true);
    expect(isWelcomeFlagOnlyInvocation(["--timeout"])).toBe(false);

    const prelude = parseValidatedRootPrelude([
      "--no-progress",
      "--no-header",
      "--profile",
      "ops",
      "status",
    ]);
    expect(prelude?.globalOpts).toMatchObject({
      yes: true,
      noProgress: true,
      noHeader: true,
      profile: "ops",
    });

    const parsed = parseRootArgv(["-qvy"]);
    expect(parsed.isQuiet).toBe(true);
    expect(parsed.isWelcome).toBe(true);
  });
});
