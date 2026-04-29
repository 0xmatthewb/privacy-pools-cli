import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createStatusCommand(): Command {
  const metadata = getCommandMetadata("status");
  return new Command("status")
    .description(metadata.description)
    .option(
      "--check [scope]",
      "Run health checks: all (default), rpc for blockchain node reachability, asp for 0xBow Association Set Provider connectivity, relayer for withdrawal relay connectivity, or none",
    )
    .option("--no-check", "Disable the default RPC, ASP, and relayer health checks")
    .option("--aggregated", "Include pending workflows, submissions, Pool Accounts, recovery table, and phase graph reference")
    .addOption(
      new Option("--check-rpc", "Run only the RPC health check").hideHelp(),
    )
    .addOption(
      new Option("--check-asp", "Run only the ASP health check").hideHelp(),
    )
    .addOption(
      new Option("--check-relayer", "Run only the relayer health check").hideHelp(),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/status.js"),
        "handleStatusCommand",
      ),
    );
}
