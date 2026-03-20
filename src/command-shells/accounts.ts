import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createAccountsCommand(): Command {
  const metadata = getCommandMetadata("accounts");
  return new Command("accounts")
    .description(metadata.description)
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option(
      "--all-chains",
      "Include testnet chains (mainnet chains shown by default)",
    )
    .option("--details", "Show additional details per Pool Account")
    .option("--summary", "Show counts and balances only")
    .option("--pending-only", "Show only pending ASP approvals")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/accounts.js"),
        "handleAccountsCommand",
      ),
    );
}
