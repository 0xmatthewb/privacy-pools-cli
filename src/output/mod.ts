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
  FIRST_DEPOSIT_WELCOME,
  RAGEQUIT_PRIMARY_CALLOUT,
  RECOVERY_PHRASE_NEVER_SHARE,
  RECOVERY_PHRASE_OFFLINE_BACKUP,
  RECOVERY_PHRASE_ONLY_RESTORE_PATH,
} from "./copy.js";
export {
  formatDeprecationWarningCallout,
  type DeprecationWarningPayload,
} from "./deprecation.js";
export {
  createNarrativeSteps,
  createNarrativeProgressWriter,
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
  renderChangelog,
  renderUpgradeResult,
  type UpgradeResult,
} from "./upgrade.js";
export {
  renderCapabilities,
  type CapabilitiesPayload,
} from "./capabilities.js";
export {
  renderCommandDescription,
  renderCommandDescriptionIndex,
  renderSchemaDescription,
  type DescribeIndexEntry,
  type DetailedCommandDescriptor,
} from "./describe.js";
export {
  renderCompletionScript,
  renderCompletionQuery,
  renderCompletionInstallReview,
  renderCompletionInstallResult,
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
  type PoolBaseFields,
  type PoolListItem,
  type PoolDetail,
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
  renderInitConfiguredReview,
  renderInitGoalReview,
  renderInitOverwriteReview,
  renderInitLoadRecoveryReview,
  renderGeneratedRecoveryPhraseReview,
  renderInitDryRun,
  renderInitStage,
  renderInitBackupMethodReview,
  renderInitBackupPathReview,
  renderInitBackupSaved,
  renderInitBackupConfirmationReview,
  renderInitRecoveryVerificationReview,
  renderInitSignerKeyReview,
  renderInitPending,
  renderInitResult,
  type InitDryRunResult,
  type InitPendingResult,
  type InitRenderResult,
} from "./init.js";
export {
  renderConfigList,
  renderConfigGet,
  renderConfigSet,
  renderConfigPath,
  renderConfigProfileList,
  renderConfigProfileCreate,
  renderConfigProfileActive,
  renderConfigProfileUse,
  type ConfigListResult,
  type ConfigGetResult,
  type ConfigSetResult,
} from "./config.js";
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
  renderFlowPhaseChangeEvent,
  renderFlowStartDryRun,
  renderFlowResult,
  type FlowJsonWarning,
  type FlowRenderData,
  type FlowStartDryRunData,
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
  buildRagequitPrivacyCostManifest,
  formatRagequitReview,
  renderRagequitDryRun,
  renderRagequitSuccess,
  type RagequitDryRunData,
  type RagequitReviewData,
  type RagequitSuccessData,
} from "./ragequit.js";
export {
  buildDirectWithdrawalPrivacyCostManifest,
  formatAnonymitySetCallout,
  formatAnonymitySetValue,
  formatDirectWithdrawalReview,
  formatRelayedWithdrawalReview,
  renderWithdrawDryRun,
  renderWithdrawSuccess,
  renderWithdrawQuote,
  type WithdrawAnonymitySet,
  type DirectWithdrawalReviewData,
  type WithdrawUiWarning,
  type RelayedWithdrawalRemainderGuidance,
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
  renderBroadcast,
  type BroadcastRenderData,
} from "./broadcast.js";
export {
  renderTxStatus,
} from "./tx-status.js";
export {
  renderGlobalStats,
  renderPoolStats,
  parseUsd,
  parseCount,
  type ChainStatsEntry,
  type GlobalStatsRenderData,
  type PoolStatsRenderData,
} from "./stats.js";
export {
  type StructuredJsonWarning,
  warningFromCode,
  mergeStructuredWarnings,
} from "./warnings.js";
