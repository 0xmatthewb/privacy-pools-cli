import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createWithdrawCommand(): Command {
  const metadata = getCommandMetadata("withdraw");
  const quoteMetadata = getCommandMetadata("withdraw quote");
  const command = new Command("withdraw")
    .description(metadata.description)
    .usage("[options] [amount] [asset]")
    .argument("[amount]", "Amount to withdraw (e.g. 0.05, 50%, 100%) or omit for interactive")
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
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
        "Confirm non-interactive direct withdrawals that publicly link deposit and withdrawal addresses.",
      ),
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting (default: envelope JSON; use --unsigned tx for raw transaction data)",
      ).choices(["envelope", "tx"]),
    )
    .option(
      "--dry-run",
      "Generate and verify withdrawal artifacts without submitting",
    )
    .option("--all", "Withdraw entire Pool Account balance (requires asset: withdraw --all ETH)")
    .option(
      "--extra-gas",
      "For ERC20 withdrawals only: also receive native gas tokens (default on for ERC20 withdrawals, unnecessary for ETH withdrawals)",
    )
    .option("--no-extra-gas", "Disable extra gas request")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw.js"),
        "handleWithdrawCommand",
      ),
    );

  command
    .command("quote")
    .description(quoteMetadata.description)
    .argument(
      "<amountOrAsset>",
      "Amount to withdraw (preferred first positional) or asset symbol",
    )
    .argument("[amount]", "Asset symbol (preferred second positional) or amount when the asset is first")
    .option(
      "-t, --to <address>",
      "Recipient address (recommended for an accurate fee quote)",
    )
    .addHelpText(
      "after",
      "\nPreferred order: privacy-pools withdraw quote <amount> <asset>\nAlso supported: privacy-pools withdraw quote <asset> <amount>\n",
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
