import { describe, expect, test } from "bun:test";
import { createRootProgram } from "../../src/program.ts";
import {
  buildCompletionSpecFromCommand,
} from "../../src/utils/completion.ts";
import {
  STATIC_COMPLETION_SPEC,
  type CompletionCommandSpec,
} from "../../src/utils/completion-query.ts";

interface NormalizedCompletionSpec {
  name: string;
  aliases: string[];
  options: Array<{
    names: string[];
    takesValue: boolean;
    values: string[];
  }>;
  subcommands: NormalizedCompletionSpec[];
}

function normalizeCompletionSpec(
  spec: CompletionCommandSpec,
): NormalizedCompletionSpec {
  return {
    name: spec.name,
    aliases: [...(spec.aliases ?? [])].sort((left, right) =>
      left.localeCompare(right),
    ),
    options: [...(spec.options ?? [])]
      .map((option) => ({
        names: [...option.names].sort((left, right) => left.localeCompare(right)),
        takesValue: option.takesValue,
        values: [...option.values].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) =>
        left.names.join("|").localeCompare(right.names.join("|")),
      ),
    subcommands: [...(spec.subcommands ?? [])]
      .map(normalizeCompletionSpec)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

describe("completion spec conformance", () => {
  test("static completion spec matches the live commander tree", async () => {
    const runtimeSpec = buildCompletionSpecFromCommand(await createRootProgram("0.0.0"));

    expect(normalizeCompletionSpec(STATIC_COMPLETION_SPEC)).toEqual(
      normalizeCompletionSpec(runtimeSpec),
    );
  });
});
