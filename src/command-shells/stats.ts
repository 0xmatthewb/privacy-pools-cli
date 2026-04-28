import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createProtocolStatsCommand(): Command {
  const metadata = getCommandMetadata("protocol-stats");
  return new Command("protocol-stats")
    .description(metadata.description)
    .option("-n, --limit <n>", "Limit repeated rows in tabular stats output")
    .addHelpText("after", "\nNote: protocol-stats is always cross-chain; --chain is not supported. Use pool-stats <asset> --chain <chain> for a chain-scoped pool view.\n")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handleProtocolStatsCommand",
      ),
    );
}

export function createPoolStatsCommand(): Command {
  const metadata = getCommandMetadata("pool-stats");
  return new Command("pool-stats")
    .description(metadata.description)
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .option("-n, --limit <n>", "Limit repeated rows in tabular stats output")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handlePoolStatsCommand",
      ),
    );
}

export function createStatsCommand(): Command {
  const metadata = getCommandMetadata("stats");
  const globalMetadata = getCommandMetadata("protocol-stats");
  const poolMetadata = getCommandMetadata("pool-stats");
  const command = new Command("stats")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handleDeprecatedStatsDefaultAliasCommand",
      ),
    );

  command
    .command("global", { isDefault: true })
    .description(globalMetadata.description)
    .option("-n, --limit <n>", "Limit repeated rows in tabular stats output")
    .addHelpText("after", commandHelpText(globalMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handleDeprecatedStatsGlobalAliasCommand",
      ),
    );

  command
    .command("pool")
    .description(poolMetadata.description)
    .argument("[asset]", "Asset symbol (e.g. ETH, USDC)")
    .option("-n, --limit <n>", "Limit repeated rows in tabular stats output")
    .addHelpText("after", commandHelpText(poolMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/stats.js"),
        "handleDeprecatedStatsPoolAliasCommand",
      ),
    );

  return command;
}
