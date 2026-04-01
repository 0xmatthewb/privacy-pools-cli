import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createRagequitCommand(): Command {
  const metadata = getCommandMetadata("ragequit");
  return new Command("ragequit")
    .alias("exit")
    .description(metadata.description)
    .argument("[asset]", "Optional positional asset alias (e.g., ragequit ETH)")
    .option("-a, --asset <symbol|address>", "Asset pool to ragequit from")
    .option(
      "-p, --from-pa <PA-#|#>",
      "Ragequit a specific Pool Account (e.g. PA-2)",
    )
    .addOption(
      new Option(
        "-i, --commitment <index>",
        "Deprecated: 0-based spendable commitment index (use --from-pa)",
      ).hideHelp(),
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting; format: envelope (default) or tx",
      ).choices(["envelope", "tx"]),
    )
    .addOption(
      new Option(
        "--unsigned-format <format>",
        "Deprecated: use --unsigned [format]",
      ).hideHelp(),
    )
    .option("--dry-run", "Generate proof and validate without submitting")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/ragequit.js"),
        "handleRagequitCommand",
      ),
    );
}
