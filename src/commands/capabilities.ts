import { Command } from "commander";
import { printError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderCapabilities } from "../output/capabilities.js";
import { buildCapabilitiesPayload, getCommandMetadata } from "../utils/command-metadata.js";

export function createCapabilitiesCommand(): Command {
  const metadata = getCommandMetadata("capabilities");
  return new Command("capabilities")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(async (_opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);

      try {
        renderCapabilities(createOutputContext(mode), buildCapabilitiesPayload());
      } catch (error) {
        printError(error, mode.isJson);
      }
    });
}
