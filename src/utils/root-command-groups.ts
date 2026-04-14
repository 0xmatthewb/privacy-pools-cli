export type RootCommandName =
  | "init"
  | "status"
  | "guide"
  | "flow"
  | "deposit"
  | "withdraw"
  | "ragequit"
  | "accounts"
  | "pools"
  | "history"
  | "activity"
  | "stats"
  | "sync"
  | "migrate"
  | "upgrade"
  | "config"
  | "completion"
  | "capabilities"
  | "describe";

export interface RootCommandGroup {
  heading: string;
  commands: RootCommandName[];
}

export const ROOT_COMMAND_DESCRIPTIONS: Record<RootCommandName, string> = {
  init: "Initialize or restore your Privacy Pools account",
  status: "Check account setup and network status",
  guide: "Learn key concepts, workflows, and troubleshooting",
  flow: "Deposit and privately withdraw in one guided workflow",
  deposit: "Deposit ETH or ERC-20 tokens into a pool",
  withdraw: "Withdraw privately from a pool",
  ragequit: "Recover funds publicly to your deposit address",
  accounts: "View balances, approval status, and pool accounts",
  pools: "Browse available pools",
  history: "View your deposit and withdrawal history",
  activity: "View recent deposits and withdrawals across pools",
  stats: "View pool and network statistics",
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
  guide: "guide",
  flow: "flow",
  deposit: "deposit",
  withdraw: "withdraw",
  ragequit: "ragequit|exit",
  accounts: "accounts",
  pools: "pools",
  history: "history",
  activity: "activity",
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
    heading: "Getting started",
    commands: ["init", "status", "guide"],
  },
  {
    heading: "Transactions",
    commands: ["flow", "deposit", "withdraw", "ragequit"],
  },
  {
    heading: "Monitoring",
    commands: ["accounts", "pools", "history", "activity", "stats", "sync"],
  },
  {
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
];
