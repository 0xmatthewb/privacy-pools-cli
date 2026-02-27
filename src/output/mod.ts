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
  printJsonSuccess,
  info,
  success,
  warn,
  printTable,
} from "./common.js";

// Command renderers
export { renderGuide } from "./guide.js";
export {
  renderCapabilities,
  type CapabilitiesPayload,
} from "./capabilities.js";
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
  renderStatus,
  type StatusCheckResult,
} from "./status.js";
export {
  renderPoolsEmpty,
  renderPools,
  poolToJson,
  type PoolWithChain,
  type ChainSummary,
  type PoolWarning,
  type PoolsRenderData,
} from "./pools.js";
export {
  renderBalanceNoPools,
  renderBalanceEmpty,
  renderBalance,
  type BalanceRow,
  type BalanceJsonEntry,
  type BalanceRenderData,
} from "./balance.js";
export {
  renderAccountsNoPools,
  renderAccounts,
  type AccountPoolGroup,
  type AccountsRenderData,
} from "./accounts.js";
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
