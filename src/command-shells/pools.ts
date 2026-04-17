import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";
import { SUPPORTED_SORT_MODES } from "../utils/pools-sort.js";

export function createPoolsCommand(): Command {
  const metadata = getCommandMetadata("pools");
  return new Command("pools")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol for detail view (e.g. ETH, BOLD)")
    .option(
      "--include-testnets",
      "Include supported testnets (default: CLI-supported mainnet chains only)",
    )
    .addOption(
      new Option(
        "--all-chains",
        "Include supported testnets (default: CLI-supported mainnet chains only)",
      ).hideHelp(),
    )
    .option("--search <query>", "Filter by chain/symbol/address/scope")
    .addOption(
      new Option(
        "--sort <mode>",
        `Sort mode (${SUPPORTED_SORT_MODES.join(", ")})`,
      )
        .choices([...SUPPORTED_SORT_MODES])
        .default("tvl-desc"),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsCommand",
      ),
    );
}
