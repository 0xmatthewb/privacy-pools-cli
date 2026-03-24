import { Command, Option } from "commander";
import { createInitCommand } from "./command-shells/init.js";
import { createStatusCommand } from "./command-shells/status.js";
import { createPoolsCommand } from "./command-shells/pools.js";
import { createActivityCommand } from "./command-shells/activity.js";
import { createStatsCommand } from "./command-shells/stats.js";
import { createDepositCommand } from "./command-shells/deposit.js";
import { createWithdrawCommand } from "./command-shells/withdraw.js";
import { createRagequitCommand } from "./command-shells/ragequit.js";
import { createAccountsCommand } from "./command-shells/accounts.js";
import { createSyncCommand } from "./command-shells/sync.js";
import { createHistoryCommand } from "./command-shells/history.js";
import { createGuideCommand } from "./command-shells/guide.js";
import { createCapabilitiesCommand } from "./command-shells/capabilities.js";
import { createDescribeCommand } from "./command-shells/describe.js";
import { createCompletionCommand } from "./command-shells/completion.js";
import { rootHelpFooter } from "./utils/root-help-footer.js";
import { rootGlobalFlagDescription } from "./utils/root-global-flags.js";

export function createRootProgram(version: string): Command {
  const program = new Command();

  program
    .name("privacy-pools")
    .description(
      "Privacy Pools: a compliant way to transact privately on Ethereum",
    )
    .version(version)
    .option(
      "-c, --chain <name>",
      rootGlobalFlagDescription("-c, --chain <name>"),
    )
    .option("-j, --json", rootGlobalFlagDescription("-j, --json"))
    .addOption(
      new Option(
        "--format <format>",
        rootGlobalFlagDescription("--format <format>"),
      ).choices(["table", "csv", "json"]),
    )
    .option("-y, --yes", rootGlobalFlagDescription("-y, --yes"));

  program.addOption(
    new Option(
      "-r, --rpc-url <url>",
      rootGlobalFlagDescription("-r, --rpc-url <url>"),
    ).hideHelp(),
  );
  program.addOption(
    new Option("--agent", rootGlobalFlagDescription("--agent")),
  );
  program.addOption(
    new Option("-q, --quiet", rootGlobalFlagDescription("-q, --quiet")).hideHelp(),
  );
  program.addOption(
    new Option(
      "--no-banner",
      rootGlobalFlagDescription("--no-banner"),
    ).hideHelp(),
  );
  program.addOption(
    new Option(
      "-v, --verbose",
      rootGlobalFlagDescription("-v, --verbose"),
    ).hideHelp(),
  );
  program.addOption(
    new Option(
      "--timeout <seconds>",
      rootGlobalFlagDescription("--timeout <seconds>"),
    ),
  );
  program.addOption(
    new Option(
      "--no-color",
      rootGlobalFlagDescription("--no-color"),
    ).hideHelp(),
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
