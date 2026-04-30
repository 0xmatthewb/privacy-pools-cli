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
  const showMetadata = getCommandMetadata("pools show");
  const activityMetadata = getCommandMetadata("pools activity");
  const statsMetadata = getCommandMetadata("pools stats");
  const command = addPoolsListOptions(
    new Command("pools")
    .description(metadata.description)
    .argument("[asset]", "Deprecated detail shortcut; use `pools show <asset>`"),
  )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsCommand",
      ),
    );

  command
    .command("show")
    .description(showMetadata.description)
    .argument("<asset>", "Asset symbol for detail view (e.g. ETH, BOLD)")
    .addHelpText("after", commandHelpText(showMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsShowCommand",
      ),
    );

  command
    .command("activity")
    .description(activityMetadata.description)
    .argument("[asset]", "Asset symbol to filter (e.g. ETH, USDC)")
    .option(
      "--include-testnets",
      "Include supported testnets (default: CLI-supported mainnet chains only)",
    )
    .option("--page <n>", "Page number", "1")
    .option("-n, --limit <n>", "Items per page", "12")
    .addHelpText("after", commandHelpText(activityMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsActivityCommand",
      ),
    );

  command
    .command("stats")
    .description(statsMetadata.description)
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .option("-n, --limit <n>", "Limit repeated rows in tabular stats output")
    .addHelpText("after", commandHelpText(statsMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/pools.js"),
        "handlePoolsStatsCommand",
      ),
    );

  return command;
}
