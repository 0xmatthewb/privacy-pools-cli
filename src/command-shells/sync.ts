import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createSyncCommand(): Command {
  const metadata = getCommandMetadata("sync");
  return new Command("sync")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .addOption(
      new Option(
        "-a, --asset <symbol|address>",
        "Deprecated: use positional argument instead",
      ).hideHelp(),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/sync.js"),
        "handleSyncCommand",
      ),
    );
}
