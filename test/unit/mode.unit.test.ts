import { describe, expect, test } from "bun:test";
import { resolveGlobalMode } from "../../src/utils/mode.ts";

describe("resolveGlobalMode", () => {
  test("defaults all flags to false when no options", () => {
    const result = resolveGlobalMode(undefined);
    expect(result).toEqual({
      isAgent: false,
      isJson: false,
      isQuiet: false,
      skipPrompts: false,
    });
  });

  test("defaults all flags to false with empty options", () => {
    const result = resolveGlobalMode({});
    expect(result).toEqual({
      isAgent: false,
      isJson: false,
      isQuiet: false,
      skipPrompts: false,
    });
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
});
