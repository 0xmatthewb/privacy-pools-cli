import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";
import { SUPPORTED_SORT_MODES } from "../utils/pools-sort.js";

function addPoolsListOptions(command: Command): Command {
  return command
    .option(
      "--include-testnets",
      "Include supported testnets (default: CLI-supported mainnet chains only)",
    )
    .option("--search <query>", "Filter by chain/symbol/address/scope")
    .option("-n, --limit <n>", "Limit rows returned")
    .addOption(
      new Option(
        "--sort <mode>",
        `Sort mode (${SUPPORTED_SORT_MODES.join(", ")})`,
      )
        .choices([...SUPPORTED_SORT_MODES])
        .default("tvl-desc"),
    );
}

export function createPoolsCommand(): Command {
  const metadata = getCommandMetadata("pools");
  const command = addPoolsListOptions(
    new Command("pools")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol for detail view (e.g. ETH, BOLD)"),
  )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsCommand",
      ),
    );

  for (const name of ["list", "ls"]) {
    addPoolsListOptions(
      command
        .command(name)
        .description(metadata.description),
    ).action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsListAliasCommand",
      ),
    );
  }

  return command;
}
