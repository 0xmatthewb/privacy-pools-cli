import type { Address, Hex } from "viem";
import type { Chain } from "viem/chains";

export interface ChainConfig {
  id: number;
  name: string;
  chain: Chain;
  entrypoint: Address;
  multicall3Address?: Address;
  /** Internal-only dedicated RPC for event-scan/DataService reads when available. */
  eventScanRpcUrl?: string;
  startBlock: bigint;
  aspHost: string;
  relayerHost: string;
  relayerHosts?: string[];
  isTestnet: boolean;
  /** Average seconds per block for approximate time-ago display. */
  avgBlockTimeSec: number;
}

export interface CLIConfig {
  defaultChain: string;
  rpcOverrides: Record<number, string>;
}

export interface GlobalOptions {
  chain?: string;
  rpcUrl?: string;
  json?: boolean;
  jsonFields?: string;
  template?: string;
  output?: string;
  web?: boolean;
  agent?: boolean;
  quiet?: boolean;
  yes?: boolean;
  verbose?: boolean;
  noProgress?: boolean;
  noHeader?: boolean;
  timeout?: string;
  format?: string;
  jq?: string;
  jmes?: string;
  profile?: string;
}

export type NextActionOptionValue = string | number | boolean | null;

export interface NextActionParameter {
  name: string;
  type: string;
  required: boolean;
}

/**
 * Discriminator for _when_ a next-action applies.
 *
 * Each value names a specific CLI state transition.  Agents can use this to
 * decide programmatically whether a suggested action is relevant.
 */
export const NEXT_ACTION_WHEN_VALUES = [
  "after_init",
  "after_restore",
  "after_deposit",
  "after_dry_run",
  "after_quote",
  "after_withdraw",
  "after_ragequit",
  "has_pending",
  "status_not_ready",
  "status_unsigned_no_accounts",
  "status_unsigned_has_accounts",
  "status_ready_no_accounts",
  "status_ready_has_accounts",
  "status_degraded_health",
  "status_restore_discovery",
  "after_sync",
  "after_pools",
  "after_pool_detail",
  "after_upgrade",
  "after_activity",
  "after_stats",
  "after_pool_stats",
  "after_history",
  "after_config_list",
  "after_config_set",
  "no_pools_found",
  "accounts_pending_empty",
  "accounts_summary_empty",
  "accounts_empty",
  "accounts_other_chain_activity",
  "accounts_restore_check",
  "flow_manual_followup",
  "flow_public_recovery_pending",
  "flow_public_recovery_required",
  "flow_resume",
  "flow_public_recovery_optional",
  "flow_declined",
] as const;

export type NextActionWhen = (typeof NEXT_ACTION_WHEN_VALUES)[number];

export interface NextAction {
  command: string;
  /**
   * Fully rendered CLI invocation using kebab-case flags.
   * Includes `--agent` when the structured options request agent mode.
  */
  cliCommand?: string;
  reason: string;
  when: NextActionWhen;
  args?: string[];
  options?: Record<string, NextActionOptionValue>;
  parameters?: NextActionParameter[];
  /**
   * Whether the command is fully specified and can be executed as-is.
   * `false` means the command is a template that requires additional
   * user-supplied arguments (e.g. amount, recipient) before it can run.
   * Defaults to `true` when omitted for backward compatibility.
   */
  runnable?: boolean;
}

export type InitSetupMode =
  | "create"
  | "restore"
  | "signer_only"
  | "replace";

export type InitReadiness =
  | "ready"
  | "read_only"
  | "discovery_required";

export type RestoreDiscoveryStatus =
  | "deposits_found"
  | "no_deposits"
  | "legacy_website_action_required"
  | "degraded";

export interface RestoreDiscoverySummary {
  status: RestoreDiscoveryStatus;
  chainsChecked: string[];
  foundAccountChains?: string[];
}

export type CommandLatencyClass = "fast" | "medium" | "slow";
export type CommandExecutionOwner = "js-runtime" | "native-shell" | "hybrid";
export type CommandGroup =
  | "getting-started"
  | "transaction"
  | "monitoring"
  | "advanced";
export type CommandSideEffectClass =
  | "read_only"
  | "local_state_write"
  | "network_write"
  | "fund_movement";

export interface CommandExecutionDescriptor {
  owner: CommandExecutionOwner;
  nativeModes: string[];
}

export interface PreferredSafeVariant {
  command: string;
  reason: string;
}

export interface StructuredExample {
  name: string;
  value: string | string[];
}

export interface CapabilityCommandSummary {
  name: string;
  description: string;
  group: CommandGroup;
  aliases?: string[];
  flags?: string[];
  usage?: string;
  agentFlags?: string;
  requiresInit: boolean;
  expectedLatencyClass?: CommandLatencyClass;
}

export interface DetailedCommandDescriptor {
  command: string;
  description: string;
  group: CommandGroup;
  aliases: string[];
  execution: CommandExecutionDescriptor;
  usage: string;
  flags: string[];
  globalFlags: string[];
  requiresInit: boolean;
  expectedLatencyClass: CommandLatencyClass;
  safeReadOnly: boolean;
  sideEffectClass: CommandSideEffectClass;
  touchesFunds: boolean;
  requiresHumanReview: boolean;
  preferredSafeVariant?: PreferredSafeVariant;
  prerequisites: string[];
  examples: Array<string | { category: string; commands: string[] }>;
  structuredExamples?: StructuredExample[];
  jsonFields: string | null;
  jsonVariants: string[];
  safetyNotes: string[];
  supportsUnsigned: boolean;
  supportsDryRun: boolean;
  agentWorkflowNotes: string[];
  expectedNextActionWhen?: NextActionWhen[];
  /** Flags that agents must supply for unattended execution (no interactive fallback). */
  agentRequiredFlags?: string[];
}

export interface ProtocolProfile {
  family: string;
  generation: string;
  profile: string;
  displayName: string;
  coreSdkPackage: string;
  coreSdkVersion: string;
  supportedChainPolicy: string;
  notes?: string[];
}

export interface RuntimeCompatibilityDescriptor {
  cliVersion: string;
  jsonSchemaVersion: string;
  accountFileVersion: number;
  workflowSnapshotVersion: string;
  workflowSecretVersion: string;
  runtimeVersion: string;
  workerProtocolVersion: string;
  manifestVersion: string;
  nativeBridgeVersion: string;
}

export type StatusRecommendedMode =
  | "setup-required"
  | "read-only"
  | "unsigned-only"
  | "ready";

export type StatusIssueAffect =
  | "deposit"
  | "withdraw"
  | "unsigned"
  | "discovery";

export interface StatusIssue {
  code: string;
  message: string;
  affects: StatusIssueAffect[];
}

export interface CapabilityExitCodeDescriptor {
  code: number;
  category: "SUCCESS" | "INPUT" | "RPC" | "ASP" | "RELAYER" | "PROOF" | "CONTRACT" | "UNKNOWN";
  errorCode: string;
  description: string;
}

export interface CapabilityEnvVarDescriptor {
  name: string;
  description: string;
  aliases?: string[];
}

export interface CapabilitiesPayload {
  commands: CapabilityCommandSummary[];
  commandDetails: Record<string, DetailedCommandDescriptor>;
  executionRoutes: Record<string, CommandExecutionDescriptor>;
  globalFlags: Array<{ flag: string; description: string }>;
  exitCodes: CapabilityExitCodeDescriptor[];
  envVars: CapabilityEnvVarDescriptor[];
  agentWorkflow: string[];
  agentNotes?: Record<string, string>;
  schemas?: Record<string, Record<string, unknown>>;
  supportedChains?: Array<{ name: string; chainId: number; testnet: boolean }>;
  protocol: ProtocolProfile;
  runtime: RuntimeCompatibilityDescriptor;
  jsonOutputContract: string;
  safeReadOnlyCommands?: string[];
  documentation?: {
    reference: string;
    agentGuide: string;
    changelog: string;
    runtimeUpgrades?: string;
    jsonContract?: string;
  };
}

export interface PoolStats {
  asset: Address;
  pool: Address;
  deploymentBlock?: bigint;
  scope: bigint;
  symbol: string;
  decimals: number;
  minimumDepositAmount: bigint;
  vettingFeeBPS: bigint;
  maxRelayFeeBPS: bigint;
  totalInPoolValue?: bigint;
  totalInPoolValueUsd?: string;
  totalDepositsValue?: bigint;
  totalDepositsValueUsd?: string;
  acceptedDepositsValue?: bigint;
  acceptedDepositsValueUsd?: string;
  pendingDepositsValue?: bigint;
  pendingDepositsValueUsd?: string;
  totalDepositsCount?: number;
  acceptedDepositsCount?: number;
  pendingDepositsCount?: number;
  growth24h?: number | null;
  pendingGrowth24h?: number | null;
}

export interface AspEventPoolRef {
  chainId?: number;
  poolAddress?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  denomination?: string;
}

export interface AspReviewStatusObject {
  decisionStatus?: string;
  reviewStatus?: string;
  status?: string;
  [key: string]: unknown;
}

export interface AspPublicEvent {
  type?: string;
  txHash?: string;
  timestamp?: number | string;
  amount?: string;
  publicAmount?: string;
  reviewStatus?: string | AspReviewStatusObject;
  pool?: AspEventPoolRef;
  [key: string]: unknown;
}

export interface AspEventsPageResponse {
  events?: AspPublicEvent[];
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
}

export interface TimeBasedStatistics {
  tvl?: string;
  tvlUsd?: string;
  avgDepositSize?: string;
  avgDepositSizeUsd?: string;
  totalDepositsCount?: number;
  totalDepositsValue?: string;
  totalDepositsValueUsd?: string;
  totalWithdrawalsCount?: number;
  totalWithdrawalsValue?: string;
  totalWithdrawalsValueUsd?: string;
}

export interface PoolStatisticsResponse {
  pool?: {
    scope?: string;
    chainId?: string;
    tokenSymbol?: string;
    tokenAddress?: string;
    tokenDecimals?: number;
    allTime?: TimeBasedStatistics;
    last24h?: TimeBasedStatistics;
  };
  cacheTimestamp?: string;
}

export interface GlobalStatisticsResponse {
  allTime?: TimeBasedStatistics;
  last24h?: TimeBasedStatistics;
  cacheTimestamp?: string;
}

export interface MtRootsResponse {
  mtRoot: string;
  createdAt: string;
  onchainMtRoot: string;
}

export interface MtLeavesResponse {
  aspLeaves: string[];
  stateTreeLeaves: string[];
}

export interface RelayerDetailsResponse {
  chainId: number;
  feeBPS: string;
  minWithdrawAmount: string;
  feeReceiverAddress: Address;
  assetAddress: Address;
  maxGasPrice: string;
  relayerUrl?: string;
}

export interface RelayerQuoteResponse {
  baseFeeBPS: string;
  feeBPS: string;
  gasPrice: string;
  relayerUrl?: string;
  detail: {
    relayTxCost: { gas: string; eth: string };
    extraGasFundAmount?: { gas: string; eth: string };
    extraGasTxCost?: { gas: string; eth: string };
  };
  feeCommitment?: {
    expiration: number;
    withdrawalData: Hex;
    asset: Address;
    amount: string;
    extraGas: boolean;
    signedRelayerCommitment: Hex;
  };
}

export interface RelayerRequestResponse {
  success: boolean;
  txHash: Hex;
  timestamp: number;
  requestId: string;
}
