import { Command, Option } from "commander";
import {
  rootHelpFooterPlain,
  rootHelpFooterStyled,
} from "./utils/root-help-footer.js";
import {
  rootGlobalFlagDescription,
  rootGlobalFlagValues,
} from "./utils/root-global-flags.js";
import { allNonOptionTokens } from "./utils/root-argv.js";
import { isGuideTopic } from "./utils/help.js";

const ROOT_COMMAND_NAMES = [
  "init",
  "upgrade",
  "config",
  "flow",
  "simulate",
  "pools",
  "deposit",
  "accounts",
  "migrate",
  "withdraw",
  "ragequit",
  "broadcast",
  "history",
  "sync",
  "tx-status",
  "status",
  "activity",
  "protocol-stats",
  "pool-stats",
  "stats",
  "guide",
  "capabilities",
  "describe",
  "completion",
] as const;

type RootCommandName = (typeof ROOT_COMMAND_NAMES)[number];

const ROOT_COMMAND_ALIASES: Record<string, RootCommandName> = {};

const ROOT_COMMAND_LOADERS: Record<RootCommandName, () => Promise<Command>> = {
  init: async () => (await import("./command-shells/init.js")).createInitCommand(),
  upgrade: async () =>
    (await import("./command-shells/upgrade.js")).createUpgradeCommand(),
  config: async () =>
    (await import("./command-shells/config.js")).createConfigCommand(),
  flow: async () => (await import("./command-shells/flow.js")).createFlowCommand(),
  simulate: async () =>
    (await import("./command-shells/simulate.js")).createSimulateCommand(),
  pools: async () => (await import("./command-shells/pools.js")).createPoolsCommand(),
  deposit: async () =>
    (await import("./command-shells/deposit.js")).createDepositCommand(),
  accounts: async () =>
    (await import("./command-shells/accounts.js")).createAccountsCommand(),
  migrate: async () =>
    (await import("./command-shells/migrate.js")).createMigrateCommand(),
  withdraw: async () =>
    (await import("./command-shells/withdraw.js")).createWithdrawCommand(),
  ragequit: async () =>
    (await import("./command-shells/ragequit.js")).createRagequitCommand(),
  broadcast: async () =>
    (await import("./command-shells/broadcast.js")).createBroadcastCommand(),
  history: async () =>
    (await import("./command-shells/history.js")).createHistoryCommand(),
  sync: async () => (await import("./command-shells/sync.js")).createSyncCommand(),
  "tx-status": async () =>
    (await import("./command-shells/tx-status.js")).createTxStatusCommand(),
  status: async () =>
    (await import("./command-shells/status.js")).createStatusCommand(),
  activity: async () =>
    (await import("./command-shells/activity.js")).createActivityCommand(),
  "protocol-stats": async () =>
    (await import("./command-shells/stats.js")).createProtocolStatsCommand(),
  "pool-stats": async () =>
    (await import("./command-shells/stats.js")).createPoolStatsCommand(),
  stats: async () => (await import("./command-shells/stats.js")).createStatsCommand(),
  guide: async () => (await import("./command-shells/guide.js")).createGuideCommand(),
  capabilities: async () =>
    (await import("./command-shells/capabilities.js")).createCapabilitiesCommand(),
  describe: async () =>
    (await import("./command-shells/describe.js")).createDescribeCommand(),
  completion: async () =>
    (await import("./command-shells/completion.js")).createCompletionCommand(),
};

function resolveRootCommandName(token: string | undefined): RootCommandName | null {
  if (!token) return null;
  if (token in ROOT_COMMAND_ALIASES) {
    return ROOT_COMMAND_ALIASES[token];
  }
  return ROOT_COMMAND_NAMES.includes(token as RootCommandName)
    ? (token as RootCommandName)
    : null;
}

function resolveRootCommandsForInvocation(argv: string[] | undefined): RootCommandName[] {
  if (!argv) return [...ROOT_COMMAND_NAMES];

  const [firstToken, secondToken] = allNonOptionTokens(argv);
  if (!firstToken) return [...ROOT_COMMAND_NAMES];

  if (firstToken === "help") {
    if (isGuideTopic(secondToken)) {
      return [];
    }
    const helpTarget = resolveRootCommandName(secondToken);
    return helpTarget ? [helpTarget] : [...ROOT_COMMAND_NAMES];
  }

  const requested = resolveRootCommandName(firstToken);
  return requested ? [requested] : [...ROOT_COMMAND_NAMES];
}

async function addRootCommands(
  program: Command,
  commandNames: readonly RootCommandName[],
): Promise<void> {
  const commands = await Promise.all(
    commandNames.map((name) => ROOT_COMMAND_LOADERS[name]()),
  );
  for (const command of commands) {
    program.addCommand(command);
  }
}

function applyExitOverrideRecursively(command: Command): void {
  command.exitOverride();
  for (const subcommand of command.commands) {
    applyExitOverrideRecursively(subcommand);
  }
}

export interface CreateRootProgramOptions {
  argv?: string[];
  loadAllCommands?: boolean;
  styledHelp?: boolean;
}

export async function createRootProgram(
  version: string,
  options: CreateRootProgramOptions = {},
): Promise<Command> {
  const {
    argv,
    loadAllCommands = true,
    styledHelp = true,
  } = options;
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
        "-o, --output <format>",
        rootGlobalFlagDescription("-o, --output <format>"),
      ).choices([...rootGlobalFlagValues("-o, --output <format>")]),
    )
    .option("-y, --yes", rootGlobalFlagDescription("-y, --yes"))
    .option("--web", rootGlobalFlagDescription("--web"))
    .option(
      "--help-brief",
      rootGlobalFlagDescription("--help-brief"),
    )
    .option(
      "--help-full",
      rootGlobalFlagDescription("--help-full"),
    );

  // Registration order here determines the flag order in `--help` output.
  // Keep it in sync with ROOT_HELP_BASE_LINES in src/utils/root-help.ts.
  program.addOption(
    new Option(
      "-r, --rpc-url <url>",
      rootGlobalFlagDescription("-r, --rpc-url <url>"),
    ),
  );
  program.addOption(
    new Option(
      "--json-fields <fields>",
      rootGlobalFlagDescription("--json-fields <fields>"),
    ).hideHelp(),
  );
  program.addOption(
    new Option(
      "--template <template>",
      rootGlobalFlagDescription("--template <template>"),
    ),
  );
  program.addOption(
    new Option("--agent", rootGlobalFlagDescription("--agent")),
  );
  program.addOption(
    new Option("-q, --quiet", rootGlobalFlagDescription("-q, --quiet")),
  );
  program.addOption(
    new Option(
      "-v, --verbose",
      rootGlobalFlagDescription("-v, --verbose"),
    ),
  );
  // Commander interprets --no-xxx as negation of --xxx, setting
  // opts().progress = false.  We handle this in resolveGlobalMode().
  program.addOption(
    new Option(
      "--no-progress",
      rootGlobalFlagDescription("--no-progress"),
    ),
  );
  program.addOption(
    new Option(
      "--no-header",
      rootGlobalFlagDescription("--no-header"),
    ),
  );
  program.addOption(
    new Option(
      "--no-banner",
      rootGlobalFlagDescription("--no-banner"),
    ),
  );
  program.addOption(
    new Option(
      "--no-color",
      rootGlobalFlagDescription("--no-color"),
    ),
  );
  program.addOption(
    new Option(
      "--timeout <seconds>",
      rootGlobalFlagDescription("--timeout <seconds>"),
    ),
  );
  program.addOption(
    new Option(
      "--jmes <expression>",
      rootGlobalFlagDescription("--jmes <expression>"),
    ),
  );
  program.addOption(
    new Option(
      "--jq <expression>",
      rootGlobalFlagDescription("--jq <expression>"),
    ),
  );
  program.addOption(
    new Option(
      "--profile <name>",
      rootGlobalFlagDescription("--profile <name>"),
    ),
  );

  program.configureHelp({
    subcommandTerm(cmd) {
      const aliases = cmd.aliases();
      return aliases.length > 0 ? `${cmd.name()}|${aliases[0]}` : cmd.name();
    },
  });

  program.addHelpText(
    "after",
    styledHelp ? await rootHelpFooterStyled() : rootHelpFooterPlain(),
  );

  const commandNames = loadAllCommands
    ? ROOT_COMMAND_NAMES
    : resolveRootCommandsForInvocation(argv);
  await addRootCommands(program, commandNames);
  applyExitOverrideRecursively(program);

  return program;
}
