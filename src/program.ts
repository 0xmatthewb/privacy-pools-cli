import { Command, Option } from "commander";
import { createInitCommand } from "./commands/init.js";
import { createStatusCommand } from "./commands/status.js";
import { createPoolsCommand } from "./commands/pools.js";
import { createActivityCommand } from "./commands/activity.js";
import { createStatsCommand } from "./commands/stats.js";
import { createDepositCommand } from "./commands/deposit.js";
import { createWithdrawCommand } from "./commands/withdraw.js";
import { createRagequitCommand } from "./commands/ragequit.js";
import { createAccountsCommand } from "./commands/accounts.js";
import { createSyncCommand } from "./commands/sync.js";
import { createGuideCommand } from "./commands/guide.js";
import { createHistoryCommand } from "./commands/history.js";
import { createCapabilitiesCommand } from "./commands/capabilities.js";
import { createDescribeCommand } from "./commands/describe.js";
import { createCompletionCommand } from "./commands/completion.js";
import { rootHelpFooter } from "./utils/help.js";
import { GLOBAL_FLAG_METADATA } from "./utils/command-metadata.js";

function globalFlagDescription(flag: string): string {
  const match = GLOBAL_FLAG_METADATA.find((entry) => entry.flag === flag);
  if (!match) {
    throw new Error(`Missing global flag metadata for '${flag}'.`);
  }
  return match.description;
}

export function createRootProgram(version: string): Command {
  const program = new Command();

  program
    .name("privacy-pools")
    .description(
      "Privacy Pools: a compliant way to transact privately on Ethereum"
    )
    .version(version)
    .option("-c, --chain <name>", globalFlagDescription("-c, --chain <name>"))
    .option("-j, --json", globalFlagDescription("-j, --json"))
    .option("--format <format>", globalFlagDescription("--format <format>"))
    .option("-y, --yes", globalFlagDescription("-y, --yes"));

  program.addOption(
    new Option("-r, --rpc-url <url>", globalFlagDescription("-r, --rpc-url <url>")).hideHelp(),
  );
  program.addOption(
    new Option("--agent", globalFlagDescription("--agent")),
  );
  program.addOption(
    new Option("-q, --quiet", globalFlagDescription("-q, --quiet")).hideHelp(),
  );
  program.addOption(
    new Option("--no-banner", globalFlagDescription("--no-banner")).hideHelp(),
  );
  program.addOption(
    new Option("-v, --verbose", globalFlagDescription("-v, --verbose")).hideHelp(),
  );
  program.addOption(
    new Option("--timeout <seconds>", globalFlagDescription("--timeout <seconds>")),
  );
  program.addOption(
    new Option("--no-color", globalFlagDescription("--no-color")).hideHelp(),
  );

  program.configureHelp({
    subcommandTerm(cmd) {
      const aliases = cmd.aliases();
      return aliases.length > 0 ? `${cmd.name()}|${aliases[0]}` : cmd.name();
    },
  });

  program.addHelpText("after", rootHelpFooter());
  program.exitOverride();

  program.addCommand(createInitCommand());
  program.addCommand(createPoolsCommand());
  program.addCommand(createDepositCommand());
  program.addCommand(createAccountsCommand());
  program.addCommand(createWithdrawCommand());
  program.addCommand(createRagequitCommand());
  program.addCommand(createHistoryCommand());
  program.addCommand(createSyncCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createActivityCommand());
  program.addCommand(createStatsCommand());
  program.addCommand(createGuideCommand());
  program.addCommand(createCapabilitiesCommand());
  program.addCommand(createDescribeCommand());
  program.addCommand(createCompletionCommand());

  return program;
}
