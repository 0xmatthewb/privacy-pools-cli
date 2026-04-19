import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createBroadcastCommand(): Command {
  const metadata = getCommandMetadata("broadcast");
  return new Command("broadcast")
    .description(metadata.description)
    .argument("<input>", "Path to a full unsigned envelope JSON file, or '-' to read from stdin")
    .option(
      "--validate-only",
      "Validate the envelope and signature parity without submitting any transaction",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/broadcast.js"),
        "handleBroadcastCommand",
      ),
    );
}
