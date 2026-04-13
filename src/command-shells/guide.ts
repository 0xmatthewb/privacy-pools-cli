import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createGuideCommand(): Command {
  const metadata = getCommandMetadata("guide");
  return new Command("guide")
    .description(metadata.description)
    .argument("[topic]", "Guide topic")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/guide.js"),
        "handleGuideCommand",
      ),
    );
}
