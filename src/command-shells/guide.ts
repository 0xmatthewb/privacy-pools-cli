import { Command } from "commander";
import { GUIDE_TOPICS, commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createGuideCommand(): Command {
  const metadata = getCommandMetadata("guide");
  return new Command("guide")
    .description(metadata.description)
    .argument("[topic]", `Guide topic: ${GUIDE_TOPICS.map((topic) => topic.name).join(", ")}`)
    .option("--topics", "List available guide topics")
    .option("--pager", "Open guide output in $PAGER")
    .option("--no-pager", "Print guide output directly")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/guide.js"),
        "handleGuideCommand",
      ),
    );
}
