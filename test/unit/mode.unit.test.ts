import { afterEach, describe, expect, test } from "bun:test";
import { resolveGlobalMode, setModeArgv } from "../../src/utils/mode.ts";
import { resetJsonOutputConfig } from "../../src/utils/json.ts";

describe("resolveGlobalMode", () => {
  afterEach(() => {
    setModeArgv([]);
    resetJsonOutputConfig();
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

  test("--format csv sets isCsv and skipPrompts", () => {
    const result = resolveGlobalMode({ format: "csv" });
    expect(result.isCsv).toBe(true);
    expect(result.isJson).toBe(false);
    expect(result.format).toBe("csv");
    expect(result.skipPrompts).toBe(true);
  });

  test("--agent takes precedence over --format csv", () => {
    const result = resolveGlobalMode({ agent: true, format: "csv" });
    expect(result.isAgent).toBe(true);
    expect(result.isJson).toBe(true);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("json");
    expect(result.isQuiet).toBe(true);
  });

  test("--json takes precedence over --format csv", () => {
    const result = resolveGlobalMode({ json: true, format: "csv" });
    expect(result.isJson).toBe(true);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("json");
  });

  test("--format json is equivalent to --json", () => {
    const result = resolveGlobalMode({ format: "json" });
    expect(result.isJson).toBe(true);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("json");
    expect(result.skipPrompts).toBe(true);
  });

  test("--format table is the default", () => {
    const result = resolveGlobalMode({ format: "table" });
    expect(result.isJson).toBe(false);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("table");
    expect(result.skipPrompts).toBe(false);
  });

  test("--json takes precedence when --format is not set", () => {
    const result = resolveGlobalMode({ json: true });
    expect(result.format).toBe("json");
    expect(result.isJson).toBe(true);
  });

  test("--format wide sets isWide and uses table format", () => {
    const result = resolveGlobalMode({ format: "wide" });
    expect(result.isWide).toBe(true);
    expect(result.isJson).toBe(false);
    expect(result.isCsv).toBe(false);
    expect(result.format).toBe("table");
    expect(result.skipPrompts).toBe(false);
  });

  test("--agent takes precedence over --format wide", () => {
    const result = resolveGlobalMode({ agent: true, format: "wide" });
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
});
