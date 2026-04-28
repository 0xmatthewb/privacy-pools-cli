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
    .option("--refresh", "Force a full account refresh even when cached state is fresh")
    .option(
      "--include-testnets",
      "Include supported testnets (default: CLI-supported mainnet chains only)",
    )
    .option("--details", "Show additional details per Pool Account")
    .option("--summary", "Show counts and balances only")
    .option("--history", "Show private account history (replaces the history command)")
    .option("--page <n>", "Show page N for --history", "1")
    .option("--pending-only", "Show only pending ASP approvals")
    .addOption(
      new Option(
        "--status <status>",
        `Filter by Pool Account status (${POOL_ACCOUNT_STATUSES.join(", ")})`,
      ).choices([...POOL_ACCOUNT_STATUSES]),
    )
    .option(
      "--watch",
      "Re-render pending approvals until none remain (human TTY only; requires --pending-only or --status pending; not available in --agent/--json/--csv)",
    )
    .option("--watch-interval <seconds>", "Seconds between --watch refreshes", "15")
    .option("-n, --limit <n>", "Limit Pool Account rows returned")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/accounts.js"),
        "handleAccountsCommand",
      ),
    );
}
