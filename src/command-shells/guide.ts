import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";
import { GUIDE_TOPICS } from "../utils/help.js";

export function createGuideCommand(): Command {
  const metadata = getCommandMetadata("guide");
  const topicNames = GUIDE_TOPICS.map((t) => t.name);
  return new Command("guide")
    .description(metadata.description)
    .argument("[topic]", `Topic: ${topicNames.join(", ")}`)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/guide.js"),
        "handleGuideCommand",
      ),
    );
}
