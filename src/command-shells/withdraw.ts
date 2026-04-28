import { Command, Option } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createWithdrawCommand(): Command {
  const metadata = getCommandMetadata("withdraw");
  const quoteMetadata = getCommandMetadata("withdraw quote");
  const recipientsMetadata = getCommandMetadata("withdraw recipients");
  const recipientsListMetadata = getCommandMetadata("withdraw recipients list");
  const recipientsAddMetadata = getCommandMetadata("withdraw recipients add");
  const recipientsRemoveMetadata = getCommandMetadata("withdraw recipients remove");
  const recipientsClearMetadata = getCommandMetadata("withdraw recipients clear");
  const command = new Command("withdraw")
    .description(metadata.description)
    .usage("[options] [amount] [asset]")
    .argument("[amount]", "Human-readable amount to withdraw (e.g. 0.05, 50%, 100%) or omit for interactive")
    .argument("[asset]", "Asset symbol or token address (case-insensitive; e.g. ETH, USDC)")
    .option("-t, --to <address>", "Recipient address (required unless --direct; prompted interactively)")
    .option(
      "-p, --pool-account <PA-ID | numeric-index>",
      "Withdraw from a specific Pool Account (examples: PA-2 or 2)",
    )
    .addOption(
      new Option(
        "--direct",
        "WILL publicly link deposit and withdrawal addresses onchain. This cannot be undone.",
      ),
    )
    .addOption(
      new Option(
        "--confirm-direct-withdraw",
        "Required in non-interactive mode (--agent / --yes / CI). Acknowledges direct public withdrawal to the signer address.",
      ),
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting (default: envelope JSON; use --unsigned tx for raw transaction data)",
      ).choices(["envelope", "tx"]),
    )
    .option(
      "--dry-run [mode]",
      "Generate and verify withdrawal artifacts without submitting (modes: offline, rpc, relayer; bare flag = rpc)",
    )
    .option(
      "--no-wait",
      "Return after submission instead of waiting for confirmation",
    )
    .option(
      "--stream-json",
      "Emit line-delimited JSON progress events and finish with the final withdrawal envelope",
    )
    .option("--all", "Withdraw entire Pool Account balance (requires asset: withdraw --all ETH)")
    .option(
      "--accept-all-funds-public",
      "Acknowledge that --all --direct in non-interactive mode publicly links the full Pool Account balance",
    )
    .option(
      "--extra-gas",
      "For ERC20 withdrawals, ask the relayer to include a small native-token gas top-up from the withdrawn funds (slightly higher fee)",
    )
    .option("--no-extra-gas", "Disable extra gas for ERC20 withdrawals")
    .option("--no-remember", "Do not save the withdrawal recipient to the local address book")
    .addOption(
      new Option(
        "--break-privacy-acknowledged",
        "Required with --agent --direct. Acknowledges the irreversible public link created by direct withdrawal.",
      ),
    )
    .addHelpText(
      "after",
      groupedFlagGuideText([
        {
          heading: "Execution",
          flags: [
            "--unsigned [format]",
            "--dry-run",
            "--no-wait",
            "--all",
            "--accept-all-funds-public",
            "--stream-json",
          ],
        },
        {
          heading: "Recipient & Selection",
          flags: [
            "--to <address>",
            "--pool-account <PA-ID | numeric-index>",
          ],
        },
        {
          heading: "Privacy & Fees",
          flags: [
            "--direct",
            "--confirm-direct-withdraw",
            "--break-privacy-acknowledged",
            "--extra-gas",
            "--no-extra-gas",
            "--no-remember",
          ],
        },
        {
          heading: "Output & Defaults",
          flags: [
            "--yes",
            "--agent",
            "--help-brief",
            "--help-full",
          ],
        },
      ]),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw.js"),
        "handleWithdrawCommand",
      ),
    );

  const recipients = command
    .command("recipients")
    .alias("recents")
    .description(recipientsMetadata.description)
    .option("-n, --limit <n>", "Limit recipients returned")
    .option("--all-chains", "List remembered recipients across all chains")
    .option("--include-metadata", "Include recipient timestamps in JSON output")
    .addHelpText(
      "after",
      "\nSuccessful withdrawals are remembered by chain unless --no-remember is set. Use add/remove to manage the local address book manually.\n",
    )
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsListCommand",
      ),
    );

  recipients
    .command("list")
    .alias("ls")
    .description(recipientsListMetadata.description)
    .option("-n, --limit <n>", "Limit recipients returned")
    .option("--all-chains", "List remembered recipients across all chains")
    .option("--include-metadata", "Include recipient timestamps in JSON output")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsListCommand",
      ),
    );

  recipients
    .command("add")
    .description(recipientsAddMetadata.description)
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .argument("[label]", "Optional display label")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsAddCommand",
      ),
    );

  recipients
    .command("remove")
    .alias("rm")
    .description(recipientsRemoveMetadata.description)
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsRemoveCommand",
      ),
    );

  recipients
    .command("clear")
    .description(recipientsClearMetadata.description)
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsClearCommand",
      ),
    );

  command
    .command("quote")
    .description(quoteMetadata.description)
    .argument(
      "<amountOrAsset>",
      "Amount to withdraw (canonical first positional)",
    )
    .argument("[asset]", "Asset symbol (canonical second positional, case-insensitive)")
    .option(
      "-t, --to <address>",
      "Recipient address (recommended for an accurate fee quote)",
    )
    .addHelpText(
      "after",
      "\nCanonical order: privacy-pools withdraw quote <amount> <asset>\n",
    )
    .addHelpText("after", commandHelpText(quoteMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw.js"),
        "handleWithdrawQuoteCommand",
      ),
    );

  return command;
}
