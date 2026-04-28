import { Command, Option } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createWithdrawCommand(): Command {
  const metadata = getCommandMetadata("withdraw");
  const quoteMetadata = getCommandMetadata("withdraw quote");
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
            "--extra-gas",
            "--no-extra-gas",
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
    .description("List remembered withdrawal recipients")
    .option("-n, --limit <n>", "Limit recipients returned")
    .addHelpText(
      "after",
      "\nSuccessful withdrawals are remembered automatically. Use add/remove to manage the local address book manually.\n",
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
    .description("List remembered withdrawal recipients")
    .option("-n, --limit <n>", "Limit recipients returned")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsListCommand",
      ),
    );

  recipients
    .command("add")
    .description("Add a recipient to the local withdrawal address book")
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .argument("[label]", "Optional display label")
    .addOption(new Option("--label <label>", "Optional display label").hideHelp())
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsAddCommand",
      ),
    );

  recipients
    .command("remove")
    .alias("rm")
    .description("Remove a recipient from the local withdrawal address book")
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsRemoveCommand",
      ),
    );

  recipients
    .command("clear")
    .description("Clear all remembered withdrawal recipients")
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
