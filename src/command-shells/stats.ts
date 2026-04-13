import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createStatsCommand(): Command {
  const metadata = getCommandMetadata("stats");
  const globalMetadata = getCommandMetadata("stats global");
  const poolMetadata = getCommandMetadata("stats pool");
  const command = new Command("stats")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}));

  command
    .command("global", { isDefault: true })
    .description(globalMetadata.description)
    .addHelpText("after", commandHelpText(globalMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handleGlobalStatsCommand",
      ),
    );

  command
    .command("pool")
    .description(poolMetadata.description)
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .addOption(
      new Option(
        "-a, --asset <symbol|address>",
        "Deprecated: use positional argument instead",
      ).hideHelp(),
    )
    .addHelpText("after", commandHelpText(poolMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handlePoolStatsCommand",
      ),
    );

  return command;
}
