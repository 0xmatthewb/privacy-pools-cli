import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createStatusCommand(): Command {
  const metadata = getCommandMetadata("status");
  return new Command("status")
    .description(metadata.description)
    .option("--check", "Run both RPC and ASP health checks")
    .option("--no-check", "Suppress default health checks")
    .option("--check-rpc", "Actively test RPC connectivity")
    .option("--check-asp", "Actively test ASP liveness")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/status.js"),
        "handleStatusCommand",
      ),
    );
}
