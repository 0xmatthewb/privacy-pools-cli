import { Command } from "commander";
import { GUIDE_TOPICS, commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createGuideCommand(): Command {
  const metadata = getCommandMetadata("guide");
  return new Command("guide")
    .description(metadata.description)
    .argument("[topic]", `Guide topic: ${GUIDE_TOPICS.map((topic) => topic.name).join(", ")}`)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/guide.js"),
        "handleGuideCommand",
      ),
    );
}
