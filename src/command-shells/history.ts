import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createHistoryCommand(): Command {
  const metadata = getCommandMetadata("history");
  return new Command("history")
    .description(metadata.description)
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option("-n, --limit <n>", "Show last N events", "50")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/history.js"),
        "handleHistoryCommand",
      ),
    );
}
