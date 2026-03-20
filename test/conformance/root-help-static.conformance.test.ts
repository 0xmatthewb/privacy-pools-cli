import { describe, expect, test } from "bun:test";
import { createRootProgram } from "../../src/program.ts";
import {
  rootHelpBaseText,
  rootHelpFooterPlain,
  rootHelpText,
} from "../../src/utils/root-help.ts";

describe("root help static conformance", () => {
  test("static root help text matches the live commander root help", () => {
    const program = createRootProgram("0.0.0");
    const liveBaseHelp = program.helpInformation().trimEnd();

    expect(rootHelpBaseText()).toBe(liveBaseHelp);
    expect(rootHelpText()).toBe(`${liveBaseHelp}\n${rootHelpFooterPlain()}`);
  });
});
