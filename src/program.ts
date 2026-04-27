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
import { setCommandAliasDeprecationWarning } from "./utils/root-alias-metadata.js";

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
  "recipients",
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

type CommandSpec = {
  name: RootCommandName;
  handlerId: string;
  loader: () => Promise<Command>;
};

type AliasSpec = {
  name: string;
  aliasOf: RootCommandName;
  deprecationWarning?: {
    code: string;
    message: string;
    replacementCommand: string;
  };
};

class CommandRegistry {
  private readonly byName = new Map<RootCommandName, CommandSpec>();
  private readonly byHandlerId = new Map<string, RootCommandName>();
  private readonly aliases = new Map<string, AliasSpec>();

  register(spec: CommandSpec): void {
    if (this.byName.has(spec.name)) {
      throw new Error(`Root command '${spec.name}' is already registered.`);
    }
    const existing = this.byHandlerId.get(spec.handlerId);
    if (existing) {
      throw new Error(
        `Handler '${spec.handlerId}' is already registered as '${existing}'. ` +
          "Use registerAlias() when a duplicate surface is intentional.",
      );
    }
    this.byName.set(spec.name, spec);
    this.byHandlerId.set(spec.handlerId, spec.name);
  }

  registerAlias(spec: AliasSpec): void {
    if (this.byName.has(spec.name as RootCommandName) || this.aliases.has(spec.name)) {
      throw new Error(`Root command alias '${spec.name}' is already registered.`);
    }
    if (!this.byName.has(spec.aliasOf)) {
      throw new Error(`Root command alias '${spec.name}' targets unknown '${spec.aliasOf}'.`);
    }
    this.aliases.set(spec.name, spec);
  }

  resolve(token: string | undefined): RootCommandName | null {
    if (!token) return null;
    const alias = this.aliases.get(token);
    if (alias) return alias.aliasOf;
    return this.byName.has(token as RootCommandName)
      ? (token as RootCommandName)
      : null;
  }

  alias(token: string | undefined): AliasSpec | null {
    if (!token) return null;
    return this.aliases.get(token) ?? null;
  }

  loader(name: RootCommandName): () => Promise<Command> {
    const spec = this.byName.get(name);
    if (!spec) {
      throw new Error(`Root command '${name}' is not registered.`);
    }
    return spec.loader;
  }
}

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
  recipients: async () =>
    (await import("./command-shells/recipients.js")).createRecipientsCommand(),
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

const ROOT_COMMAND_HANDLER_IDS: Record<RootCommandName, string> = {
  init: "command-shells/init.js#createInitCommand",
  upgrade: "command-shells/upgrade.js#createUpgradeCommand",
  config: "command-shells/config.js#createConfigCommand",
  flow: "command-shells/flow.js#createFlowCommand",
  simulate: "command-shells/simulate.js#createSimulateCommand",
  pools: "command-shells/pools.js#createPoolsCommand",
  deposit: "command-shells/deposit.js#createDepositCommand",
  accounts: "command-shells/accounts.js#createAccountsCommand",
  migrate: "command-shells/migrate.js#createMigrateCommand",
  withdraw: "command-shells/withdraw.js#createWithdrawCommand",
  recipients: "command-shells/recipients.js#createRecipientsCommand",
  ragequit: "command-shells/ragequit.js#createRagequitCommand",
  broadcast: "command-shells/broadcast.js#createBroadcastCommand",
  history: "command-shells/history.js#createHistoryCommand",
  sync: "command-shells/sync.js#createSyncCommand",
  "tx-status": "command-shells/tx-status.js#createTxStatusCommand",
  status: "command-shells/status.js#createStatusCommand",
  activity: "command-shells/activity.js#createActivityCommand",
  "protocol-stats": "command-shells/stats.js#createProtocolStatsCommand",
  "pool-stats": "command-shells/stats.js#createPoolStatsCommand",
  stats: "command-shells/stats.js#createStatsCommand",
  guide: "command-shells/guide.js#createGuideCommand",
  capabilities: "command-shells/capabilities.js#createCapabilitiesCommand",
  describe: "command-shells/describe.js#createDescribeCommand",
  completion: "command-shells/completion.js#createCompletionCommand",
};

const ROOT_COMMAND_REGISTRY = new CommandRegistry();
for (const name of ROOT_COMMAND_NAMES) {
  ROOT_COMMAND_REGISTRY.register({
    name,
    handlerId: ROOT_COMMAND_HANDLER_IDS[name],
    loader: ROOT_COMMAND_LOADERS[name],
  });
}
ROOT_COMMAND_REGISTRY.registerAlias({
  name: "recents",
  aliasOf: "recipients",
  deprecationWarning: {
    code: "COMMAND_ALIAS_DEPRECATED",
    message:
      "Command alias 'recents' is deprecated and will be removed in v3.x. Use 'recipients' instead.",
    replacementCommand: "privacy-pools recipients",
  },
});

function resolveRootCommandName(token: string | undefined): RootCommandName | null {
  if (!token) return null;
  return ROOT_COMMAND_REGISTRY.resolve(token);
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
  aliasSpec: AliasSpec | null = null,
): Promise<void> {
  const commands = await Promise.all(
    commandNames.map((name) => ROOT_COMMAND_REGISTRY.loader(name)()),
  );
  for (const command of commands) {
    if (command.name() === aliasSpec?.aliasOf) {
      setCommandAliasDeprecationWarning(command, aliasSpec.deprecationWarning);
    }
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
  const [firstToken, secondToken] = allNonOptionTokens(argv ?? []);
  const aliasToken = firstToken === "help" ? secondToken : firstToken;
  await addRootCommands(
    program,
    commandNames,
    ROOT_COMMAND_REGISTRY.alias(aliasToken),
  );
  applyExitOverrideRecursively(program);

  return program;
}
