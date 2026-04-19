import { Command, Option } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createRagequitCommand(): Command {
  const metadata = getCommandMetadata("ragequit");
  return new Command("ragequit")
    .alias("exit")
    .configureHelp({
      commandUsage: () => "privacy-pools ragequit [options] [asset]",
    })
    .description(metadata.description)
    .argument("[asset]", "Optional asset symbol or token address (case-insensitive; e.g. ETH)")
    .option(
      "-p, --pool-account <PA-ID | numeric-index>",
      "Ragequit a specific Pool Account (examples: PA-2 or 2)",
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting (default: envelope JSON; use --unsigned tx for raw transaction data)",
      ).choices(["envelope", "tx"]),
    )
    .option("--dry-run", "Generate proof and validate without submitting")
    .option(
      "--no-wait",
      "Return after submission instead of waiting for confirmation",
    )
    .option(
      "--confirm-ragequit",
      "Deprecated compatibility flag for non-interactive ragequit commands that publicly recover funds to the original deposit address",
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
          ],
        },
        {
          heading: "Selection",
          flags: [
            "--pool-account <PA-ID | numeric-index>",
          ],
        },
        {
          heading: "Confirmation",
          flags: [
            "--confirm-ragequit",
          ],
        },
        {
          heading: "Output & Defaults",
          flags: [
            "--yes",
            "--agent",
            "--help-brief",
          ],
        },
      ]),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/ragequit.js"),
        "handleRagequitCommand",
      ),
    );
}
