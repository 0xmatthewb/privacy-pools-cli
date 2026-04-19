import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createTxStatusCommand(): Command {
  const metadata = getCommandMetadata("tx-status");
  return new Command("tx-status")
    .description(metadata.description)
    .argument("<submissionId>", "Submission id returned by a previous --no-wait command")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/tx-status.js"),
        "handleTxStatusCommand",
      ),
    );
}
