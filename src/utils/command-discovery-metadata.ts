import { CHAINS, CHAIN_NAMES, POA_PORTAL_URL } from "../config/chains.js";
import {
  buildRuntimeCompatibilityDescriptor,
  CLI_PROTOCOL_PROFILE,
} from "../config/protocol-profile.js";
import { readCliPackageInfo } from "../package-info.js";
import type {
  CapabilitiesPayload,
  CapabilityEnvVarDescriptor,
  CapabilityExitCodeDescriptor,
  CommandExecutionDescriptor,
  CommandSideEffectClass,
  DetailedCommandDescriptor,
  PreferredSafeVariant,
} from "../types.js";
import { EXIT_CODES, defaultErrorCode } from "./errors.js";
import { jsonContractDocRelativePath } from "./json.js";
import { ROOT_GLOBAL_FLAG_METADATA } from "./root-global-flags.js";
import {
  COMMAND_CATALOG,
  COMMAND_PATHS,
  type CommandMetadata,
  type CommandPath,
} from "./command-catalog.js";
import { DEPOSIT_APPROVAL_TIMELINE_COPY } from "./approval-timing.js";

export type { CommandCapabilityMetadata, CommandMetadata, CommandPath } from "./command-catalog.js";
export { COMMAND_PATHS } from "./command-catalog.js";

const CLI_PACKAGE_INFO = readCliPackageInfo(import.meta.url);

export interface GlobalFlagMetadata {
  flag: string;
  description: string;
}

function defaultExecutionMetadata(path: CommandPath): CommandExecutionDescriptor {
  if (
    path === "guide"
    || path === "capabilities"
    || path === "describe"
    || path === "completion"
  ) {
    return {
      owner: "native-shell",
      nativeModes: ["default", "help"],
    };
  }

  if (path === "stats") {
    return {
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured-default", "structured-global", "help"],
    };
  }

  if (path === "stats global" || path === "stats pool" || path === "activity") {
    return {
      owner: "hybrid",
      nativeModes: ["default", "csv", "structured", "help"],
    };
  }

  if (path === "pools") {
    return {
      owner: "hybrid",
      nativeModes: ["default-list", "default-detail", "csv-list", "structured-list", "help"],
    };
  }

  return {
    owner: "js-runtime",
    nativeModes: ["help"],
  };
}

export function getCommandExecutionMetadata(
  path: CommandPath,
): CommandExecutionDescriptor {
  const explicit = COMMAND_CATALOG[path].execution;
  if (explicit) {
    return {
      owner: explicit.owner,
      nativeModes: [...explicit.nativeModes],
    };
  }

  return defaultExecutionMetadata(path);
}

export const CAPABILITIES_COMMAND_ORDER: CommandPath[] = [
  "init",
  "upgrade",
  "flow",
  "flow start",
  "flow watch",
  "flow status",
  "flow ragequit",
  "pools",
  "activity",
  "stats",
  "stats global",
  "stats pool",
  "describe",
  "deposit",
  "withdraw",
  "withdraw quote",
  "accounts",
  "migrate",
  "migrate status",
  "history",
  "sync",
  "status",
  "ragequit",
  "guide",
  "completion",
  "capabilities",
];

export const GLOBAL_FLAG_METADATA: GlobalFlagMetadata[] =
  ROOT_GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({
    flag,
    description,
  }));

export const CAPABILITY_EXIT_CODES: CapabilityExitCodeDescriptor[] = [
  {
    code: 0,
    category: "SUCCESS",
    errorCode: "SUCCESS",
    description: "Successful command completion.",
  },
  {
    code: EXIT_CODES.UNKNOWN,
    category: "UNKNOWN",
    errorCode: defaultErrorCode("UNKNOWN"),
    description: "Unknown or general runtime failure.",
  },
  {
    code: EXIT_CODES.INPUT,
    category: "INPUT",
    errorCode: defaultErrorCode("INPUT"),
    description: "Invalid input, prompt cancellation in machine mode, or validation failure.",
  },
  {
    code: EXIT_CODES.RPC,
    category: "RPC",
    errorCode: defaultErrorCode("RPC"),
    description: "RPC, transport, or network connectivity failure.",
  },
  {
    code: EXIT_CODES.ASP,
    category: "ASP",
    errorCode: defaultErrorCode("ASP"),
    description: "ASP service failure or approval-state fetch issue.",
  },
  {
    code: EXIT_CODES.RELAYER,
    category: "RELAYER",
    errorCode: defaultErrorCode("RELAYER"),
    description: "Relayer quote or submission failure.",
  },
  {
    code: EXIT_CODES.PROOF,
    category: "PROOF",
    errorCode: defaultErrorCode("PROOF"),
    description: "ZK proof generation or proof-input failure.",
  },
  {
    code: EXIT_CODES.CONTRACT,
    category: "CONTRACT",
    errorCode: defaultErrorCode("CONTRACT"),
    description: "Onchain simulation or contract revert failure.",
  },
];

export const CAPABILITY_ENV_VARS: CapabilityEnvVarDescriptor[] = [
  {
    name: "PRIVACY_POOLS_HOME",
    aliases: ["PRIVACY_POOLS_CONFIG_DIR"],
    description: "Override the CLI config directory.",
  },
  {
    name: "PRIVACY_POOLS_PRIVATE_KEY",
    description: "Signer private key; takes precedence over the saved .signer file.",
  },
  {
    name: "PRIVACY_POOLS_RPC_URL",
    aliases: ["PP_RPC_URL"],
    description: "Override the RPC endpoint for all chains.",
  },
  {
    name: "PRIVACY_POOLS_ASP_HOST",
    aliases: ["PP_ASP_HOST"],
    description: "Override the ASP endpoint for all chains.",
  },
  {
    name: "PRIVACY_POOLS_RELAYER_HOST",
    aliases: ["PP_RELAYER_HOST"],
    description: "Override the relayer endpoint for all chains.",
  },
  {
    name: "PRIVACY_POOLS_CIRCUITS_DIR",
    description: "Override the circuit artifact directory with a trusted pre-provisioned path.",
  },
  {
    name: "PRIVACY_POOLS_RPC_URL_<CHAIN>",
    aliases: ["PP_RPC_URL_<CHAIN>"],
    description: "Override the RPC endpoint for one chain, for example ARBITRUM or SEPOLIA.",
  },
  {
    name: "PRIVACY_POOLS_ASP_HOST_<CHAIN>",
    aliases: ["PP_ASP_HOST_<CHAIN>"],
    description: "Override the ASP endpoint for one chain.",
  },
  {
    name: "PRIVACY_POOLS_RELAYER_HOST_<CHAIN>",
    aliases: ["PP_RELAYER_HOST_<CHAIN>"],
    description: "Override the relayer endpoint for one chain.",
  },
  {
    name: "PRIVACY_POOLS_CLI_DISABLE_NATIVE",
    description: "Set to 1 to force the pure JS runtime path.",
  },
  {
    name: "PRIVACY_POOLS_CLI_BINARY",
    description: "Advanced maintainer override for the launcher target native-shell binary path.",
  },
  {
    name: "PRIVACY_POOLS_CLI_JS_WORKER",
    description: "Advanced maintainer override for the packaged JS worker entrypoint.",
  },
  {
    name: "NO_COLOR",
    description: "Disable colored output, matching --no-color.",
  },
  {
    name: "PP_NO_UPDATE_CHECK",
    description: "Set to 1 to disable the update-available notification.",
  },
];

const CHAIN_GLOBAL_FLAG = "-c, --chain <name>";

const CHAIN_UNSUPPORTED_DESCRIPTOR_COMMANDS = new Set<CommandPath>([
  "stats",
  "stats global",
]);

function supportedGlobalFlagMetadata(path: CommandPath): GlobalFlagMetadata[] {
  return GLOBAL_FLAG_METADATA.filter((entry) => {
    if (
      entry.flag === CHAIN_GLOBAL_FLAG
      && CHAIN_UNSUPPORTED_DESCRIPTOR_COMMANDS.has(path)
    ) {
      return false;
    }
    return true;
  });
}

const AGENT_WORKFLOW = [
  "1. privacy-pools status --agent",
  "2. privacy-pools init --agent --default-chain <chain> --show-recovery-phrase",
  "3. privacy-pools pools --agent --chain <chain>",
  "4. privacy-pools flow start <amount> <asset> --to <address> --agent --chain <chain>",
  "5. privacy-pools flow watch [workflowId|latest] --agent",
  "6. privacy-pools flow ragequit [workflowId|latest] --agent  (optional public recovery after the deposit exists; canonical if the saved workflow is declined)",
  "7. privacy-pools deposit <amount> --asset <symbol> --agent --chain <chain>  (manual alternative)",
  "8. privacy-pools accounts --agent --chain <chain> --pending-only  (reviewed entries disappear; confirm approved vs declined vs poa_required with accounts --agent --chain <chain>)",
  "9. privacy-pools withdraw <amount> --asset <symbol> --to <address> --agent --chain <chain>",
];

const AGENT_NOTES: Record<string, string> = {
  polling:
    `After depositing, poll 'accounts --agent --chain <chain> --pending-only' while the Pool Account remains pending. Reviewed entries disappear from --pending-only results; once gone, re-run 'accounts --agent --chain <chain>' to confirm whether aspStatus is 'approved', 'declined', or 'poa_required'. Withdraw only after approval; ragequit if declined; complete Proof of Association at ${POA_PORTAL_URL} first if poa_required. Always preserve the same --chain scope for both polling and confirmation. ${DEPOSIT_APPROVAL_TIMELINE_COPY} Follow nextActions from the deposit response for the canonical polling command.`,
  withdrawQuote:
    "Use 'withdraw quote <amount> --asset <symbol> --agent' to check relayer fees before committing to a withdrawal.",
  firstRun:
    "Proof generation uses bundled checksum-verified circuit artifacts shipped with the CLI. The first proof may spend a moment verifying them; subsequent proofs are typically ~10-30s.",
  unsignedMode:
    "--unsigned builds transaction payloads without signing or submitting. Use --unsigned tx for a raw transaction array (no envelope). Requires init (recovery phrase) for deposit secret generation, but does NOT require a signer key. The 'from' field is included for signer-aware workflows: it is null when the signer is unconstrained, and set to the required caller address when the protocol requires one.",
  metaFlag:
    "--agent is equivalent to --json --yes --quiet. Use it to suppress all stderr output and skip prompts.",
  statusCheck:
    "Run 'status --agent' before transacting. Use recommendedMode plus blockingIssues[]/warnings[] for machine gating, and keep readyForDeposit/readyForWithdraw/readyForUnsigned as configuration capability flags only. Those flags confirm the wallet is set up, NOT that withdrawable funds exist. Check 'accounts --agent --chain <chain>' to verify fund availability before withdrawing on a specific chain. Use bare 'accounts --agent' only for the default multi-chain mainnet dashboard. When recommendedMode is read-only because RPC or ASP health is degraded, follow status nextActions back to public discovery and avoid account-state guidance until connectivity is restored. If only the ASP is down while RPC stays healthy, public recovery still remains available through ragequit, flow ragequit, or unsigned ragequit payloads when the affected account or workflow is already known.",
};

export const CAPABILITIES_SCHEMAS: Record<string, Record<string, unknown>> = {
  aspApprovalStatus: {
    values: ["approved", "pending", "poa_required", "declined", "unknown"],
    description:
      `ASP approval status for a Pool Account. 'approved' means the deposit has been vetted and is eligible for private withdrawal. 'pending' means the ASP has not yet approved the deposit. 'poa_required' means Proof of Association (${POA_PORTAL_URL}) is required before private withdrawal. 'declined' means the ASP rejected the deposit for private withdrawal. 'unknown' applies to exited or spent accounts, or when ASP status could not be determined.`,
  },
  poolAccountStatus: {
    values: ["approved", "pending", "poa_required", "declined", "unknown", "spent", "exited"],
    description:
      "User-facing status of a Pool Account. Active accounts surface their effective review state ('approved', 'pending', 'poa_required', 'declined', or 'unknown'). 'spent' means an approved account was withdrawn. 'exited' means ragequit/exit was used.",
  },
  errorCategories: {
    values: ["INPUT", "RPC", "ASP", "RELAYER", "PROOF", "CONTRACT", "UNKNOWN"],
    exitCodes: { INPUT: 2, RPC: 3, ASP: 4, RELAYER: 5, PROOF: 6, CONTRACT: 7, UNKNOWN: 1 },
    description:
      "Error responses include top-level errorCode/errorMessage plus error.{ code, category, message, hint?, retryable? }.",
  },
  unsignedOutput: {
    envelopeFormat:
      "{ schemaVersion, success, mode, operation, chain, transactions: [{ from, to, data, value, ... }], ... }",
    txFormat:
      "[{ from, to, data, value, valueHex, chainId, description }]: raw array, no envelope wrapper. Intended for direct piping to signing tools.",
    note:
      "Default --unsigned emits the envelope format. Use --unsigned tx for raw transaction array only.",
  },
  nextActions: {
    shape:
      "{ command, reason, when, args?: string[], options?: Record<string, string|number|boolean|null>, runnable?: boolean }",
    description:
      "Canonical workflow guidance for agents. Follow these command suggestions instead of parsing natural-language output. "
      + "Current nextActions are emitted only when the CLI has a low-ambiguity follow-up to recommend. "
      + "When runnable is omitted or true, the command is fully specified and can be executed as shown. "
      + "When runnable is false, the action is a template and requires additional user input before execution.",
  },
  sideEffectClass: {
    values: ["read_only", "local_state_write", "network_write", "fund_movement"],
    description:
      "Machine-readable risk classification for a command path. read_only never mutates local or remote protocol state. local_state_write may mutate local CLI state or secrets. network_write is reserved for remote mutations that do not directly move user funds. fund_movement may submit deposits, withdrawals, or public recoveries.",
  },
  statusRecommendedMode: {
    values: ["setup-required", "read-only", "unsigned-only", "ready"],
    description:
      "High-level preflight recommendation derived from the current wallet/configuration state. setup-required means init or recovery setup is incomplete. unsigned-only means read-only and unsigned transaction building are safe but a valid signer is unavailable. ready means the wallet is configured for deposits and withdrawals. read-only means status detected degraded RPC or ASP health, so public discovery is the default safe path until connectivity is restored. When only the ASP is degraded but RPC remains healthy, public recovery may still be available if the affected account or workflow is already known.",
  },
  statusIssues: {
    blockingIssueShape:
      "{ code, message, affects: (\"deposit\"|\"withdraw\"|\"unsigned\"|\"discovery\")[] }",
    warningShape:
      "{ code, message, affects: (\"deposit\"|\"withdraw\"|\"unsigned\"|\"discovery\")[] }",
    description:
      "Structured preflight issues returned by status --agent. blockingIssues describe setup blockers that should stop execution. warnings describe degraded or follow-up-worthy states that may still allow safe read-only usage.",
  },
};

const READ_ONLY_COMMANDS = new Set<CommandPath>([
  "guide",
  "capabilities",
  "describe",
  "completion",
  "pools",
  "activity",
  "stats",
  "stats global",
  "stats pool",
  "status",
  "flow status",
  "migrate",
  "migrate status",
  "withdraw quote",
]);

const LOCAL_STATE_WRITE_COMMANDS = new Set<CommandPath>([
  "upgrade",
  "init",
  "accounts",
  "history",
  "sync",
]);

const FUND_MOVEMENT_COMMANDS = new Set<CommandPath>([
  "flow start",
  "flow watch",
  "flow ragequit",
  "deposit",
  "withdraw",
  "ragequit",
]);

const PREFERRED_SAFE_VARIANTS: Partial<Record<CommandPath, PreferredSafeVariant>> = {
  upgrade: {
    command: "upgrade --check",
    reason: "Check for a newer npm release without mutating the installed CLI.",
  },
  "flow watch": {
    command: "flow status",
    reason: "Inspect the saved workflow state before re-attaching a long-running flow.",
  },
  "flow ragequit": {
    command: "flow status",
    reason: "Inspect the saved workflow state before triggering the public recovery path.",
  },
  deposit: {
    command: "pools",
    reason: "Browse pools and balances before submitting a new deposit.",
  },
  withdraw: {
    command: "withdraw quote",
    reason: "Check relayer fees and confirm the withdrawal inputs before submitting.",
  },
};

function sideEffectClassFor(path: CommandPath): CommandSideEffectClass {
  if (FUND_MOVEMENT_COMMANDS.has(path)) {
    return "fund_movement";
  }
  if (LOCAL_STATE_WRITE_COMMANDS.has(path)) {
    return "local_state_write";
  }
  if (READ_ONLY_COMMANDS.has(path)) {
    return "read_only";
  }
  return "read_only";
}

function preferredSafeVariantFor(path: CommandPath): PreferredSafeVariant | undefined {
  return PREFERRED_SAFE_VARIANTS[path];
}

function descriptorSeed(path: CommandPath) {
  const metadata = getCommandMetadata(path);
  const capabilities = metadata.capabilities;
  if (!capabilities) {
    throw new Error(`Missing capabilities metadata for command path '${path}'.`);
  }

  const sideEffectClass = sideEffectClassFor(path);
  const touchesFunds = sideEffectClass === "fund_movement";

  return {
    description: metadata.description,
    aliases: metadata.aliases ?? [],
    usage: capabilities.usage ?? path,
    flags: capabilities.flags ?? [],
    globalFlags: supportedGlobalFlagMetadata(path).map(({ flag }) => flag),
    requiresInit: capabilities.requiresInit,
    expectedLatencyClass: capabilities.expectedLatencyClass ?? "fast",
    safeReadOnly: metadata.safeReadOnly ?? false,
    sideEffectClass,
    touchesFunds,
    requiresHumanReview: touchesFunds || path === "init" || path === "upgrade",
    preferredSafeVariant: preferredSafeVariantFor(path),
    prerequisites: metadata.help?.prerequisites ? [metadata.help.prerequisites] : [],
    examples: metadata.help?.examples ?? [],
    jsonFields: metadata.help?.jsonFields ?? null,
    jsonVariants: metadata.help?.jsonVariants ?? [],
    safetyNotes: metadata.help?.safetyNotes ?? [],
    supportsUnsigned: metadata.help?.supportsUnsigned ?? false,
    supportsDryRun: metadata.help?.supportsDryRun ?? false,
    agentWorkflowNotes: metadata.help?.agentWorkflowNotes ?? [],
  };
}

export function buildCommandDescriptor(path: CommandPath): DetailedCommandDescriptor {
  const seed = descriptorSeed(path);
  return {
    command: path,
    description: seed.description,
    aliases: seed.aliases,
    execution: getCommandExecutionMetadata(path),
    usage: seed.usage,
    flags: seed.flags,
    globalFlags: seed.globalFlags,
    requiresInit: seed.requiresInit,
    expectedLatencyClass: seed.expectedLatencyClass,
    safeReadOnly: seed.safeReadOnly,
    sideEffectClass: seed.sideEffectClass,
    touchesFunds: seed.touchesFunds,
    requiresHumanReview: seed.requiresHumanReview,
    preferredSafeVariant: seed.preferredSafeVariant,
    prerequisites: seed.prerequisites,
    examples: seed.examples,
    jsonFields: seed.jsonFields,
    jsonVariants: seed.jsonVariants,
    safetyNotes: seed.safetyNotes,
    supportsUnsigned: seed.supportsUnsigned,
    supportsDryRun: seed.supportsDryRun,
    agentWorkflowNotes: seed.agentWorkflowNotes,
  };
}

export function resolveCommandPath(query: string | string[]): CommandPath | null {
  const normalized = Array.isArray(query)
    ? query.join(" ").trim().replace(/\s+/g, " ")
    : query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if ((COMMAND_PATHS as string[]).includes(normalized)) {
    return normalized as CommandPath;
  }

  const aliasMatch = COMMAND_PATHS.find((path) =>
    (COMMAND_CATALOG[path].aliases ?? []).includes(normalized)
  );
  return aliasMatch ?? null;
}

export function listCommandPaths(): CommandPath[] {
  return [...COMMAND_PATHS];
}

export function getCommandMetadata(path: CommandPath): CommandMetadata {
  return COMMAND_CATALOG[path];
}

export function getDocumentedAgentMarkers(): string[] {
  return COMMAND_PATHS
    .map((path) => COMMAND_CATALOG[path].agentsDocMarker)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function buildCapabilitiesPayload(): CapabilitiesPayload {
  return {
    commands: CAPABILITIES_COMMAND_ORDER.map((path) => {
      const metadata = getCommandMetadata(path);
      const seed = descriptorSeed(path);
      return {
        name: metadata.capabilities?.name ?? path,
        description: metadata.description,
        aliases: metadata.aliases,
        usage: seed.usage,
        flags: seed.flags,
        agentFlags: metadata.capabilities?.agentFlags,
        requiresInit: seed.requiresInit,
        expectedLatencyClass: seed.expectedLatencyClass,
      };
    }),
    commandDetails: Object.fromEntries(
      COMMAND_PATHS.map((path) => [path, buildCommandDescriptor(path)]),
    ),
    executionRoutes: Object.fromEntries(
      COMMAND_PATHS.map((path) => [path, getCommandExecutionMetadata(path)]),
    ),
    globalFlags: GLOBAL_FLAG_METADATA.map(({ flag, description }) => ({ flag, description })),
    exitCodes: CAPABILITY_EXIT_CODES,
    envVars: CAPABILITY_ENV_VARS,
    agentWorkflow: AGENT_WORKFLOW,
    agentNotes: AGENT_NOTES,
    schemas: CAPABILITIES_SCHEMAS,
    supportedChains: CHAIN_NAMES.map((name) => ({
      name,
      chainId: CHAINS[name].id,
      testnet: CHAINS[name].isTestnet,
    })),
    protocol: CLI_PROTOCOL_PROFILE,
    runtime: buildRuntimeCompatibilityDescriptor(CLI_PACKAGE_INFO.version),
    safeReadOnlyCommands: COMMAND_PATHS
      .filter((path) => COMMAND_CATALOG[path].safeReadOnly)
      .map((path) => path),
    jsonOutputContract:
      "All commands emit { schemaVersion, success, ...payload } on stdout when --json or --agent is set. Errors emit { schemaVersion, success: false, errorCode, errorMessage, error: { code, category, message, hint?, retryable? } }. Exception: --unsigned tx emits a raw transaction array without the envelope.",
    documentation: {
      reference: "docs/reference.md",
      agentGuide: "AGENTS.md",
      changelog: "CHANGELOG.md",
      runtimeUpgrades: "docs/runtime-upgrades.md",
      jsonContract: jsonContractDocRelativePath(),
    },
  };
}
