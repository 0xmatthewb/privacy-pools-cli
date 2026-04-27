import { Command, Option } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createDepositCommand(): Command {
  const metadata = getCommandMetadata("deposit");
  return new Command("deposit")
    .description(metadata.description)
    .argument("<amount>", "Human-readable token amount to deposit (e.g. 0.1, not wei)")
    .argument("[asset]", "Asset symbol or token address (case-insensitive; e.g. ETH, USDC)")
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting (default: envelope JSON; use --unsigned tx for raw transaction data)",
      ).choices(["envelope", "tx"]),
    )
    .option(
      "--dry-run",
      "Validate and preview the transaction without submitting",
    )
    .option(
      "--no-wait",
      "Return after submission instead of waiting for confirmation",
    )
    .option(
      "--stream-json",
      "Emit line-delimited JSON progress events and finish with the final deposit envelope",
    )
    .option(
      "--allow-non-round-amounts",
      "Allow non-round deposit amounts (weaker privacy; round amounts are harder to fingerprint)",
    )
    .addOption(
      new Option(
        "--ignore-unique-amount",
        "Deprecated alias for --allow-non-round-amounts",
      ).hideHelp(),
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
            "--stream-json",
          ],
        },
        {
          heading: "Privacy",
          flags: [
            "--allow-non-round-amounts",
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
        () => import("../commands/deposit.js"),
        "handleDepositCommand",
      ),
    );
}
