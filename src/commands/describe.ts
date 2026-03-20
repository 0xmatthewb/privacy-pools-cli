import type { Command } from "commander";
import { renderCommandDescription } from "../output/describe.js";
import { createOutputContext } from "../output/common.js";
import type { GlobalOptions } from "../types.js";
import {
  listStaticCommandPaths,
  resolveStaticCommandPath,
  STATIC_CAPABILITIES_PAYLOAD,
} from "../utils/command-discovery-static.js";
import { printError, CLIError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";

export async function handleDescribeCommand(...args: unknown[]): Promise<void> {
  const commandTokens = args[0] as string[];
  const cmd = args[args.length - 1] as Command;
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    const commandPath = resolveStaticCommandPath(commandTokens);
    if (!commandPath) {
      throw new CLIError(
        `Unknown command path: ${commandTokens.join(" ")}`,
        "INPUT",
        `Valid command paths: ${listStaticCommandPaths().join(", ")}`,
      );
    }

    renderCommandDescription(
      createOutputContext(mode),
      STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath],
    );
  } catch (error) {
    printError(error, mode.isJson);
  }
}
