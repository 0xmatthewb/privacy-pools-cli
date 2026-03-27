import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_FLAG_METADATA } from "../../src/utils/command-discovery-metadata.ts";
import { STATIC_COMPLETION_SPEC } from "../../src/utils/completion-query.ts";
import {
  ROOT_GLOBAL_FLAG_METADATA,
  ROOT_LONG_OPTIONS_WITH_INLINE_VALUE,
  ROOT_OPTIONS_WITH_VALUE,
  ROOT_WELCOME_BOOLEAN_FLAGS,
} from "../../src/utils/root-global-flags.ts";
import { rootHelpBaseText } from "../../src/utils/root-help.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function splitFlagNames(flag: string): string[] {
  return flag
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function extractQuotedTokens(block: string): string[] {
  return Array.from(block.matchAll(/"([^"]+)"/g), (match) => match[1] ?? "");
}

function extractRustFnBody(source: string, fnName: string): string {
  const start = source.indexOf(`fn ${fnName}`);
  if (start === -1) {
    throw new Error(`Could not find Rust function ${fnName}`);
  }

  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) {
    throw new Error(`Could not find opening brace for ${fnName}`);
  }

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, index + 1);
      }
    }
  }

  throw new Error(`Could not find closing brace for ${fnName}`);
}

describe("root global flags conformance", () => {
  const rustSource = readFileSync(
    join(CLI_ROOT, "native", "shell", "src", "main.rs"),
    "utf8",
  );

  test("JS discovery metadata reuses the shared root flag source of truth", () => {
    expect(GLOBAL_FLAG_METADATA).toEqual(
      ROOT_GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({
        flag,
        description,
      })),
    );
  });

  test("static root help includes every shared root flag description", () => {
    const helpText = rootHelpBaseText();
    for (const { flag, description } of ROOT_GLOBAL_FLAG_METADATA) {
      expect(helpText).toContain(flag);
      expect(helpText).toContain(description);
    }
  });

  test("static completion keeps every shared root flag name available", () => {
    const rootOptionNames = sorted(
      STATIC_COMPLETION_SPEC.options?.flatMap((option) => option.names) ?? [],
    );
    const sharedOptionNames = sorted(
      ROOT_GLOBAL_FLAG_METADATA.flatMap(({ flag }) => splitFlagNames(flag)),
    );

    expect(rootOptionNames).toEqual(
      sorted([...sharedOptionNames, "-V", "--version"]),
    );
  });

  test("native root argv parsing stays aligned with the shared JS root flag contract", () => {
    const rootOptionBody = extractRustFnBody(rustSource, "root_option_takes_value");
    expect(sorted(extractQuotedTokens(rootOptionBody))).toEqual(
      sorted(ROOT_OPTIONS_WITH_VALUE),
    );

    const welcomeBody = extractRustFnBody(
      rustSource,
      "is_welcome_flag_only_invocation",
    );
    expect(sorted(extractQuotedTokens(welcomeBody))).toEqual(
      sorted([
        ...ROOT_LONG_OPTIONS_WITH_INLINE_VALUE.map((flag) => `${flag}=`),
        ...ROOT_WELCOME_BOOLEAN_FLAGS,
      ]),
    );
  });

  test("native command forwarding stays aligned with the shared JS root flag contract", () => {
    const valueBody = extractRustFnBody(
      rustSource,
      "is_command_global_value_option",
    );
    expect(sorted(extractQuotedTokens(valueBody))).toEqual(
      sorted(ROOT_OPTIONS_WITH_VALUE),
    );

    const inlineValueBody = extractRustFnBody(
      rustSource,
      "is_command_global_inline_value_option",
    );
    expect(sorted(extractQuotedTokens(inlineValueBody))).toEqual(
      sorted(ROOT_LONG_OPTIONS_WITH_INLINE_VALUE.map((flag) => `${flag}=`)),
    );

    const booleanBody = extractRustFnBody(
      rustSource,
      "is_command_global_boolean_option",
    );
    expect(sorted(extractQuotedTokens(booleanBody))).toEqual(
      sorted([
        "--agent",
        "--help",
        "--json",
        "--no-banner",
        "--no-color",
        "--quiet",
        "--verbose",
        "--version",
        "--yes",
      ]),
    );
  });
});
