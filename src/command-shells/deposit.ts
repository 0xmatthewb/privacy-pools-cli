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
    .option(
      "-a, --asset <symbol|address>",
      "Asset to deposit (symbol like ETH, USDC, or contract address)",
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned payload; format: envelope (default) or tx",
      ).choices(["envelope", "tx"]),
    )
    .addOption(
      new Option(
        "--unsigned-format <format>",
        "Deprecated: use --unsigned [format]",
      ).hideHelp(),
    )
    .option(
      "--dry-run",
      "Validate and preview the transaction without submitting",
    )
    .option(
      "--ignore-unique-amount",
      "Bypass the non-round amount privacy check",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/deposit.js"),
        "handleDepositCommand",
      ),
    );
}
