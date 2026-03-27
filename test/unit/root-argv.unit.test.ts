import { describe, expect, test } from "bun:test";
import { parseRootArgv, rootArgvSlice } from "../../src/utils/root-argv.ts";

describe("root argv parsing", () => {
  test("stops parsing global flags at -- like the native shell", () => {
    const argv = ["--json", "--", "status", "--json"];

    expect(rootArgvSlice(argv)).toEqual(["--json"]);
    expect(parseRootArgv(argv)).toMatchObject({
      firstCommandToken: undefined,
      nonOptionTokens: [],
      isJson: true,
      isRootHelpInvocation: false,
    });
  });

  test("still resolves root commands before the -- boundary", () => {
    expect(parseRootArgv(["status", "--", "--help"])).toMatchObject({
      firstCommandToken: "status",
      nonOptionTokens: ["status"],
      isHelpLike: false,
    });
  });

  test("structured machine flags outrank csv mode", () => {
    expect(parseRootArgv(["--agent", "--format", "csv", "guide"])).toMatchObject({
      isAgent: true,
      isJson: true,
      isCsvMode: false,
      isStructuredOutputMode: true,
      isWelcome: false,
    });
  });

  test("welcome parsing accepts split-value options and bundled welcome flags", () => {
    expect(
      parseRootArgv(["--timeout", "30", "-qy", "--no-color"]),
    ).toMatchObject({
      isMachineMode: false,
      isQuiet: true,
      isWelcome: true,
    });
  });

  test("welcome parsing rejects incomplete root options with missing values", () => {
    expect(parseRootArgv(["--timeout"])).toMatchObject({
      isMachineMode: false,
      isWelcome: false,
    });
  });
});
