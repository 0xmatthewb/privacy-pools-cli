import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createWithdrawCommand(): Command {
  const metadata = getCommandMetadata("withdraw");
  const quoteMetadata = getCommandMetadata("withdraw quote");
  const command = new Command("withdraw")
    .description(metadata.description)
    .argument("[amount]", "Amount to withdraw (e.g. 0.05, 50%)")
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .option("-t, --to <address>", "Recipient address (required for relayed)")
    .option(
      "-p, --pool-account <PA-#|#>",
      "Withdraw from a specific Pool Account (e.g. PA-2)",
    )
    .addOption(new Option("--from-pa <PA-#|#>", "Deprecated: use --pool-account").hideHelp())
    .addOption(
      new Option(
        "--direct",
        "NOT recommended. Withdraw directly onchain, publicly linking deposit and withdrawal addresses. Use relayed mode (default) for privacy.",
      ),
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting; format: envelope (default) or tx",
      ).choices(["envelope", "tx"]),
    )
    .option(
      "--dry-run",
      "Generate and verify withdrawal artifacts without submitting",
    )
    .addOption(
      new Option(
        "-a, --asset <symbol|address>",
        "Deprecated: use positional argument instead",
      ).hideHelp(),
    )
    .option("--all", "Withdraw entire Pool Account balance")
    .option(
      "--extra-gas",
      "Request gas tokens with withdrawal (default: true for ERC20)",
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
      "Amount to withdraw (or asset symbol, see examples)",
    )
    .argument("[amount]", "Amount (when asset is the first argument)")
    .option("-a, --asset <symbol|address>", "Asset to quote")
    .option(
      "-t, --to <address>",
      "Recipient address (recommended for an accurate fee quote)",
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
