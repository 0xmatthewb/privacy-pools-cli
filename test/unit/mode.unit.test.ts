import { afterEach, describe, expect, test } from "bun:test";
import { resolveGlobalMode, setModeArgv } from "../../src/utils/mode.ts";
import { resetJsonOutputConfig } from "../../src/utils/json.ts";

const ORIGINAL_ENV = {
  PRIVACY_POOLS_AGENT: process.env.PRIVACY_POOLS_AGENT,
  PRIVACY_POOLS_QUIET: process.env.PRIVACY_POOLS_QUIET,
  PRIVACY_POOLS_YES: process.env.PRIVACY_POOLS_YES,
  PRIVACY_POOLS_NO_PROGRESS: process.env.PRIVACY_POOLS_NO_PROGRESS,
};

describe("resolveGlobalMode", () => {
  afterEach(() => {
    setModeArgv([]);
    resetJsonOutputConfig();
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("defaults all flags to false when no options", () => {
    const result = resolveGlobalMode(undefined);
    expect(result.isAgent).toBe(false);
    expect(result.isJson).toBe(false);
    expect(result.isCsv).toBe(false);
    expect(result.isWide).toBe(false);
    expect(result.isQuiet).toBe(false);
    expect(result.format).toBe("table");
    expect(result.skipPrompts).toBe(false);
  });

  test("defaults all flags to false with empty options", () => {
    const result = resolveGlobalMode({});
    expect(result.isAgent).toBe(false);
    expect(result.isJson).toBe(false);
    expect(result.isCsv).toBe(false);
    expect(result.isWide).toBe(false);
    expect(result.isQuiet).toBe(false);
    expect(result.format).toBe("table");
    expect(result.skipPrompts).toBe(false);
  });

  test("--agent implies json, quiet, and skipPrompts", () => {
    const result = resolveGlobalMode({ agent: true });
    expect(result.isAgent).toBe(true);
    expect(result.isJson).toBe(true);
    expect(result.isQuiet).toBe(true);
    expect(result.skipPrompts).toBe(true);
  });

  test("--json implies skipPrompts but not quiet", () => {
    const result = resolveGlobalMode({ json: true });
    expect(result.isAgent).toBe(false);
    expect(result.isJson).toBe(true);
    expect(result.isQuiet).toBe(false);
    expect(result.skipPrompts).toBe(true);
  });

  test("--quiet alone does not imply json or skipPrompts", () => {
    const result = resolveGlobalMode({ quiet: true });
    expect(result.isAgent).toBe(false);
    expect(result.isJson).toBe(false);
    expect(result.isQuiet).toBe(true);
    expect(result.skipPrompts).toBe(false);
  });

  test("--yes sets skipPrompts without other side effects", () => {
    const result = resolveGlobalMode({ yes: true });
    expect(result.isAgent).toBe(false);
    expect(result.isJson).toBe(false);
    expect(result.isQuiet).toBe(false);
    expect(result.skipPrompts).toBe(true);
  });

  test("--json --quiet sets both independently", () => {
    const result = resolveGlobalMode({ json: true, quiet: true });
    expect(result.isJson).toBe(true);
    expect(result.isQuiet).toBe(true);
    expect(result.skipPrompts).toBe(true);
  });

  test("--output csv sets isCsv and skipPrompts", () => {
    const result = resolveGlobalMode({ output: "csv" });
    expect(result.isCsv).toBe(true);
    expect(result.isJson).toBe(false);
    expect(result.format).toBe("csv");
    expect(result.skipPrompts).toBe(true);
  });

  test("--agent takes precedence over --output csv", () => {
    const result = resolveGlobalMode({ agent: true, output: "csv" });
    expect(result.isAgent).toBe(true);
    expect(result.isJson).toBe(true);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("json");
    expect(result.isQuiet).toBe(true);
  });

  test("--json takes precedence over --output csv", () => {
    const result = resolveGlobalMode({ json: true, output: "csv" });
    expect(result.isJson).toBe(true);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("json");
  });

  test("--output json is equivalent to --json", () => {
    const result = resolveGlobalMode({ output: "json" });
    expect(result.isJson).toBe(true);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("json");
    expect(result.skipPrompts).toBe(true);
  });

  test("--output table is the default", () => {
    const result = resolveGlobalMode({ output: "table" });
    expect(result.isJson).toBe(false);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("table");
    expect(result.skipPrompts).toBe(false);
  });

  test("--json takes precedence when --output is not set", () => {
    const result = resolveGlobalMode({ json: true });
    expect(result.format).toBe("json");
    expect(result.isJson).toBe(true);
  });

  test("--output wide sets isWide and uses table format", () => {
    const result = resolveGlobalMode({ output: "wide" });
    expect(result.isWide).toBe(true);
    expect(result.isJson).toBe(false);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("table");
    expect(result.skipPrompts).toBe(false);
  });

  test("--agent takes precedence over --output wide", () => {
    const result = resolveGlobalMode({ agent: true, output: "wide" });
    expect(result.isAgent).toBe(true);
    expect(result.isJson).toBe(true);
    expect(result.isWide).toBe(true);
    expect(result.format).toBe("json");
  });

  test("active argv makes --json-fields imply JSON when commander omits the option", () => {
    setModeArgv(["--json-fields", "structuredExamples", "describe", "withdraw"]);
    const result = resolveGlobalMode({});
    expect(result.isJson).toBe(true);
    expect(result.format).toBe("json");
    expect(result.jsonFields).toEqual(["structuredExamples"]);
  });

  test("active argv makes command-local --json <fields> imply JSON when commander omits the option", () => {
    setModeArgv(["describe", "withdraw", "--json", "structuredExamples"]);
    const result = resolveGlobalMode({});
    expect(result.isJson).toBe(true);
    expect(result.format).toBe("json");
    expect(result.jsonFields).toEqual(["structuredExamples"]);
  });

  test("--jmes implies JSON and becomes the canonical filter expression", () => {
    const result = resolveGlobalMode({ jmes: "nextActions" });
    expect(result.isJson).toBe(true);
    expect(result.format).toBe("json");
    expect(result.jqExpression).toBe("nextActions");
  });

  test("--jq remains a compatibility alias for the JMESPath expression", () => {
    const result = resolveGlobalMode({ jq: "nextActions" });
    expect(result.isJson).toBe(true);
    expect(result.format).toBe("json");
    expect(result.jqExpression).toBe("nextActions");
  });

  test("env fallbacks enable agent semantics without explicit flags", () => {
    process.env.PRIVACY_POOLS_AGENT = "1";

    const result = resolveGlobalMode({});

    expect(result.isAgent).toBe(true);
    expect(result.isJson).toBe(true);
    expect(result.isQuiet).toBe(true);
    expect(result.skipPrompts).toBe(true);
    expect(result.format).toBe("json");
  });

  test("env fallbacks enable quiet, yes, and no-progress behavior", () => {
    process.env.PRIVACY_POOLS_QUIET = "true";
    process.env.PRIVACY_POOLS_YES = "yes";
    process.env.PRIVACY_POOLS_NO_PROGRESS = "on";

    const result = resolveGlobalMode({});

    expect(result.isQuiet).toBe(true);
    expect(result.skipPrompts).toBe(true);
    expect(result.noProgress).toBe(true);
  });

  test("--template implies structured JSON output", () => {
    const result = resolveGlobalMode({ template: "{{command}}" });

    expect(result.isJson).toBe(true);
    expect(result.format).toBe("json");
    expect(result.template).toBe("{{command}}");
  });

  test("--template is mutually exclusive with --json-fields", () => {
    expect(() =>
      resolveGlobalMode({
        template: "{{command}}",
        jsonFields: "command",
      }),
    ).toThrow("Choose only one structured output filter: --json, --template.");
  });

  test("--template is mutually exclusive with --jmes", () => {
    expect(() =>
      resolveGlobalMode({
        template: "{{command}}",
        jmes: "command",
      }),
    ).toThrow("Choose only one structured output filter: --jmes/--jq, --template.");
  });
});
