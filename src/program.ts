import { Command, Option } from "commander";
import {
  rootHelpFooterPlain,
  rootHelpFooterStyled,
} from "./utils/root-help-footer.js";
import { rootGlobalFlagDescription } from "./utils/root-global-flags.js";
import { allNonOptionTokens } from "./utils/root-argv.js";

const ROOT_COMMAND_NAMES = [
  "init",
  "upgrade",
  "flow",
  "pools",
  "deposit",
  "accounts",
  "migrate",
  "withdraw",
  "ragequit",
  "history",
  "sync",
  "status",
  "activity",
  "stats",
  "guide",
  "capabilities",
  "describe",
  "completion",
] as const;

type RootCommandName = (typeof ROOT_COMMAND_NAMES)[number];

const ROOT_COMMAND_ALIASES: Record<string, RootCommandName> = {
  exit: "ragequit",
};

const ROOT_COMMAND_LOADERS: Record<RootCommandName, () => Promise<Command>> = {
  init: async () => (await import("./command-shells/init.js")).createInitCommand(),
  upgrade: async () =>
    (await import("./command-shells/upgrade.js")).createUpgradeCommand(),
  flow: async () => (await import("./command-shells/flow.js")).createFlowCommand(),
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
  history: async () =>
    (await import("./command-shells/history.js")).createHistoryCommand(),
  sync: async () => (await import("./command-shells/sync.js")).createSyncCommand(),
  status: async () =>
    (await import("./command-shells/status.js")).createStatusCommand(),
  activity: async () =>
    (await import("./command-shells/activity.js")).createActivityCommand(),
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
        "--format <format>",
        rootGlobalFlagDescription("--format <format>"),
      ).choices(["table", "csv", "json"]),
    )
    .option("-y, --yes", rootGlobalFlagDescription("-y, --yes"));

  // Registration order here determines the flag order in `--help` output.
  // Keep it in sync with ROOT_HELP_BASE_LINES in src/utils/root-help.ts.
  program.addOption(
    new Option(
      "-r, --rpc-url <url>",
      rootGlobalFlagDescription("-r, --rpc-url <url>"),
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
