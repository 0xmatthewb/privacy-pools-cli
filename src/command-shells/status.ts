import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createStatusCommand(): Command {
  const metadata = getCommandMetadata("status");
  return new Command("status")
    .description(metadata.description)
    .option("--check [scope]", "Run health checks: all (default), rpc, asp, or none")
    .option("--no-check", "Disable the default RPC and ASP health checks")
    .addOption(
      new Option("--check-rpc", "Run only the RPC health check").hideHelp(),
    )
    .addOption(
      new Option("--check-asp", "Run only the ASP health check").hideHelp(),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/status.js"),
        "handleStatusCommand",
      ),
    );
}
