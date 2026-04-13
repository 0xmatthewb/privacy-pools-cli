import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createDepositCommand(): Command {
  const metadata = getCommandMetadata("deposit");
  return new Command("deposit")
    .description(metadata.description)
    .argument("<amount>", "Amount to deposit (e.g. 0.1)")
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .addOption(
      new Option(
        "-a, --asset <symbol|address>",
        "Deprecated: use positional argument instead",
      ).hideHelp(),
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting; format: envelope (default) or tx",
      ).choices(["envelope", "tx"]),
    )
    .option(
      "--dry-run",
      "Validate and preview the transaction without submitting",
    )
    .option(
      "--ignore-unique-amount",
      "Allow non-round deposit amounts (weaker privacy; round amounts are harder to fingerprint)",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/deposit.js"),
        "handleDepositCommand",
      ),
    );
}
