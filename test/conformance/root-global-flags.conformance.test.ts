import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLOBAL_FLAG_METADATA } from "../../src/utils/command-discovery-metadata.ts";
import { STATIC_COMPLETION_SPEC } from "../../src/utils/completion-query.ts";
import { COMPLETION_SHELL_CONTRACT } from "../../src/utils/completion-shell.ts";
import {
  ROOT_GLOBAL_FLAG_METADATA,
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("root global flags conformance", () => {
  const rustSource = readFileSync(
    join(CLI_ROOT, "native", "shell", "src", "root_argv.rs"),
    "utf8",
  );
  const completionRustSource = readFileSync(
    join(CLI_ROOT, "native", "shell", "src", "completion.rs"),
    "utf8",
  );
  const nativeRootFlags = JSON.parse(
    readFileSync(
      join(CLI_ROOT, "native", "shell", "generated", "root-flags.json"),
      "utf8",
    ),
  ) as typeof ROOT_GLOBAL_FLAG_METADATA;
  const nativeCompletionShellContract = JSON.parse(
    readFileSync(
      join(CLI_ROOT, "native", "shell", "generated", "completion-shell.json"),
      "utf8",
    ),
  ) as typeof COMPLETION_SHELL_CONTRACT;

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
    const normalizedHelpText = normalizeWhitespace(helpText);
    for (const { flag, description } of ROOT_GLOBAL_FLAG_METADATA) {
      if (flag !== "--format <format>") {
        expect(
          splitFlagNames(flag).some((name) => helpText.includes(name)),
        ).toBe(true);
      }
      expect(normalizedHelpText).toContain(normalizeWhitespace(description));
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

  test("native shell root flag contract is generated from the shared JS source of truth", () => {
    expect(nativeRootFlags).toEqual(ROOT_GLOBAL_FLAG_METADATA);
  });

  test("native root argv module consumes the generated root flag contract", () => {
    expect(rustSource).toContain("root-flags.json");
    expect(rustSource).toContain("root_flag_contract()");
  });

  test("native completion shell contract is generated from the shared JS source of truth", () => {
    expect(nativeCompletionShellContract).toEqual(COMPLETION_SHELL_CONTRACT);
  });

  test("native completion module consumes the generated shell contract", () => {
    expect(completionRustSource).toContain("completion-shell.json");
    expect(completionRustSource).toContain("completion_shell_contract()");
  });
});
