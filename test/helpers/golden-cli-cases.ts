import type { CliRunOptions } from "./cli.ts";
import { fixtureEnv, multiChainFixtureEnv } from "./native-shell.ts";

export type GoldenEnvironment =
  | "none"
  | "fixture"
  | "multi-fixture"
  | "offline-asp";

interface GoldenCaseBase {
  args: string[];
  env: GoldenEnvironment;
  name: string;
  status: number;
  sharedNative?: boolean;
}

export interface GoldenTextCase extends GoldenCaseBase {
  format: "text";
  stream: "stdout" | "stderr";
}

export interface GoldenJsonCase extends GoldenCaseBase {
  format: "json";
}

export const GOLDEN_TEXT_CASES: readonly GoldenTextCase[] = [
  {
    name: "cli/root-help",
    args: ["--help"],
    env: "none",
    format: "text",
    stream: "stdout",
    status: 0,
    sharedNative: true,
  },
  {
    name: "cli/version",
    args: ["--version"],
    env: "none",
    format: "text",
    stream: "stdout",
    status: 0,
    sharedNative: true,
  },
  {
    name: "withdraw/quote-help",
    args: ["withdraw", "quote", "--help"],
    env: "none",
    format: "text",
    stream: "stdout",
    status: 0,
    sharedNative: true,
  },
  {
    name: "guide/index-human",
    args: ["guide"],
    env: "none",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "describe/protocol-stats-human",
    args: ["describe", "protocol-stats"],
    env: "none",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "stats/global-human",
    args: ["stats"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "stats/global-wide-human",
    args: ["--output", "wide", "stats"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "pools/sepolia-human",
    args: ["--chain", "sepolia", "pools"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/sepolia-wide-human",
    args: ["--output", "wide", "--chain", "sepolia", "pools"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "activity/global-human",
    args: ["activity"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "activity/sepolia-human",
    args: ["--chain", "sepolia", "activity"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "activity/sepolia-wide-human",
    args: ["--output", "wide", "--chain", "sepolia", "activity"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "stats/pool-sepolia-human",
    args: ["--chain", "sepolia", "stats", "pool", "ETH"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "pools/detail-sepolia-human",
    args: ["--chain", "sepolia", "pools", "ETH"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
  },
] as const;

export const GOLDEN_JSON_CASES: readonly GoldenJsonCase[] = [
  {
    name: "cli/root-help-json",
    args: ["--json", "--help"],
    env: "none",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "cli/version-json",
    args: ["--json", "--version"],
    env: "none",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "guide/index-agent",
    args: ["--agent", "guide"],
    env: "none",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "capabilities/agent",
    args: ["--agent", "capabilities"],
    env: "none",
    format: "json",
    status: 0,
  },
  {
    name: "describe/protocol-stats-agent",
    args: ["--agent", "describe", "protocol-stats"],
    env: "none",
    format: "json",
    status: 0,
  },
  {
    name: "completion/query-bash-agent",
    args: [
      "--json",
      "completion",
      "--query",
      "--shell",
      "bash",
      "--cword",
      "1",
      "--",
      "privacy-pools",
    ],
    env: "none",
    format: "json",
    status: 0,
  },
  {
    name: "stats/global-agent",
    args: ["--agent", "stats"],
    env: "fixture",
    format: "json",
    status: 0,
  },
  {
    name: "stats/global-alias-agent",
    args: ["--agent", "stats", "global"],
    env: "fixture",
    format: "json",
    status: 0,
  },
  {
    name: "pools/multichain-agent",
    args: ["--agent", "pools"],
    env: "multi-fixture",
    format: "json",
    status: 0,
  },
  {
    name: "pools/sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "pools"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "activity/global-agent",
    args: ["--agent", "activity"],
    env: "fixture",
    format: "json",
    status: 0,
  },
  {
    name: "activity/sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "activity"],
    env: "fixture",
    format: "json",
    status: 0,
  },
  {
    name: "stats/pool-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "stats", "pool", "ETH"],
    env: "fixture",
    format: "json",
    status: 0,
  },
  {
    name: "errors/pools-multichain-rpc-url-agent",
    args: ["--agent", "pools", "--rpc-url", "http://rpc.local"],
    env: "none",
    format: "json",
    status: 2,
  },
  {
    name: "errors/stats-global-chain-agent",
    args: ["--agent", "--chain", "sepolia", "stats", "global"],
    env: "fixture",
    format: "json",
    status: 2,
  },
  {
    name: "errors/activity-offline-agent",
    args: ["--agent", "--chain", "mainnet", "activity"],
    env: "offline-asp",
    format: "json",
    status: 3,
  },
  {
    name: "errors/stats-offline-agent",
    args: ["--agent", "stats"],
    env: "offline-asp",
    format: "json",
    status: 3,
  },
] as const;

export function resolveGoldenCaseRunOptions(
  environment: GoldenEnvironment,
  fixture?: { url: string } | null,
): CliRunOptions {
  const textDefaults = {
    LANG: "en_US.UTF-8",
    COLUMNS: "120",
  };

  switch (environment) {
    case "fixture":
      return {
        env: {
          ...textDefaults,
          ...fixtureEnv(fixture!),
        },
      };
    case "multi-fixture":
      return {
        env: {
          ...textDefaults,
          ...multiChainFixtureEnv(fixture!),
        },
      };
    case "offline-asp":
      return {
        env: {
          ...textDefaults,
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
        },
      };
    case "none":
    default:
      return {
        env: textDefaults,
      };
  }
}
