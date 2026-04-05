import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  parseRootArgv,
  parseValidatedRootPrelude,
  rootArgvSlice,
} from "../../src/utils/root-argv.ts";

const rootArgvCases = JSON.parse(
  readFileSync(resolve(process.cwd(), "test/fixtures/root-argv-cases.json"), "utf8"),
);

describe("root argv parsing", () => {
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
    const parsed = parseRootArgv(["--json", "--format", "yaml", "guide"]);

    expect(parsed.formatFlagValue).toBe("yaml");
    expect(parsed.isStructuredOutputMode).toBe(true);
    expect(parsed.isWelcome).toBe(false);
  });
});
