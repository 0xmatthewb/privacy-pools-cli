import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createDescribeCommand(): Command {
  const metadata = getCommandMetadata("describe");
  return new Command("describe")
    .description(metadata.description)
    .argument("[command...]", "Command path to describe")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/describe.js"),
        "handleDescribeCommand",
      ),
    );
}
