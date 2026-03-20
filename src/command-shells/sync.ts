import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createSyncCommand(): Command {
  const metadata = getCommandMetadata("sync");
  return new Command("sync")
    .description(metadata.description)
    .option("-a, --asset <symbol|address>", "Sync only a single pool asset")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/sync.js"),
        "handleSyncCommand",
      ),
    );
}
