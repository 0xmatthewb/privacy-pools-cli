import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createSyncCommand(): Command {
  const metadata = getCommandMetadata("sync");
  return new Command("sync")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .option(
      "--stream-json",
      "Emit line-delimited JSON progress events and finish with the final sync envelope",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/sync.js"),
        "handleSyncCommand",
      ),
    );
}
