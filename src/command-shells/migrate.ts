import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createMigrateCommand(): Command {
  const metadata = getCommandMetadata("migrate");
  const statusMetadata = getCommandMetadata("migrate status");

  const command = new Command("migrate")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}));

  command
    .command("status")
    .description(statusMetadata.description)
    .addOption(
      new Option(
        "--include-testnets",
        "Include supported testnets (default: CLI-supported mainnet chains only)",
      ),
    )
    .addOption(
      new Option(
        "--all-chains",
        "Deprecated: use --include-testnets",
      ).hideHelp(),
    )
    .addHelpText("after", commandHelpText(statusMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/migrate.js"),
        "handleMigrateStatusCommand",
      ),
    );

  return command;
}
