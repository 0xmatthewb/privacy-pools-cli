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
const jsPoolsRendererPath = join(repoRoot, "src", "output", "pools.ts");
const jsActivityRendererPath = join(repoRoot, "src", "output", "activity.ts");
const jsStatsRendererPath = join(repoRoot, "src", "output", "stats.ts");
const nativePoolsRendererPath = join(
  repoRoot,
  "native",
  "shell",
  "src",
  "commands",
  "pools",
  "render.rs",
);
const nativeActivityRendererPath = join(
  repoRoot,
  "native",
  "shell",
  "src",
  "commands",
  "activity",
  "render.rs",
);
const nativeStatsRendererPath = join(
  repoRoot,
  "native",
  "shell",
  "src",
  "commands",
  "stats.rs",
);

function normalizeSourceWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

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

  test("wide renderer contracts stay aligned between js and native fast paths", () => {
    const jsPoolsRenderer = readFileSync(jsPoolsRendererPath, "utf8");
    const jsActivityRenderer = readFileSync(jsActivityRendererPath, "utf8");
    const jsStatsRenderer = readFileSync(jsStatsRendererPath, "utf8");
    const nativePoolsRenderer = readFileSync(nativePoolsRendererPath, "utf8");
    const nativeActivityRenderer = readFileSync(nativeActivityRendererPath, "utf8");
    const nativeStatsRenderer = readFileSync(nativeStatsRendererPath, "utf8");

    expect(jsPoolsRenderer).toContain('"Pool Address", "Scope"');
    expect(normalizeSourceWhitespace(nativePoolsRenderer)).toContain(
      '"Pool Address", "Scope"',
    );

    expect(jsActivityRenderer).toContain('"Pool Address", "Chain"');
    expect(normalizeSourceWhitespace(nativeActivityRenderer)).toContain(
      '"Pool Address", "Chain"',
    );

    expect(jsStatsRenderer).toContain('ctx.mode.isWide');
    expect(nativeStatsRenderer).toContain("mode.is_wide()");
    expect(nativeStatsRenderer).toContain("should_render_wide_tables");
  });
});
