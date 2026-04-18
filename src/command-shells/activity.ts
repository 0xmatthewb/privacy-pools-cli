import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createActivityCommand(): Command {
  const metadata = getCommandMetadata("activity");
  return new Command("activity")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol to filter (e.g. ETH, USDC)")
    .option(
      "--include-testnets",
      "Include supported testnets (default: CLI-supported mainnet chains only)",
    )
    .option("--page <n>", "Page number", "1")
    .option("-n, --limit <n>", "Items per page", "12")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/activity.js"),
        "handleActivityCommand",
      ),
    );
}
