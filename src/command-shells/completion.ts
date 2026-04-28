import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";
import { SUPPORTED_COMPLETION_SHELLS } from "../utils/completion.js";

export function createCompletionCommand(): Command {
  const metadata = getCommandMetadata("completion");
  return new Command("completion")
    .description(metadata.description)
    .addOption(
      new Option("-s, --shell <shell>", "Target shell").choices([
        ...SUPPORTED_COMPLETION_SHELLS,
      ]).hideHelp(),
    )
    .addOption(new Option("--install", "Install shell completion for your current shell"))
    .addOption(new Option("--query", "Internal: query completion candidates").hideHelp())
    .addOption(new Option("--cword <index>", "Internal: current word index").hideHelp())
    .argument("[shell]", "Target shell (bash|zsh|fish|powershell)")
    .allowExcessArguments(true)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/completion.js"),
        "handleCompletionCommand",
      ),
    );
}
