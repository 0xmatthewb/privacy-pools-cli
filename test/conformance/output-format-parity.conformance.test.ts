import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATIC_COMPLETION_SPEC } from "../../src/utils/completion-query.ts";
import {
  invalidOutputFormatMessage,
  normalizeOutputFormat,
  OUTPUT_FORMAT_CHOICES_HELP_TEXT,
  OUTPUT_FORMAT_CHOICES_TEXT,
  OUTPUT_FORMAT_DESCRIPTION,
  OUTPUT_FORMATS,
} from "../../src/utils/mode.ts";
import {
  ROOT_GLOBAL_FLAG_METADATA,
  rootGlobalFlagDescription,
} from "../../src/utils/root-global-flags.ts";
import { rootHelpBaseText } from "../../src/utils/root-help.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nativeRootFlagsPath = join(
  repoRoot,
  "native",
  "shell",
  "generated",
  "root-flags.json",
);
const nativeManifestPath = join(
  repoRoot,
  "native",
  "shell",
  "generated",
  "manifest.json",
);

describe("output format parity conformance", () => {
  const sorted = (values: readonly string[]) => [...values].sort();
  const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

  test("runtime parsing accepts only declared output formats", () => {
    for (const format of OUTPUT_FORMATS) {
      expect(normalizeOutputFormat(format)).toBe(format);
    }
    expect(normalizeOutputFormat("toml")).toBeNull();
    expect(invalidOutputFormatMessage("toml")).toContain(OUTPUT_FORMAT_CHOICES_TEXT);
  });

  test("completion and root flag metadata expose the same format choices", () => {
    const formatOption = STATIC_COMPLETION_SPEC.options?.find((option) =>
      option.names.includes("--output"),
    );
    expect(formatOption?.values).toEqual(sorted(OUTPUT_FORMATS));

    expect(rootGlobalFlagDescription("--output <format>")).toBe(
      OUTPUT_FORMAT_DESCRIPTION,
    );
    expect(
      ROOT_GLOBAL_FLAG_METADATA.find((flag) => flag.flag === "-o, --output <format>")
        ?.values,
    ).toEqual([...OUTPUT_FORMATS]);
  });

  test("human and generated help advertise the format contract", () => {
    const rootHelp = normalizeWhitespace(rootHelpBaseText());
    expect(rootHelp).toContain(OUTPUT_FORMAT_DESCRIPTION);
    expect(rootHelp).toContain(`(choices: ${OUTPUT_FORMAT_CHOICES_HELP_TEXT})`);

    const nativeRootFlags = JSON.parse(
      readFileSync(nativeRootFlagsPath, "utf8"),
    ) as Array<{
      flag: string;
      values?: string[];
    }>;
    expect(
      nativeRootFlags.find((flag) => flag.flag === "-o, --output <format>")?.values,
    ).toEqual([...OUTPUT_FORMATS]);
  });

  test("native manifest help surfaces keep the same format description", () => {
    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      rootHelp: string;
      structuredRootHelp: string;
    };
    expect(normalizeWhitespace(nativeManifest.rootHelp)).toContain(OUTPUT_FORMAT_DESCRIPTION);
    expect(normalizeWhitespace(nativeManifest.rootHelp)).toContain(
      `(choices: ${OUTPUT_FORMAT_CHOICES_HELP_TEXT})`,
    );
    expect(normalizeWhitespace(nativeManifest.structuredRootHelp)).toContain(OUTPUT_FORMAT_DESCRIPTION);
    expect(normalizeWhitespace(nativeManifest.structuredRootHelp)).toContain(
      `(choices: ${OUTPUT_FORMAT_CHOICES_HELP_TEXT})`,
    );
  });
});
