import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createHistoryCommand(): Command {
  const metadata = getCommandMetadata("history");
  const command = new Command("history");
  (command as Command & { hidden: boolean }).hidden = true;
  return command
    .description(metadata.description)
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option("--page <n>", "Show page N of history results", "1")
    .option("-n, --limit <n>", "Show last N events", "50")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/history.js"),
        "handleHistoryCommand",
      ),
    );
}
