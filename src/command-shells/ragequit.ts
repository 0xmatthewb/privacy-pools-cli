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
    .addOption(
      new Option(
        "-a, --asset <symbol|address>",
        "Deprecated: use positional argument instead",
      ).hideHelp(),
    )
    .option(
      "-p, --pool-account <PA-#|#>",
      "Ragequit a specific Pool Account (e.g. PA-2)",
    )
    .addOption(new Option("--from-pa <PA-#|#>", "Deprecated: use --pool-account").hideHelp())
    .addOption(
      new Option(
        "-i, --commitment <index>",
        "Deprecated: 0-based spendable commitment index (use --pool-account)",
      ).hideHelp(),
    )
    .addOption(
      new Option(
        "--unsigned [format]",
        "Build unsigned transaction without submitting (default format: envelope; or specify: --unsigned tx)",
      ).choices(["envelope", "tx"]),
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
