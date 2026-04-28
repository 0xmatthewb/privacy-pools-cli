import { Command, Option } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createRagequitCommand(): Command {
  const metadata = getCommandMetadata("ragequit");
  return new Command("ragequit")
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
    .option(
      "--dry-run [mode]",
      "Generate proof and validate without submitting (modes: offline, rpc, relayer; bare flag = rpc)",
    )
    .option(
      "--no-wait",
      "Return after submission instead of waiting for confirmation",
    )
    .option(
      "--confirm-ragequit",
      "Required in non-interactive mode (--agent / --yes / CI). Acknowledges public recovery to the original deposit address.",
    )
    .option(
      "--stream-json",
      "Emit line-delimited JSON progress events and finish with the final ragequit envelope",
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
            "--help-full",
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
