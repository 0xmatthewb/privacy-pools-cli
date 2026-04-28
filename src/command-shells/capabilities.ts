import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createCapabilitiesCommand(): Command {
  const metadata = getCommandMetadata("capabilities");
  return new Command("capabilities")
    .description(metadata.description)
    .addHelpText("after", "\nAgent mode: add --agent for the canonical machine-readable discovery manifest.\n")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/capabilities.js"),
        "handleCapabilitiesCommand",
      ),
    );
}
