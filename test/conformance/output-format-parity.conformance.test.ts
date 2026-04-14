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

  test("js parsing, completion metadata, and native generated contracts stay aligned", () => {
    for (const format of OUTPUT_FORMATS) {
      expect(normalizeOutputFormat(format)).toBe(format);
    }
    expect(normalizeOutputFormat("yaml")).toBeNull();
    expect(invalidOutputFormatMessage("yaml")).toContain(OUTPUT_FORMAT_CHOICES_TEXT);

    const formatOption = STATIC_COMPLETION_SPEC.options?.find((option) =>
      option.names.includes("--format"),
    );
    expect(formatOption?.values).toEqual(sorted(OUTPUT_FORMATS));

    expect(rootGlobalFlagDescription("--format <format>")).toBe(
      OUTPUT_FORMAT_DESCRIPTION,
    );
    expect(
      ROOT_GLOBAL_FLAG_METADATA.find((flag) => flag.flag === "--format <format>")
        ?.values,
    ).toEqual([...OUTPUT_FORMATS]);

    const rootHelp = rootHelpBaseText();
    expect(rootHelp).toContain(OUTPUT_FORMAT_DESCRIPTION);
    expect(rootHelp).toContain(`(choices: ${OUTPUT_FORMAT_CHOICES_HELP_TEXT})`);

    const nativeRootFlags = JSON.parse(
      readFileSync(nativeRootFlagsPath, "utf8"),
    ) as Array<{
      flag: string;
      values?: string[];
    }>;
    expect(
      nativeRootFlags.find((flag) => flag.flag === "--format <format>")?.values,
    ).toEqual([...OUTPUT_FORMATS]);

    const nativeManifest = JSON.parse(
      readFileSync(nativeManifestPath, "utf8"),
    ) as {
      rootHelp: string;
      structuredRootHelp: string;
    };
    expect(nativeManifest.rootHelp).toContain(OUTPUT_FORMAT_DESCRIPTION);
    expect(nativeManifest.rootHelp).toContain(
      `(choices: ${OUTPUT_FORMAT_CHOICES_HELP_TEXT})`,
    );
    expect(nativeManifest.structuredRootHelp).toContain(OUTPUT_FORMAT_DESCRIPTION);
    expect(nativeManifest.structuredRootHelp).toContain(
      `(choices: ${OUTPUT_FORMAT_CHOICES_HELP_TEXT})`,
    );
  });
});
