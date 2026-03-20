import { Command } from "commander";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createGuideCommand(): Command {
  const metadata = getCommandMetadata("guide");
  return new Command("guide")
    .description(metadata.description)
    .action(
      createLazyAction(
        () => import("../commands/guide.js"),
        "handleGuideCommand",
      ),
    );
}
