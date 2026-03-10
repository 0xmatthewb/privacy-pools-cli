import { Command } from "commander";
import { renderCommandDescription } from "../output/describe.js";
import { createOutputContext } from "../output/common.js";
import type { GlobalOptions } from "../types.js";
import {
  buildCommandDescriptor,
  getCommandMetadata,
  listCommandPaths,
  resolveCommandPath,
} from "../utils/command-metadata.js";
import { printError, CLIError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import { resolveGlobalMode } from "../utils/mode.js";

export function createDescribeCommand(): Command {
  const metadata = getCommandMetadata("describe");

  return new Command("describe")
    .description(metadata.description)
    .argument("<command...>", "Command path to describe")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (...args) => {
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
            `Valid command paths: ${listCommandPaths().join(", ")}`
          );
        }

        renderCommandDescription(
          createOutputContext(mode),
          buildCommandDescriptor(commandPath)
        );
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
