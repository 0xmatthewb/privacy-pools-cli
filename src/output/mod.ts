/**
 * Output module barrel.
 *
 * Re-exports shared primitives and command-specific renderers.
 * Command handlers import from here or from individual renderer files.
 */

// Shared primitives
export {
  type OutputContext,
  type ResolvedGlobalMode,
  createOutputContext,
  isSilent,
  isCsv,
  printJsonSuccess,
  printCsv,
  info,
  success,
  warn,
  printTable,
  renderNextSteps,
  formatNextActionCommand,
} from "./common.js";

// Command renderers
export { renderGuide } from "./guide.js";
export {
  renderCapabilities,
  type CapabilitiesPayload,
} from "./capabilities.js";
export {
  renderCommandDescription,
  type DetailedCommandDescriptor,
} from "./describe.js";
export {
  renderCompletionScript,
  renderCompletionQuery,
} from "./completion.js";
export {
  renderSyncEmpty,
  renderSyncComplete,
  type SyncResult,
} from "./sync.js";
export {
  deriveStatusPreflightGuidance,
  renderStatus,
  type StatusCheckResult,
} from "./status.js";
export {
  renderPoolsEmpty,
  renderPools,
  renderPoolDetail,
  poolToJson,
  type PoolWithChain,
  type ChainSummary,
  type PoolWarning,
  type PoolsRenderData,
  type PoolDetailRenderData,
  type PoolDetailActivityEvent,
} from "./pools.js";
export {
  renderAccountsNoPools,
  renderAccounts,
  type AccountPoolGroup,
  type AccountWarning,
  type AccountsEmptyRenderData,
  type AccountsRenderData,
} from "./accounts.js";
export {
  renderMigrationStatus,
  type MigrationWarning,
  type MigrationChainRenderData,
  type MigrationRenderData,
  type MigrationStatusSummary,
} from "./migrate.js";
export {
  renderHistoryNoPools,
  renderHistory,
  type HistoryPoolInfo,
  type HistoryRenderData,
} from "./history.js";
export {
  renderInitResult,
  type InitRenderResult,
} from "./init.js";
export {
  renderDepositDryRun,
  renderDepositSuccess,
  type DepositDryRunData,
  type DepositSuccessData,
} from "./deposit.js";
export {
  renderFlowResult,
  type FlowRenderData,
} from "./flow.js";
export {
  renderRagequitDryRun,
  renderRagequitSuccess,
  type RagequitDryRunData,
  type RagequitSuccessData,
} from "./ragequit.js";
export {
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  renderWithdrawQuote,
  type WithdrawDryRunData,
  type WithdrawSuccessData,
  type WithdrawQuoteData,
} from "./withdraw.js";
export {
  renderActivity,
  type NormalizedActivityEvent,
  type ActivityRenderData,
} from "./activity.js";
export {
  renderGlobalStats,
  renderPoolStats,
  parseUsd,
  parseCount,
  type ChainStatsEntry,
  type GlobalStatsRenderData,
  type PoolStatsRenderData,
} from "./stats.js";
