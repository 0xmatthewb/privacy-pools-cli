import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";
import { POOL_ACCOUNT_STATUSES } from "../utils/statuses.js";

export function createAccountsCommand(): Command {
  const metadata = getCommandMetadata("accounts");
  return new Command("accounts")
    .description(metadata.description)
    .option("--no-sync", "Use cached data (faster, but may be stale)")
    .option(
      "--include-testnets",
      "Include supported testnets (default: CLI-supported mainnet chains only)",
    )
    .option("--details", "Show additional details per Pool Account")
    .option("--summary", "Show counts and balances only")
    .option("--pending-only", "Show only pending ASP approvals")
    .addOption(
      new Option(
        "--status <status>",
        `Filter by Pool Account status (${POOL_ACCOUNT_STATUSES.join(", ")})`,
      ).choices([...POOL_ACCOUNT_STATUSES]),
    )
    .option(
      "--watch",
      "Re-render pending approvals every 15s until none remain (human mode only; requires pending filter)",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/accounts.js"),
        "handleAccountsCommand",
      ),
    );
}
