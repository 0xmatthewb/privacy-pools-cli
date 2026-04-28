import { describe, expect, test } from "bun:test";
import type { Command, Option } from "commander";
import { createRootProgram } from "../../src/program.ts";
import {
  COMMAND_PATHS,
  getCommandMetadata,
  type CommandPath,
} from "../../src/utils/command-metadata.ts";

function normalizeLongFlag(flag: string): string | null {
  const matches = [...flag.matchAll(/--(?:no-)?[a-z0-9-]+/gi)].map((match) =>
    match[0].replace(/^--no-/, "--"),
  );
  return matches.at(-1) ?? null;
}

function visibleLongOptions(options: readonly Option[]): string[] {
  return options
    .filter((option) => !(option as Option & { hidden?: boolean }).hidden)
    .map((option) => option.long?.replace(/^--no-/, "--") ?? normalizeLongFlag(option.flags))
    .filter((flag): flag is string => Boolean(flag))
    .sort();
}

function catalogLongOptions(path: CommandPath): string[] {
  return [
    ...(getCommandMetadata(path).capabilities?.flags ?? []),
  ]
    .map(normalizeLongFlag)
    .filter((flag): flag is string => Boolean(flag))
    .sort();
}

function positionalCountFromCatalog(path: CommandPath): number {
  const metadata = getCommandMetadata(path);
  const surfaces = [
    metadata.capabilities?.usage ?? "",
    ...(metadata.capabilities?.flags ?? []),
  ];
  return Math.max(
    0,
    ...surfaces.map((surface) =>
      [...surface.matchAll(/(?:<[^>]+>|\[[^\]]+\])/g)].length
    ),
  );
}

function commandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | undefined = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(" ");
}

function walkCommands(command: Command): Command[] {
  return [command, ...command.commands.flatMap(walkCommands)];
}

describe("commander shell flag parity vs catalog", () => {
  test("runtime command-local flags and positionals are represented in COMMAND_CATALOG", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: true,
      styledHelp: false,
    });
    const knownPaths = new Set<string>(COMMAND_PATHS);

    for (const command of walkCommands(program)) {
      const path = commandPath(command);
      if (!knownPaths.has(path)) continue;

      const actualOptions = visibleLongOptions(command.options);
      const catalogOptions = catalogLongOptions(path as CommandPath);
      expect(
        actualOptions.filter((option) => !catalogOptions.includes(option)),
      ).toEqual([]);

      const actualPositionalCount = command.registeredArguments.length;
      if (actualPositionalCount > 0) {
        expect(positionalCountFromCatalog(path as CommandPath)).toBeGreaterThanOrEqual(
          actualPositionalCount,
        );
      }
    }
  });
});
