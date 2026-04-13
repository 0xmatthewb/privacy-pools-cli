import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createConfigCommand(): Command {
  const metadata = getCommandMetadata("config");
  const listMetadata = getCommandMetadata("config list");
  const getMetadata = getCommandMetadata("config get");
  const setMetadata = getCommandMetadata("config set");
  const pathMetadata = getCommandMetadata("config path");

  const command = new Command("config")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}));

  command
    .command("list")
    .description(listMetadata.description)
    .addHelpText("after", commandHelpText(listMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigListCommand",
      ),
    );

  command
    .command("get")
    .description(getMetadata.description)
    .argument("<key>", "Configuration key (e.g. default-chain, rpc-override.mainnet, recovery-phrase, signer-key)")
    .option("--reveal", "Show the actual value of sensitive keys instead of [set]")
    .addHelpText("after", commandHelpText(getMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigGetCommand",
      ),
    );

  command
    .command("set")
    .description(setMetadata.description)
    .argument("<key>", "Configuration key to set")
    .argument("[value]", "Value to set (for non-sensitive keys)")
    .option("--file <path>", "Read value from file (for sensitive keys)")
    .option("--stdin", "Read value from stdin (for sensitive keys)")
    .addHelpText("after", commandHelpText(setMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigSetCommand",
      ),
    );

  command
    .command("path")
    .description(pathMetadata.description)
    .addHelpText("after", commandHelpText(pathMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigPathCommand",
      ),
    );

  const profile = command
    .command("profile")
    .description("Manage named profiles (separate wallet identities)");

  profile
    .command("list")
    .description("List available profiles")
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigProfileListCommand",
      ),
    );

  profile
    .command("create")
    .description("Create a new named profile")
    .argument("<name>", "Profile name (alphanumeric, hyphens, underscores)")
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigProfileCreateCommand",
      ),
    );

  profile
    .command("active")
    .description("Show the currently active profile")
    .action(
      createLazyAction(
        () => import("../commands/config.js"),
        "handleConfigProfileActiveCommand",
      ),
    );

  return command;
}
