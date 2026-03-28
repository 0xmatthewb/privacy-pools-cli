import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createUpgradeCommand(): Command {
  const metadata = getCommandMetadata("upgrade");
  return new Command("upgrade")
    .description(metadata.description)
    .option(
      "--check",
      "Check npm for a newer privacy-pools-cli release without installing it",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/upgrade.js"),
        "handleUpgradeCommand",
      ),
    );
}
