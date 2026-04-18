import type { CapabilityEnvVarDescriptor } from "../types.js";

export type EnvVarRegistrySection =
  | "interaction"
  | "configuration"
  | "network"
  | "runtime";

export interface EnvVarRegistryEntry extends CapabilityEnvVarDescriptor {
  section: EnvVarRegistrySection;
}

export const ENV_VAR_REGISTRY: EnvVarRegistryEntry[] = [
  {
    name: "PRIVACY_POOLS_AGENT",
    description: "Enable agent mode by default (equivalent to --agent).",
    section: "interaction",
  },
  {
    name: "PRIVACY_POOLS_QUIET",
    description: "Suppress human-oriented stderr output by default, matching --quiet.",
    section: "interaction",
  },
  {
    name: "PRIVACY_POOLS_YES",
    description: "Skip confirmation prompts by default, matching --yes.",
    section: "interaction",
  },
  {
    name: "PRIVACY_POOLS_NO_PROGRESS",
    description: "Suppress spinners/progress indicators by default, matching --no-progress.",
    section: "interaction",
  },
  {
    name: "NO_COLOR",
    description: "Disable colored output, matching --no-color.",
    section: "interaction",
  },
  {
    name: "PP_NO_UPDATE_CHECK",
    description: "Set to 1 to disable the update-available notification.",
    section: "interaction",
  },
  {
    name: "PRIVACY_POOLS_HOME",
    aliases: ["PRIVACY_POOLS_CONFIG_DIR"],
    description: "Override the CLI config directory.",
    section: "configuration",
  },
  {
    name: "XDG_CONFIG_HOME",
    description: "Fallback config base. Used as $XDG_CONFIG_HOME/privacy-pools when no Privacy Pools override is set and no legacy ~/.privacy-pools directory exists.",
    section: "configuration",
  },
  {
    name: "PRIVACY_POOLS_PRIVATE_KEY",
    description: "Signer private key; takes precedence over the saved .signer file.",
    section: "configuration",
  },
  {
    name: "PRIVACY_POOLS_CIRCUITS_DIR",
    description: "Override the circuit artifact directory with a trusted pre-provisioned path.",
    section: "configuration",
  },
  {
    name: "PRIVACY_POOLS_RPC_URL",
    aliases: ["PP_RPC_URL"],
    description: "Override the RPC endpoint for all chains.",
    section: "network",
  },
  {
    name: "PRIVACY_POOLS_ASP_HOST",
    aliases: ["PP_ASP_HOST"],
    description: "Override the ASP endpoint for all chains.",
    section: "network",
  },
  {
    name: "PRIVACY_POOLS_RELAYER_HOST",
    aliases: ["PP_RELAYER_HOST"],
    description: "Override the relayer endpoint for all chains.",
    section: "network",
  },
  {
    name: "PRIVACY_POOLS_RPC_URL_<CHAIN>",
    aliases: ["PP_RPC_URL_<CHAIN>"],
    description: "Override the RPC endpoint for one chain, for example ARBITRUM or SEPOLIA.",
    section: "network",
  },
  {
    name: "PRIVACY_POOLS_ASP_HOST_<CHAIN>",
    aliases: ["PP_ASP_HOST_<CHAIN>"],
    description: "Override the ASP endpoint for one chain.",
    section: "network",
  },
  {
    name: "PRIVACY_POOLS_RELAYER_HOST_<CHAIN>",
    aliases: ["PP_RELAYER_HOST_<CHAIN>"],
    description: "Override the relayer endpoint for one chain.",
    section: "network",
  },
  {
    name: "PRIVACY_POOLS_CLI_DISABLE_NATIVE",
    description: "Set to 1 to force the pure JS runtime path.",
    section: "runtime",
  },
  {
    name: "PRIVACY_POOLS_CLI_BINARY",
    description: "Advanced maintainer override for the launcher target native-shell binary path.",
    section: "runtime",
  },
  {
    name: "PRIVACY_POOLS_CLI_JS_WORKER",
    description: "Advanced maintainer override for the packaged JS worker entrypoint.",
    section: "runtime",
  },
];

export const CAPABILITY_ENV_VARS: CapabilityEnvVarDescriptor[] =
  ENV_VAR_REGISTRY.map(({ name, aliases, description }) => ({
    name,
    aliases,
    description,
  }));

export function envVarsForSection(
  section: EnvVarRegistrySection,
): EnvVarRegistryEntry[] {
  return ENV_VAR_REGISTRY.filter((entry) => entry.section === section);
}
