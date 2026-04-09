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
export {
  type CalloutKind,
  type KeyValueRow,
  type SectionListOptions,
  type SectionHeadingOptions,
  type SectionTone,
  formatCallout,
  formatKeyValueRows,
  formatStackedKeyValueRows,
  formatBox,
  type BoxOptions,
  formatSectionList,
  formatSectionHeading,
  getOutputWidthClass,
} from "./layout.js";
export {
  formatPromptLine,
  formatReviewSurface,
  type ReviewCallout,
  type ReviewSection,
  type ReviewSurfaceData,
} from "./review.js";
export {
  createNarrativeSteps,
  renderNarrativeSteps,
  renderFlowRail,
  renderOutcomeDirection,
  type NarrativeStepState,
  type FlowRailStepState,
  type NarrativeStep,
  type FlowRailStep,
} from "./progress.js";
export {
  renderHumanCapabilities,
  renderHumanCommandDescription,
  renderHumanGuideText,
} from "./discovery.js";

// Command renderers
export { renderGuide } from "./guide.js";
export {
  formatUpgradeInstallReview,
  renderUpgradeResult,
  type UpgradeResult,
} from "./upgrade.js";
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
  renderInitOverwriteReview,
  renderGeneratedRecoveryPhraseReview,
  renderInitBackupMethodReview,
  renderInitBackupPathReview,
  renderInitBackupSaved,
  renderInitBackupConfirmationReview,
  renderInitResult,
  type InitRenderResult,
} from "./init.js";
export {
  formatDepositReview,
  formatUniqueAmountReview,
  renderDepositDryRun,
  renderDepositSuccess,
  type DepositDryRunData,
  type DepositReviewData,
  type DepositSuccessData,
} from "./deposit.js";
export {
  formatFlowStartReview,
  formatFlowRagequitReview,
  renderFlowResult,
  type FlowRenderData,
  type FlowStartReviewData,
} from "./flow.js";
export {
  renderWorkflowWalletBackupChoiceReview,
  renderWorkflowWalletBackupPathReview,
  renderWorkflowWalletBackupChoicePreview,
  renderWorkflowWalletBackupConfirmation,
  renderWorkflowWalletBackupManual,
  renderWorkflowWalletBackupSaved,
} from "./workflow-wallet.js";
export {
  formatRagequitReview,
  renderRagequitDryRun,
  renderRagequitSuccess,
  type RagequitDryRunData,
  type RagequitReviewData,
  type RagequitSuccessData,
} from "./ragequit.js";
export {
  formatDirectWithdrawalReview,
  formatRelayedWithdrawalReview,
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  renderWithdrawQuote,
  type DirectWithdrawalReviewData,
  type RelayedWithdrawalReviewData,
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
