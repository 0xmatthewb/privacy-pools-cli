import { chmodSync } from "node:fs";
import type { CliRunOptions } from "./cli.ts";
import { createTempHome } from "./cli.ts";
import {
  emptyPoolsFixtureEnv,
  fixtureEnv,
  fixtureWithRelayerEnv,
  multiChainFixtureEnv,
} from "./native-shell.ts";

export type GoldenEnvironment =
  | "none"
  | "fixture"
  | "fixture-relayer"
  | "empty-fixture"
  | "multi-fixture"
  | "offline-asp"
  | "readonly-home";

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
    name: "describe/pools-stats-human",
    args: ["describe", "pools", "stats"],
    env: "none",
    format: "text",
    stream: "stderr",
    status: 0,
  },
  {
    name: "pools/stats-global-human",
    args: ["pools", "stats"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/stats-global-wide-human",
    args: ["--output", "wide", "pools", "stats"],
    env: "fixture",
    format: "text",
    stream: "stdout",
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
    stream: "stdout",
    status: 0,
  },
  {
    name: "pools/activity-global-human",
    args: ["pools", "activity"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/activity-sepolia-human",
    args: ["--chain", "sepolia", "pools", "activity"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/activity-sepolia-wide-human",
    args: ["--output", "wide", "--chain", "sepolia", "pools", "activity"],
    env: "fixture",
    format: "text",
    stream: "stdout",
    status: 0,
  },
  {
    name: "pools/stats-pool-sepolia-human",
    args: ["--chain", "sepolia", "pools", "stats", "ETH"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/show-sepolia-human",
    args: ["--chain", "sepolia", "pools", "show", "ETH"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/empty-sepolia-human",
    args: ["--chain", "sepolia", "pools"],
    env: "empty-fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/no-results-sepolia-human",
    args: ["--chain", "sepolia", "pools", "--search", "NOPE"],
    env: "fixture",
    format: "text",
    stream: "stderr",
    status: 0,
    sharedNative: true,
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
    name: "describe/pools-stats-agent",
    args: ["--agent", "describe", "pools", "stats"],
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
    name: "pools/stats-global-agent",
    args: ["--agent", "pools", "stats"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "status/aggregated-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "status", "--check", "--aggregated"],
    env: "fixture-relayer",
    format: "json",
    status: 0,
  },
  {
    name: "status/home-not-writable-agent",
    args: ["--agent", "status", "--check", "none"],
    env: "readonly-home",
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
    name: "pools/activity-global-agent",
    args: ["--agent", "pools", "activity"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/activity-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "pools", "activity"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/stats-pool-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "pools", "stats", "ETH"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/show-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "pools", "show", "ETH"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/empty-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "pools"],
    env: "empty-fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "pools/no-results-sepolia-agent",
    args: ["--agent", "--chain", "sepolia", "pools", "--search", "NOPE"],
    env: "fixture",
    format: "json",
    status: 0,
    sharedNative: true,
  },
  {
    name: "errors/pools-multichain-rpc-url-agent",
    args: ["--agent", "pools", "--rpc-url", "http://rpc.local"],
    env: "none",
    format: "json",
    status: 2,
  },
  {
    name: "errors/pools-stats-global-chain-agent",
    args: ["--agent", "--chain", "sepolia", "pools", "stats"],
    env: "fixture",
    format: "json",
    status: 2,
  },
  {
    name: "errors/pools-activity-offline-agent",
    args: ["--agent", "--chain", "mainnet", "pools", "activity"],
    env: "offline-asp",
    format: "json",
    status: 3,
  },
  {
    name: "errors/pools-stats-offline-agent",
    args: ["--agent", "pools", "stats"],
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
    TERM: "xterm-256color",
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
    case "fixture-relayer":
      return {
        env: {
          ...textDefaults,
          ...fixtureWithRelayerEnv(fixture!),
        },
      };
    case "empty-fixture":
      return {
        env: {
          ...textDefaults,
          ...emptyPoolsFixtureEnv(fixture!),
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
    case "readonly-home": {
      const home = createTempHome("pp-golden-readonly-home-");
      if (process.platform !== "win32") {
        chmodSync(home, 0o500);
      }
      return {
        home,
        env: textDefaults,
      };
    }
    case "none":
    default:
      return {
        env: textDefaults,
      };
  }
}
