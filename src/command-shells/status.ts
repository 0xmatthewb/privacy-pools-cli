import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createStatusCommand(): Command {
  const metadata = getCommandMetadata("status");
  return new Command("status")
    .description(metadata.description)
    .option("--check", "Force both RPC and ASP health checks (default when a chain is selected)")
    .option("--no-check", "Disable the default RPC and ASP health checks")
    .option("--check-rpc", "Run only the RPC health check")
    .option("--check-asp", "Run only the ASP health check")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/status.js"),
        "handleStatusCommand",
      ),
    );
}
