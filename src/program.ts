import { Command, Option } from "commander";
import {
  rootHelpFooterPlain,
  rootHelpFooterStyled,
} from "./utils/root-help-footer.js";
import { rootGlobalFlagDescription } from "./utils/root-global-flags.js";

const ROOT_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "--chain",
  "--format",
  "-r",
  "--rpc-url",
  "--timeout",
]);

const ROOT_COMMAND_NAMES = [
  "init",
  "pools",
  "deposit",
  "accounts",
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
  pools: async () => (await import("./command-shells/pools.js")).createPoolsCommand(),
  deposit: async () =>
    (await import("./command-shells/deposit.js")).createDepositCommand(),
  accounts: async () =>
    (await import("./command-shells/accounts.js")).createAccountsCommand(),
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

function allNonOptionTokens(args: string[]): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("-")) {
      tokens.push(token);
      continue;
    }
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return tokens;
}

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

  program.addHelpText(
    "after",
    styledHelp ? await rootHelpFooterStyled() : rootHelpFooterPlain(),
  );
  program.exitOverride();

  const commandNames = loadAllCommands
    ? ROOT_COMMAND_NAMES
    : resolveRootCommandsForInvocation(argv);
  await addRootCommands(program, commandNames);

  return program;
}
