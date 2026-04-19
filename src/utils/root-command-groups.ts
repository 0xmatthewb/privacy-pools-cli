import type { CommandGroup } from "../types.js";

export type RootCommandName =
  | "init"
  | "status"
  | "tx-status"
  | "guide"
  | "flow"
  | "simulate"
  | "deposit"
  | "withdraw"
  | "ragequit"
  | "broadcast"
  | "accounts"
  | "pools"
  | "history"
  | "activity"
  | "protocol-stats"
  | "pool-stats"
  | "stats"
  | "sync"
  | "migrate"
  | "upgrade"
  | "config"
  | "completion"
  | "capabilities"
  | "describe";

export interface RootCommandGroup {
  id: CommandGroup;
  heading: string;
  commands: RootCommandName[];
}

export const ROOT_COMMAND_DESCRIPTIONS: Record<RootCommandName, string> = {
  init: "Create, load, or finish setting up your Privacy Pools account",
  status: "Check account setup and network status",
  "tx-status": "Check async transaction submission status",
  guide: "Learn key concepts, workflows, and troubleshooting",
  flow: "Deposit and privately withdraw in one guided workflow",
  simulate: "Preview deposit, withdraw, and ragequit without submitting",
  deposit: "Deposit ETH or ERC-20 tokens into a pool",
  withdraw: "Withdraw privately from a pool",
  ragequit: "Recover funds publicly to your deposit address",
  broadcast: "Broadcast a signed envelope or relayer request built elsewhere",
  accounts: "View balances, approval status, and pool accounts",
  pools: "Browse available pools",
  history: "View your deposit and withdrawal history",
  activity: "View recent deposits and withdrawals across pools",
  "protocol-stats": "View aggregate network statistics",
  "pool-stats": "View statistics for one pool",
  stats: "Deprecated compatibility alias for protocol-stats and pool-stats",
  sync: "Sync account state with the latest onchain data",
  migrate: "Check migration status for legacy pool accounts",
  upgrade: "Check for CLI updates",
  config: "View and manage CLI configuration",
  completion: "Generate or install shell tab completion",
  capabilities: "Describe CLI capabilities for agents",
  describe: "Describe a command's flags, args, and output schema",
};

export const ROOT_COMMAND_HELP_LABELS: Record<RootCommandName, string> = {
  init: "init",
  status: "status",
  "tx-status": "tx-status",
  guide: "guide",
  flow: "flow",
  simulate: "simulate",
  deposit: "deposit",
  withdraw: "withdraw",
  ragequit: "ragequit|exit",
  broadcast: "broadcast",
  accounts: "accounts",
  pools: "pools",
  history: "history",
  activity: "activity",
  "protocol-stats": "protocol-stats",
  "pool-stats": "pool-stats",
  stats: "stats",
  sync: "sync",
  migrate: "migrate",
  upgrade: "upgrade",
  config: "config",
  completion: "completion",
  capabilities: "capabilities",
  describe: "describe",
};

export const ROOT_COMMAND_GROUPS: RootCommandGroup[] = [
  {
    id: "getting-started",
    heading: "Getting started",
    commands: ["init", "status", "guide"],
  },
  {
    id: "transaction",
    heading: "Transactions",
    commands: ["flow", "simulate", "deposit", "withdraw", "ragequit", "broadcast"],
  },
  {
    id: "monitoring",
    heading: "Monitoring",
    commands: [
      "accounts",
      "pools",
      "history",
      "activity",
      "protocol-stats",
      "pool-stats",
      "stats",
      "sync",
      "tx-status",
    ],
  },
  {
    id: "advanced",
    heading: "Advanced",
    commands: [
      "migrate",
      "upgrade",
      "config",
      "completion",
      "capabilities",
      "describe",
    ],
  },
];

export const ROOT_COMMAND_ORDER: RootCommandName[] = [
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
];

const ROOT_COMMAND_GROUP_BY_NAME = Object.fromEntries(
  ROOT_COMMAND_GROUPS.flatMap((group) =>
    group.commands.map((command) => [command, group.id]),
  ),
) as Record<RootCommandName, CommandGroup>;

export function rootCommandGroupIdFor(
  commandPath: string,
): CommandGroup {
  const [rootCommand] = commandPath.split(/\s+/, 1);
  if (!rootCommand || !(rootCommand in ROOT_COMMAND_GROUP_BY_NAME)) {
    return "advanced";
  }

  return ROOT_COMMAND_GROUP_BY_NAME[rootCommand as RootCommandName];
}
