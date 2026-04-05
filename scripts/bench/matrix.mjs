import { LAUNCHER_BINARY_OVERRIDE_RUNTIME } from "./constants.mjs";

export const COMMAND_FAMILY_LABELS = {
  "static-local": "static/local",
  "heavy-help": "heavy help",
  "js-read-only": "js read-only/config",
  "native-public-read-only": "native public read-only",
};

const BENCH_CHAIN_RPC_FIXTURES = {
  mainnet: {
    envVar: "PRIVACY_POOLS_RPC_URL_MAINNET",
    chainId: 1,
    entrypoint: "0x6818809eefce719e480a7526d76bd3e561526b46",
    poolAddress: "0x1111111111111111111111111111111111111111",
    scope: 12345n,
    blockNumber: 1n,
  },
  arbitrum: {
    envVar: "PRIVACY_POOLS_RPC_URL_ARBITRUM",
    chainId: 42161,
    entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
    poolAddress: "0x2222222222222222222222222222222222222222",
    scope: 22345n,
    blockNumber: 1n,
  },
  optimism: {
    envVar: "PRIVACY_POOLS_RPC_URL_OPTIMISM",
    chainId: 10,
    entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
    poolAddress: "0x3333333333333333333333333333333333333333",
    scope: 32345n,
    blockNumber: 1n,
  },
  sepolia: {
    envVar: "PRIVACY_POOLS_RPC_URL_SEPOLIA",
    chainId: 11155111,
    entrypoint: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
    poolAddress: "0x1234567890abcdef1234567890abcdef12345678",
    scope: 12345n,
    blockNumber: 1n,
  },
  "op-sepolia": {
    envVar: "PRIVACY_POOLS_RPC_URL_OP_SEPOLIA",
    chainId: 11155420,
    entrypoint: "0x54aca0d27500669fa37867233e05423701f11ba1",
    poolAddress: "0x4444444444444444444444444444444444444444",
    scope: 42345n,
    blockNumber: 1n,
  },
};

function aspAndMainnetRpcEnv({ fixtureUrl, rpcUrls }) {
  return {
    PRIVACY_POOLS_ASP_HOST: fixtureUrl,
    PRIVACY_POOLS_RPC_URL_ETHEREUM: rpcUrls.mainnet,
    PRIVACY_POOLS_RPC_URL_MAINNET: rpcUrls.mainnet,
    PRIVACY_POOLS_RPC_URL_ARBITRUM: rpcUrls.arbitrum,
    PRIVACY_POOLS_RPC_URL_OPTIMISM: rpcUrls.optimism,
  };
}

export const COMMAND_MATRICES = {
  default: [
    {
      family: "static-local",
      label: "--help",
      args: ["--help"],
    },
    {
      family: "static-local",
      label: "--version",
      args: ["--version"],
    },
    {
      family: "static-local",
      label: "capabilities --agent",
      args: ["capabilities", "--agent"],
    },
    {
      family: "static-local",
      label: "describe withdraw quote --agent",
      args: ["describe", "withdraw", "quote", "--agent"],
    },
    {
      family: "heavy-help",
      label: "flow --help",
      args: ["flow", "--help"],
    },
    {
      family: "heavy-help",
      label: "migrate --help",
      args: ["migrate", "--help"],
    },
    {
      family: "js-read-only",
      label: "status --json --no-check",
      args: ["status", "--json", "--no-check"],
      isolateHome: true,
      skipDirectNative: true,
    },
    {
      family: "native-public-read-only",
      label: "pools --agent",
      args: ["pools", "--agent"],
      env: aspAndMainnetRpcEnv,
    },
    {
      family: "native-public-read-only",
      label: "pools --agent --chain sepolia",
      args: ["--chain", "sepolia", "pools", "--agent"],
      env: ({ fixtureUrl, rpcUrls }) => ({
        PRIVACY_POOLS_ASP_HOST: fixtureUrl,
        PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcUrls.sepolia,
      }),
    },
    {
      family: "native-public-read-only",
      label: "activity --agent",
      args: ["activity", "--agent"],
      env: ({ fixtureUrl }) => ({
        PRIVACY_POOLS_ASP_HOST: fixtureUrl,
      }),
    },
    {
      family: "native-public-read-only",
      label: "activity --agent --chain sepolia --asset ETH",
      args: ["--chain", "sepolia", "activity", "--agent", "--asset", "ETH"],
      env: ({ fixtureUrl, rpcUrls }) => ({
        PRIVACY_POOLS_ASP_HOST: fixtureUrl,
        PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcUrls.sepolia,
      }),
    },
    {
      family: "native-public-read-only",
      label: "stats --agent",
      args: ["stats", "--agent"],
      env: ({ fixtureUrl }) => ({
        PRIVACY_POOLS_ASP_HOST: fixtureUrl,
      }),
    },
    {
      family: "native-public-read-only",
      label: "stats pool --agent --chain sepolia --asset ETH",
      args: ["--chain", "sepolia", "stats", "pool", "--asset", "ETH", "--agent"],
      env: ({ fixtureUrl, rpcUrls }) => ({
        PRIVACY_POOLS_ASP_HOST: fixtureUrl,
        PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcUrls.sepolia,
      }),
    },
  ],
  readonly: [
    {
      family: "js-read-only",
      label: "accounts --agent --chain sepolia --no-sync --summary",
      args: ["accounts", "--agent", "--chain", "sepolia", "--no-sync", "--summary"],
      fixtureHome: "sepolia-readonly",
      skipDirectNative: true,
    },
    {
      family: "js-read-only",
      label: "accounts --agent --chain sepolia --no-sync --pending-only",
      args: [
        "accounts",
        "--agent",
        "--chain",
        "sepolia",
        "--no-sync",
        "--pending-only",
      ],
      fixtureHome: "sepolia-readonly",
      skipDirectNative: true,
    },
    {
      family: "js-read-only",
      label: "history --agent --chain sepolia --no-sync",
      args: ["history", "--agent", "--chain", "sepolia", "--no-sync"],
      fixtureHome: "sepolia-readonly",
      skipDirectNative: true,
    },
    {
      family: "js-read-only",
      label: "migrate status --agent --chain mainnet",
      args: ["migrate", "status", "--agent", "--chain", "mainnet"],
      fixtureHome: "mainnet-migrate",
      env: ({ fixtureUrl, rpcUrls }) => ({
        PRIVACY_POOLS_ASP_HOST: fixtureUrl,
        PRIVACY_POOLS_RPC_URL_ETHEREUM: rpcUrls.mainnet,
        PRIVACY_POOLS_RPC_URL_MAINNET: rpcUrls.mainnet,
      }),
      preferredRuntime: LAUNCHER_BINARY_OVERRIDE_RUNTIME,
      skipDirectNative: true,
    },
  ],
};

export function getCommandMatrix(name) {
  const matrix = COMMAND_MATRICES[name];
  if (!matrix) {
    throw new Error(`Unknown benchmark matrix: ${name}`);
  }
  return matrix;
}

export function getRpcFixtureConfigs() {
  return BENCH_CHAIN_RPC_FIXTURES;
}
