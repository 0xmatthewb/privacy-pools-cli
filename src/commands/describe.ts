import type { Command } from "commander";
import { renderCommandDescription } from "../output/describe.js";
import { createOutputContext } from "../output/common.js";
import type { GlobalOptions } from "../types.js";
import {
  buildCommandDescriptor,
  listCommandPaths,
  resolveCommandPath,
} from "../utils/command-discovery-metadata.js";
import { printError, CLIError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";

export async function handleDescribeCommand(...args: unknown[]): Promise<void> {
  const commandTokens = args[0] as string[];
  const cmd = args[args.length - 1] as Command;
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    const commandPath = resolveCommandPath(commandTokens);
    if (!commandPath) {
      throw new CLIError(
        `Unknown command path: ${commandTokens.join(" ")}`,
        "INPUT",
        `Valid command paths: ${listCommandPaths().join(", ")}`,
      );
    }

    renderCommandDescription(
      createOutputContext(mode),
      buildCommandDescriptor(commandPath),
    );
  } catch (error) {
    printError(error, mode.isJson);
  }
}
