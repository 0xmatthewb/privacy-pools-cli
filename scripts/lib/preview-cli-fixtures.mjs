import {
  createOutputContext,
  formatCallout,
  formatKeyValueRows,
  formatPromptLine,
  formatSectionHeading,
  printJsonSuccess,
  renderActivity,
  renderAccounts,
  renderAccountsNoPools,
  renderDepositDryRun,
  renderDepositSuccess,
  renderFlowResult,
  renderGlobalStats,
  renderHistory,
  renderHistoryNoPools,
  renderInitBackupConfirmationReview,
  renderInitBackupMethodReview,
  renderInitBackupPathReview,
  renderInitGoalReview,
  renderInitLoadRecoveryReview,
  renderInitOverwriteReview,
  renderInitRecoveryVerificationReview,
  renderInitResult,
  renderInitSignerKeyReview,
  renderMigrationStatus,
  renderPoolStats,
  renderPools,
  renderPoolsEmpty,
  renderRagequitDryRun,
  renderRagequitSuccess,
  renderStatus,
  renderSyncComplete,
  renderSyncEmpty,
  renderUpgradeResult,
  renderWithdrawDryRun,
  renderWithdrawQuote,
  renderWithdrawSuccess,
} from "../../src/output/mod.ts";
import { spinner } from "../../src/utils/format.ts";
import { CLIError } from "../../src/utils/errors.ts";

const HUMAN_MODE = {
  isAgent: false,
  isJson: false,
  isCsv: false,
  isQuiet: false,
  format: "table",
  skipPrompts: false,
};

const JSON_MODE = {
  isAgent: false,
  isJson: true,
  isCsv: false,
  isQuiet: true,
  format: "json",
  skipPrompts: true,
};

const CONTEXT = createOutputContext(HUMAN_MODE);
const VERBOSE_CONTEXT = createOutputContext(HUMAN_MODE, true);
const JSON_CONTEXT = createOutputContext(JSON_MODE);

const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const TEST_DEPOSIT_ADDRESS = "0x000000000000000000000000000000000000beef";
const SEPOLIA_CHAIN_ID = 11155111;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function showPreviewSpinner(text, doneText = null, delayMs = 450) {
  if (!process.stderr.isTTY) {
    return;
  }
  const spin = spinner(text, false);
  spin.start();
  await wait(delayMs);
  if (doneText) {
    spin.succeed(doneText);
  } else {
    spin.stop();
  }
}

function makePoolAccount({
  number,
  status,
  aspStatus = status,
  value,
  hash,
  label,
  txHash,
  blockNumber,
}) {
  return {
    paNumber: number,
    paId: `PA-${number}`,
    status,
    aspStatus,
    commitment: {
      hash,
      label,
    },
    label,
    value,
    blockNumber,
    txHash,
  };
}

const POPULATED_GROUPS = [
  {
    chain: "sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    symbol: "ETH",
    poolAddress: "0x1111111111111111111111111111111111111111",
    decimals: 18,
    scope: 1n,
    tokenPrice: 3200,
    poolAccounts: [
      makePoolAccount({
        number: 1,
        status: "approved",
        aspStatus: "approved",
        value: 800000000000000000n,
        hash: 101n,
        label: 9001n,
        txHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        blockNumber: 201n,
      }),
      makePoolAccount({
        number: 2,
        status: "pending",
        aspStatus: "pending",
        value: 400000000000000000n,
        hash: 102n,
        label: 9002n,
        txHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        blockNumber: 202n,
      }),
      makePoolAccount({
        number: 3,
        status: "poi_required",
        aspStatus: "poi_required",
        value: 200000000000000000n,
        hash: 103n,
        label: 9003n,
        txHash:
          "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        blockNumber: 203n,
      }),
    ],
  },
  {
    chain: "sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    symbol: "USDC",
    poolAddress: "0x2222222222222222222222222222222222222222",
    decimals: 6,
    scope: 2n,
    tokenPrice: 1,
    poolAccounts: [
      makePoolAccount({
        number: 4,
        status: "approved",
        aspStatus: "approved",
        value: 125000000n,
        hash: 201n,
        label: 9101n,
        txHash:
          "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        blockNumber: 204n,
      }),
      makePoolAccount({
        number: 5,
        status: "declined",
        aspStatus: "declined",
        value: 50000000n,
        hash: 202n,
        label: 9102n,
        txHash:
          "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        blockNumber: 205n,
      }),
    ],
  },
];

const HISTORY_EVENTS = [
  {
    type: "withdrawal",
    asset: "ETH",
    poolAddress: POPULATED_GROUPS[0].poolAddress,
    paNumber: 1,
    paId: "PA-1",
    value: 300000000000000000n,
    blockNumber: 222n,
    txHash:
      "0x1212121212121212121212121212121212121212121212121212121212121212",
  },
  {
    type: "deposit",
    asset: "USDC",
    poolAddress: POPULATED_GROUPS[1].poolAddress,
    paNumber: 4,
    paId: "PA-4",
    value: 125000000n,
    blockNumber: 204n,
    txHash:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  },
];

function historyPoolMap() {
  return new Map([
    [POPULATED_GROUPS[0].poolAddress, { pool: POPULATED_GROUPS[0].poolAddress, decimals: 18 }],
    [POPULATED_GROUPS[1].poolAddress, { pool: POPULATED_GROUPS[1].poolAddress, decimals: 6 }],
  ]);
}

function explorerUrl(_chainId, txHash) {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

function createStatusResult({
  configExists = true,
  defaultChain = "sepolia",
  selectedChain = "sepolia",
  recoveryPhraseSet = true,
  signerKeySet = true,
  signerKeyValid = true,
  signerAddress = "0x0000000000000000000000000000000000000abc",
  rpcLive = true,
  aspLive = true,
  accountFiles = [["sepolia", SEPOLIA_CHAIN_ID]],
} = {}) {
  return {
    configExists,
    configDir: configExists ? "/tmp/.privacy-pools" : null,
    defaultChain: configExists ? defaultChain : null,
    selectedChain: configExists ? selectedChain : null,
    rpcUrl: configExists ? "https://rpc.preview.test" : null,
    rpcIsCustom: false,
    recoveryPhraseSet,
    signerKeySet,
    signerKeyValid,
    signerAddress,
    entrypoint: configExists ? "0xentrypoint000000000000000000000000000000" : null,
    aspHost: configExists ? "https://asp.preview.test" : null,
    aspLive,
    rpcLive,
    rpcBlockNumber: rpcLive ? 12345678n : undefined,
    signerBalance: signerKeyValid ? 3400000000000000000n : undefined,
    signerBalanceDecimals: signerKeyValid ? 18 : undefined,
    signerBalanceSymbol: signerKeyValid ? "ETH" : undefined,
    healthChecksEnabled: { rpc: true, asp: true },
    accountFiles,
    nativeRuntimeAdvisory: null,
  };
}

function createMigrationChain({
  status,
  candidateLegacyCommitments,
  expectedLegacyCommitments,
  migratedCommitments,
  legacySpendableCommitments,
  declinedLegacyCommitments,
  reviewStatusComplete = true,
  requiresMigration = false,
  requiresWebsiteRecovery = false,
  scopes = ["1"],
}) {
  return {
    chain: "sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    status,
    candidateLegacyCommitments,
    expectedLegacyCommitments,
    migratedCommitments,
    legacyMasterSeedNullifiedCount: migratedCommitments,
    hasPostMigrationCommitments: migratedCommitments > 0,
    isMigrated: status === "fully_migrated",
    legacySpendableCommitments,
    upgradedSpendableCommitments: migratedCommitments,
    declinedLegacyCommitments,
    reviewStatusComplete,
    requiresMigration,
    requiresWebsiteRecovery,
    scopes,
  };
}

function createFlowSnapshot({
  workflowId = "wf-preview",
  phase,
  walletMode = "configured",
  walletAddress = null,
  privacyDelayProfile = "balanced",
  privacyDelayConfigured = true,
  privacyDelayUntil = null,
  poolAccountId = "PA-7",
  poolAccountNumber = 7,
  depositTxHash =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  depositBlockNumber = "12345",
  depositExplorerUrl = "https://example.test/tx/0xaaaaaaaa",
  committedValue = "99500000000000000",
  withdrawTxHash = null,
  withdrawBlockNumber = null,
  withdrawExplorerUrl = null,
  ragequitTxHash = null,
  ragequitBlockNumber = null,
  ragequitExplorerUrl = null,
  aspStatus = "pending",
  lastError = null,
}) {
  return {
    schemaVersion: "2",
    workflowId,
    createdAt: "2026-03-27T12:00:00.000Z",
    updatedAt: "2026-03-27T12:00:00.000Z",
    phase,
    walletMode,
    walletAddress,
    assetDecimals: 18,
    requiredNativeFunding: walletMode === "new_wallet" ? "3500000000000000" : null,
    requiredTokenFunding: walletMode === "new_wallet" ? "100000000000000000" : null,
    backupConfirmed: walletMode === "new_wallet",
    privacyDelayProfile,
    privacyDelayConfigured,
    privacyDelayUntil,
    chain: "sepolia",
    asset: "ETH",
    depositAmount: "100000000000000000",
    recipient: TEST_RECIPIENT,
    poolAccountId,
    poolAccountNumber,
    depositTxHash,
    depositBlockNumber,
    depositExplorerUrl,
    depositLabel: "12345",
    committedValue,
    aspStatus,
    withdrawTxHash,
    withdrawBlockNumber,
    withdrawExplorerUrl,
    ragequitTxHash,
    ragequitBlockNumber,
    ragequitExplorerUrl,
    pendingSubmission: null,
    lastError,
  };
}

function createUnsignedEnvelope(operation) {
  return {
    schemaVersion: "2.0.0",
    success: true,
    mode: "unsigned",
    operation,
    chain: "sepolia",
    asset: operation === "deposit" ? "ETH" : "USDC",
    amount: operation === "deposit" ? "100000000000000000" : "50000000",
    precommitment: "777",
    transactions: [
      {
        from: "0x0000000000000000000000000000000000000abc",
        to: "0x1111111111111111111111111111111111111111",
        data: "0xdeadbeef",
        value: operation === "deposit" ? "100000000000000000" : "0",
        valueHex: operation === "deposit" ? "0x16345785d8a0000" : "0x0",
        chainId: SEPOLIA_CHAIN_ID,
        description: `${operation} preview transaction`,
      },
    ],
  };
}

function createUnsignedTxList(operation) {
  return [
    {
      from: "0x0000000000000000000000000000000000000abc",
      to: "0x1111111111111111111111111111111111111111",
      data: "0xdeadbeef",
      value: operation === "deposit" ? "100000000000000000" : "0",
      valueHex: operation === "deposit" ? "0x16345785d8a0000" : "0x0",
      chainId: SEPOLIA_CHAIN_ID,
      description: `${operation} preview transaction`,
    },
  ];
}

function printJsonEnvelope(value) {
  printJsonSuccess(value, false);
}

function printRawTransactions(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const PREVIEW_SCENARIO_COMMANDS = {
  activity: new Set([
    "activity-empty",
  ]),
  status: new Set([
    "status-setup-required",
    "status-ready",
    "status-degraded",
  ]),
  pools: new Set([
    "pools-empty",
    "pools-no-match",
  ]),
  accounts: new Set([
    "accounts-empty",
    "accounts-pending-empty",
    "accounts-populated",
    "accounts-details",
    "accounts-summary",
    "accounts-verbose",
  ]),
  history: new Set([
    "history-empty",
    "history-populated",
  ]),
  sync: new Set([
    "sync-empty",
    "sync-success",
  ]),
  "migrate status": new Set([
    "migrate-status-no-legacy",
    "migrate-status-migration-required",
    "migrate-status-website-recovery",
    "migrate-status-review-incomplete",
    "migrate-status-fully-migrated",
  ]),
  init: new Set([
    "init-generated",
    "init-imported",
    "init-setup-mode-prompt",
    "init-overwrite-prompt",
    "init-import-recovery-prompt",
    "init-backup-method-prompt",
    "init-backup-path-prompt",
    "init-backup-confirm-prompt",
    "init-recovery-verification-prompt",
    "init-signer-key-prompt",
    "init-default-chain-prompt",
  ]),
  "init setup mode": new Set([
    "init-setup-mode-prompt",
  ]),
  "init overwrite prompt": new Set([
    "init-overwrite-prompt",
  ]),
  "init import recovery prompt": new Set([
    "init-import-recovery-prompt",
  ]),
  "init backup method": new Set([
    "init-backup-method-prompt",
  ]),
  "init backup path": new Set([
    "init-backup-path-prompt",
  ]),
  "init backup confirm": new Set([
    "init-backup-confirm-prompt",
  ]),
  "init recovery verification": new Set([
    "init-recovery-verification-prompt",
  ]),
  "init signer key": new Set([
    "init-signer-key-prompt",
  ]),
  "init default chain": new Set([
    "init-default-chain-prompt",
  ]),
  deposit: new Set([
    "deposit-dry-run",
    "deposit-success",
    "deposit-unsigned-envelope",
    "deposit-unsigned-tx",
    "deposit-validation",
    "deposit-asset-select-prompt",
    "deposit-unique-amount-prompt",
    "deposit-confirm-prompt",
  ]),
  "deposit asset select": new Set([
    "deposit-asset-select-prompt",
  ]),
  "deposit unique amount confirm": new Set([
    "deposit-unique-amount-prompt",
  ]),
  "deposit confirm": new Set([
    "deposit-confirm-prompt",
  ]),
  withdraw: new Set([
    "withdraw-dry-run-relayed",
    "withdraw-success-relayed",
    "withdraw-dry-run-direct",
    "withdraw-success-direct",
    "withdraw-unsigned-envelope",
    "withdraw-unsigned-tx",
    "withdraw-validation",
  ]),
  "withdraw confirm": new Set([
    "withdraw-confirm",
  ]),
  "withdraw pa select": new Set([
    "withdraw-pa-select-prompt",
  ]),
  "withdraw recipient input": new Set([
    "withdraw-recipient-prompt",
  ]),
  "withdraw direct confirm": new Set([
    "withdraw-direct-confirm-prompt",
  ]),
  "withdraw quote": new Set([
    "withdraw-quote",
    "withdraw-quote-template",
  ]),
  ragequit: new Set([
    "ragequit-dry-run",
    "ragequit-success",
    "ragequit-unsigned-envelope",
    "ragequit-unsigned-tx",
    "ragequit-validation",
  ]),
  "ragequit select": new Set([
    "ragequit-select",
  ]),
  "ragequit confirm": new Set([
    "ragequit-confirm",
  ]),
  upgrade: new Set([
    "upgrade-check",
    "upgrade-manual-only",
    "upgrade-no-update",
    "upgrade-auto-available",
    "upgrade-ready",
    "upgrade-performed",
  ]),
  "upgrade confirm": new Set([
    "upgrade-confirm-prompt",
  ]),
  "flow start": new Set([
    "flow-start-validation",
    "flow-start-configured",
    "flow-start-new-wallet",
    "flow-start-watch",
  ]),
  "flow start confirm": new Set([
    "flow-start-confirm-prompt",
  ]),
  "flow start new-wallet backup choice": new Set([
    "flow-start-new-wallet-backup-choice",
  ]),
  "flow start new-wallet backup path": new Set([
    "flow-start-new-wallet-backup-path-prompt",
  ]),
  "flow start new-wallet backup confirm": new Set([
    "flow-start-new-wallet-backup-confirm",
  ]),
  "flow watch": new Set([
    "flow-watch-awaiting-funding",
    "flow-watch-awaiting-asp",
    "flow-watch-waiting-privacy-delay",
    "flow-watch-ready",
    "flow-watch-withdrawing",
    "flow-watch-completed",
    "flow-watch-public-recovery",
    "flow-watch-declined",
    "flow-watch-poi-required",
    "flow-watch-relayer-minimum",
    "flow-watch-stopped-external",
  ]),
  "flow ragequit": new Set([
    "flow-ragequit-success",
    "flow-ragequit-error",
  ]),
};

export const RENDERER_FIXTURE_CASE_IDS = [
  ...Object.values(PREVIEW_SCENARIO_COMMANDS).flatMap((caseIds) => [...caseIds]),
];

export function isPreviewScenarioCaseForCommand(commandKey, caseId) {
  return PREVIEW_SCENARIO_COMMANDS[commandKey]?.has(caseId) ?? false;
}

function renderActivityPreview(caseId) {
  switch (caseId) {
    case "activity-empty":
      renderActivity(CONTEXT, {
        mode: "global-activity",
        chain: "sepolia",
        page: 1,
        perPage: 20,
        total: 0,
        totalPages: 1,
        events: [],
      });
      return;
    default:
      return false;
  }
}

function renderStatusPreview(caseId) {
  switch (caseId) {
    case "status-setup-required":
      renderStatus(CONTEXT, createStatusResult({
        configExists: false,
        defaultChain: null,
        selectedChain: null,
        recoveryPhraseSet: false,
        signerKeySet: false,
        signerKeyValid: false,
        signerAddress: null,
        rpcLive: undefined,
        aspLive: undefined,
        accountFiles: [],
      }));
      return;
    case "status-ready":
      renderStatus(CONTEXT, createStatusResult());
      return;
    case "status-degraded":
      renderStatus(CONTEXT, createStatusResult({
        aspLive: false,
        rpcLive: true,
      }));
      return;
    default:
      return false;
  }
}

function renderPoolsPreview(caseId) {
  const baseData = {
    allChains: false,
    chainName: "sepolia",
    sort: "tvl-desc",
    warnings: [],
  };

  switch (caseId) {
    case "pools-empty":
      renderPoolsEmpty(CONTEXT, {
        ...baseData,
        search: null,
        filteredPools: [],
      });
      return;
    case "pools-no-match":
      renderPools(CONTEXT, {
        ...baseData,
        search: "ZZZ",
        filteredPools: [],
      });
      return;
    default:
      return false;
  }
}

function renderAccountsPreview(caseId) {
  switch (caseId) {
    case "accounts-empty":
      renderAccountsNoPools(CONTEXT, {
        chain: "sepolia",
        summary: false,
        pendingOnly: false,
      });
      return;
    case "accounts-pending-empty":
      renderAccountsNoPools(CONTEXT, {
        chain: "sepolia",
        summary: false,
        pendingOnly: true,
      });
      return;
    case "accounts-populated":
    case "accounts-details":
      renderAccounts(CONTEXT, {
        chain: "sepolia",
        groups: POPULATED_GROUPS,
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      });
      return;
    case "accounts-summary":
      renderAccounts(CONTEXT, {
        chain: "sepolia",
        groups: POPULATED_GROUPS,
        showDetails: false,
        showSummary: true,
        showPendingOnly: false,
      });
      return;
    case "accounts-verbose":
      renderAccounts(VERBOSE_CONTEXT, {
        chain: "sepolia",
        groups: POPULATED_GROUPS,
        showDetails: true,
        showSummary: false,
        showPendingOnly: false,
      });
      return;
    default:
      return false;
  }
}

function renderHistoryPreview(caseId) {
  switch (caseId) {
    case "history-empty":
      renderHistoryNoPools(CONTEXT, "sepolia");
      return;
    case "history-populated":
      renderHistory(CONTEXT, {
        chain: "sepolia",
        chainId: SEPOLIA_CHAIN_ID,
        events: HISTORY_EVENTS,
        poolByAddress: historyPoolMap(),
        explorerTxUrl: explorerUrl,
        currentBlock: 240n,
        avgBlockTimeSec: 12,
      });
      return;
    default:
      return false;
  }
}

function renderSyncPreview(caseId) {
  switch (caseId) {
    case "sync-empty":
      renderSyncEmpty(CONTEXT, "sepolia");
      return;
    case "sync-success":
      renderSyncComplete(CONTEXT, {
        chain: "sepolia",
        syncedPools: 2,
        syncedSymbols: ["ETH", "USDC"],
        previousSpendableCount: 1,
        spendableCount: 3,
      });
      return;
    default:
      return false;
  }
}

function renderMigrationPreview(caseId) {
  switch (caseId) {
    case "migrate-status-no-legacy":
      renderMigrationStatus(CONTEXT, {
        mode: "migration-status",
        chain: "sepolia",
        status: "no_legacy",
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        isFullyMigrated: false,
        readinessResolved: true,
        submissionSupported: false,
        requiredChainIds: [],
        migratedChainIds: [],
        missingChainIds: [],
        websiteRecoveryChainIds: [],
        unresolvedChainIds: [],
        chainReadiness: [createMigrationChain({
          status: "no_legacy",
          candidateLegacyCommitments: 0,
          expectedLegacyCommitments: 0,
          migratedCommitments: 0,
          legacySpendableCommitments: 0,
          declinedLegacyCommitments: 0,
          scopes: [],
        })],
      });
      return;
    case "migrate-status-migration-required":
      renderMigrationStatus(CONTEXT, {
        mode: "migration-status",
        chain: "sepolia",
        status: "migration_required",
        requiresMigration: true,
        requiresWebsiteRecovery: false,
        isFullyMigrated: false,
        readinessResolved: true,
        submissionSupported: false,
        requiredChainIds: [SEPOLIA_CHAIN_ID],
        migratedChainIds: [],
        missingChainIds: [SEPOLIA_CHAIN_ID],
        websiteRecoveryChainIds: [],
        unresolvedChainIds: [],
        chainReadiness: [createMigrationChain({
          status: "migration_required",
          candidateLegacyCommitments: 3,
          expectedLegacyCommitments: 3,
          migratedCommitments: 1,
          legacySpendableCommitments: 2,
          declinedLegacyCommitments: 0,
          requiresMigration: true,
        })],
      });
      return;
    case "migrate-status-website-recovery":
      renderMigrationStatus(CONTEXT, {
        mode: "migration-status",
        chain: "sepolia",
        status: "website_recovery_required",
        requiresMigration: false,
        requiresWebsiteRecovery: true,
        isFullyMigrated: false,
        readinessResolved: true,
        submissionSupported: false,
        requiredChainIds: [],
        migratedChainIds: [],
        missingChainIds: [],
        websiteRecoveryChainIds: [SEPOLIA_CHAIN_ID],
        unresolvedChainIds: [],
        chainReadiness: [createMigrationChain({
          status: "website_recovery_required",
          candidateLegacyCommitments: 2,
          expectedLegacyCommitments: 2,
          migratedCommitments: 0,
          legacySpendableCommitments: 0,
          declinedLegacyCommitments: 2,
          requiresWebsiteRecovery: true,
        })],
      });
      return;
    case "migrate-status-review-incomplete":
      renderMigrationStatus(CONTEXT, {
        mode: "migration-status",
        chain: "sepolia",
        status: "review_incomplete",
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        isFullyMigrated: false,
        readinessResolved: false,
        submissionSupported: false,
        requiredChainIds: [],
        migratedChainIds: [],
        missingChainIds: [],
        websiteRecoveryChainIds: [],
        unresolvedChainIds: [SEPOLIA_CHAIN_ID],
        warnings: [{
          chain: "sepolia",
          category: "ASP",
          message: "Some legacy ASP review data could not be confirmed.",
        }],
        chainReadiness: [createMigrationChain({
          status: "review_incomplete",
          candidateLegacyCommitments: 2,
          expectedLegacyCommitments: 2,
          migratedCommitments: 1,
          legacySpendableCommitments: 1,
          declinedLegacyCommitments: 0,
          reviewStatusComplete: false,
        })],
      });
      return;
    case "migrate-status-fully-migrated":
      renderMigrationStatus(CONTEXT, {
        mode: "migration-status",
        chain: "sepolia",
        status: "fully_migrated",
        requiresMigration: false,
        requiresWebsiteRecovery: false,
        isFullyMigrated: true,
        readinessResolved: true,
        submissionSupported: false,
        requiredChainIds: [SEPOLIA_CHAIN_ID],
        migratedChainIds: [SEPOLIA_CHAIN_ID],
        missingChainIds: [],
        websiteRecoveryChainIds: [],
        unresolvedChainIds: [],
        chainReadiness: [createMigrationChain({
          status: "fully_migrated",
          candidateLegacyCommitments: 3,
          expectedLegacyCommitments: 3,
          migratedCommitments: 3,
          legacySpendableCommitments: 0,
          declinedLegacyCommitments: 0,
        })],
      });
      return;
    default:
      return false;
  }
}

function renderInitPreview(caseId) {
  switch (caseId) {
    case "init-generated":
      renderInitResult(CONTEXT, {
        setupMode: "create",
        readiness: "ready",
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showMnemonic: false,
        backupFilePath: "/Users/example/privacy-pools-recovery.txt",
      });
      return;
    case "init-imported":
      renderInitResult(CONTEXT, {
        setupMode: "restore",
        readiness: "read_only",
        defaultChain: "sepolia",
        signerKeySet: false,
        mnemonicImported: true,
        showMnemonic: false,
        restoreDiscovery: {
          status: "deposits_found",
          chainsChecked: ["mainnet", "arbitrum", "optimism"],
          foundAccountChains: ["mainnet", "optimism"],
        },
      });
      return;
    case "init-setup-mode-prompt":
      process.stderr.write(
        `${renderInitGoalReview({
          hasRecoveryPhrase: false,
          signerKeyReady: false,
        })}  Create a new Privacy Pools account\n  Load an existing Privacy Pools account\n`,
      );
      return;
    case "init-overwrite-prompt":
      process.stderr.write(
        `${renderInitOverwriteReview(true)}${formatPromptLine("Replace the current local setup by loading this account? [y/N]")}`,
      );
      return;
    case "init-import-recovery-prompt":
      process.stderr.write(
        `${renderInitLoadRecoveryReview()}  Recovery phrase (12 or 24 words):\n`,
      );
      return;
    case "init-backup-method-prompt":
      process.stderr.write(
        `${renderInitBackupMethodReview()}` +
        "  Save to file (recommended)\n  I'll back it up manually\n",
      );
      return;
    case "init-backup-path-prompt":
      process.stderr.write(
        `${renderInitBackupPathReview("/Users/example/privacy-pools-recovery.txt")}  Save location: /Users/example/privacy-pools-recovery.txt\n`,
      );
      return;
    case "init-backup-confirm-prompt":
      process.stderr.write(
        `${renderInitBackupConfirmationReview(
          "file",
          "/Users/example/privacy-pools-recovery.txt",
        )}  I have securely backed up my recovery phrase. [y/N]\n`,
      );
      return;
    case "init-recovery-verification-prompt":
      process.stderr.write(
        `${renderInitRecoveryVerificationReview([3, 12, 24])}  Word #3:\n`,
      );
      return;
    case "init-signer-key-prompt":
      process.stderr.write(
        `${renderInitSignerKeyReview()}  Signer key (private key, 0x..., or Enter to skip):\n`,
      );
      return;
    case "init-default-chain-prompt":
      process.stderr.write(
        `${formatSectionHeading("Choose default network", {
          divider: true,
          padTop: false,
        })}${formatCallout("read-only", [
          "Init stores a default chain so follow-up commands know which network to target first.",
        ])}  mainnet\n  arbitrum\n  optimism\n  sepolia (testnet)\n  optimism-sepolia (testnet)\n`,
      );
      return;
    default:
      return false;
  }
}

function renderDepositPreview(caseId) {
  switch (caseId) {
    case "deposit-dry-run":
      renderDepositDryRun(CONTEXT, {
        chain: "sepolia",
        asset: "ETH",
        amount: 100000000000000000n,
        decimals: 18,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        precommitment: 777n,
        balanceSufficient: true,
      });
      return;
    case "deposit-success":
      renderDepositSuccess(CONTEXT, {
        txHash:
          "0x1234123412341234123412341234123412341234123412341234123412341234",
        amount: 100000000000000000n,
        committedValue: 99500000000000000n,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: 1n,
        label: 999n,
        blockNumber: 301n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x1234",
        chainOverridden: true,
      });
      return;
    case "deposit-unsigned-envelope":
      printJsonEnvelope(createUnsignedEnvelope("deposit"));
      return;
    case "deposit-unsigned-tx":
      printRawTransactions(createUnsignedTxList("deposit"));
      return;
    case "deposit-validation":
      throw new CLIError(
        "Non-round amount 0.123456789 ETH may reduce privacy.",
        "INPUT",
        "Unique amounts can be linked between deposits and withdrawals. Pass --ignore-unique-amount to proceed anyway.",
      );
    case "deposit-asset-select-prompt":
      process.stderr.write(
        `${formatSectionHeading("Select asset to deposit", {
          divider: true,
          padTop: false,
        })}${formatCallout("read-only", [
          "Choose which pool asset you want to fund.",
        ])}  ETH (0xEeee...EEeE)\n  USDC (0xaf88...5831)\n`,
      );
      return;
    case "deposit-unique-amount-prompt":
      process.stderr.write(formatPromptLine("Proceed with this amount anyway? [y/N]"));
      return;
    case "deposit-confirm-prompt":
      process.stderr.write(formatPromptLine("Confirm deposit? [Y/n]"));
      return;
    default:
      return false;
  }
}

function renderWithdrawPreview(caseId) {
  switch (caseId) {
    case "withdraw-quote":
      renderWithdrawQuote(CONTEXT, {
        chain: "sepolia",
        asset: "USDC",
        amount: 150000000n,
        decimals: 6,
        recipient: TEST_RECIPIENT,
        minWithdrawAmount: "10000000",
        baseFeeBPS: "30",
        quoteFeeBPS: "35",
        feeCommitmentPresent: true,
        quoteExpiresAt: "2026-04-07T18:42:00.000Z",
        tokenPrice: 1,
        extraGas: true,
        relayTxCost: {
          gas: "210000",
          eth: "1200000000000000",
        },
        extraGasFundAmount: {
          gas: "0",
          eth: "1500000000000000",
        },
        extraGasTxCost: {
          gas: "25000",
          eth: "500000000000000",
        },
        chainOverridden: true,
      });
      return;
    case "withdraw-quote-template":
      renderWithdrawQuote(CONTEXT, {
        chain: "sepolia",
        asset: "USDC",
        amount: 150000000n,
        decimals: 6,
        recipient: undefined,
        minWithdrawAmount: "10000000",
        baseFeeBPS: "30",
        quoteFeeBPS: "35",
        feeCommitmentPresent: true,
        quoteExpiresAt: "2026-04-07T18:42:00.000Z",
        tokenPrice: 1,
        extraGas: true,
        relayTxCost: {
          gas: "210000",
          eth: "1200000000000000",
        },
        extraGasFundAmount: {
          gas: "0",
          eth: "1500000000000000",
        },
        extraGasTxCost: {
          gas: "25000",
          eth: "500000000000000",
        },
        chainOverridden: true,
      });
      return;
    case "withdraw-dry-run-relayed":
      renderWithdrawDryRun(CONTEXT, {
        withdrawMode: "relayed",
        amount: 50000000n,
        asset: "USDC",
        chain: "sepolia",
        decimals: 6,
        recipient: TEST_RECIPIENT,
        poolAccountNumber: 4,
        poolAccountId: "PA-4",
        selectedCommitmentLabel: 9101n,
        selectedCommitmentValue: 125000000n,
        proofPublicSignals: 8,
        feeBPS: "35",
        quoteExpiresAt: "2026-04-07T18:42:00.000Z",
        extraGas: true,
        anonymitySet: { eligible: 82, total: 130, percentage: 63.1 },
      });
      return;
    case "withdraw-success-relayed":
      renderWithdrawSuccess(CONTEXT, {
        withdrawMode: "relayed",
        txHash:
          "0x9999999999999999999999999999999999999999999999999999999999999999",
        blockNumber: 404n,
        amount: 50000000n,
        recipient: TEST_RECIPIENT,
        asset: "USDC",
        chain: "sepolia",
        decimals: 6,
        poolAccountNumber: 4,
        poolAccountId: "PA-4",
        poolAddress: "0x2222222222222222222222222222222222222222",
        scope: 2n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x9999",
        feeBPS: "35",
        extraGas: true,
        remainingBalance: 75000000n,
        tokenPrice: 1,
        anonymitySet: { eligible: 82, total: 130, percentage: 63.1 },
      });
      return;
    case "withdraw-dry-run-direct":
      renderWithdrawDryRun(CONTEXT, {
        withdrawMode: "direct",
        amount: 300000000000000000n,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        recipient: TEST_RECIPIENT,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        selectedCommitmentLabel: 9001n,
        selectedCommitmentValue: 800000000000000000n,
        proofPublicSignals: 8,
      });
      return;
    case "withdraw-success-direct":
      renderWithdrawSuccess(CONTEXT, {
        withdrawMode: "direct",
        txHash:
          "0x7777777777777777777777777777777777777777777777777777777777777777",
        blockNumber: 405n,
        amount: 300000000000000000n,
        recipient: TEST_RECIPIENT,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: 1n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x7777",
        remainingBalance: 500000000000000000n,
        tokenPrice: 3200,
      });
      return;
    case "withdraw-confirm":
      process.stderr.write(formatPromptLine("Confirm withdrawal? [y/N]"));
      return;
    case "withdraw-pa-select-prompt":
      process.stderr.write(
        `${formatSectionHeading("Select Pool Account", {
          divider: true,
          padTop: false,
        })}${formatCallout("privacy", [
          "Choose which approved Pool Account should fund this withdrawal.",
          "The CLI will use the selected account's remaining balance and approval state.",
        ])}  PA-4  125 USDC\n  PA-6  80 USDC\n`,
      );
      return;
    case "withdraw-recipient-prompt":
      process.stderr.write(
        `${formatSectionHeading("Recipient", {
          divider: true,
          padTop: false,
        })}${formatKeyValueRows([
          { label: "Pool Account", value: "PA-4" },
          { label: "Amount", value: "50 USDC" },
          { label: "Chain", value: "sepolia" },
        ])}  Recipient address:\n`,
      );
      return;
    case "withdraw-direct-confirm-prompt":
      process.stderr.write(formatPromptLine("Confirm direct withdrawal? [y/N]"));
      return;
    case "withdraw-unsigned-envelope":
      printJsonEnvelope(createUnsignedEnvelope("withdraw"));
      return;
    case "withdraw-unsigned-tx":
      printRawTransactions(createUnsignedTxList("withdraw"));
      return;
    case "withdraw-validation":
      throw new CLIError(
        "Direct withdrawal requires --to <address> in unsigned mode (no signer key available).",
        "INPUT",
        "Provide --to 0xRecipient or omit --unsigned.",
      );
    default:
      return false;
  }
}

function renderRagequitPreview(caseId) {
  switch (caseId) {
    case "ragequit-dry-run":
      renderRagequitDryRun(CONTEXT, {
        chain: "sepolia",
        asset: "ETH",
        amount: 400000000000000000n,
        decimals: 18,
        destinationAddress: TEST_DEPOSIT_ADDRESS,
        poolAccountNumber: 3,
        poolAccountId: "PA-3",
        selectedCommitmentLabel: 9003n,
        selectedCommitmentValue: 400000000000000000n,
        proofPublicSignals: 8,
      });
      return;
    case "ragequit-success":
      renderRagequitSuccess(CONTEXT, {
        txHash:
          "0x6666666666666666666666666666666666666666666666666666666666666666",
        amount: 400000000000000000n,
        asset: "ETH",
        chain: "sepolia",
        decimals: 18,
        poolAccountNumber: 3,
        poolAccountId: "PA-3",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: 1n,
        blockNumber: 406n,
        explorerUrl: "https://sepolia.etherscan.io/tx/0x6666",
        destinationAddress: TEST_DEPOSIT_ADDRESS,
      });
      return;
    case "ragequit-select":
      process.stderr.write(
        `${formatSectionHeading("Recovery candidates", {
          divider: true,
          padTop: false,
        })}${formatCallout("recovery", [
          "Choose the Pool Account you want to recover publicly to its original deposit address.",
          "Approved accounts can still use withdraw if you want to preserve privacy instead.",
        ])}  PA-3  0.4 ETH  declined\n  PA-4  0.2 ETH  pending\n`,
      );
      return;
    case "ragequit-confirm":
      process.stderr.write(formatPromptLine("Confirm public recovery? [y/N]"));
      return;
    case "ragequit-unsigned-envelope":
      printJsonEnvelope(createUnsignedEnvelope("ragequit"));
      return;
    case "ragequit-unsigned-tx":
      printRawTransactions(createUnsignedTxList("ragequit"));
      return;
    case "ragequit-validation":
      throw new CLIError(
        "unknown option '--mystery'",
        "INPUT",
        "Use --help to see usage and examples.",
      );
    default:
      return false;
  }
}

function renderUpgradePreview(caseId) {
  switch (caseId) {
    case "upgrade-check":
    case "upgrade-manual-only":
      renderUpgradeResult(CONTEXT, {
        mode: "upgrade",
        status: "manual",
        currentVersion: "2.0.0",
        latestVersion: "1.8.0",
        updateAvailable: true,
        performed: false,
        command: "npm install -g privacy-pools-cli@1.8.0",
        installContext: {
          kind: "source_checkout",
          supportedAutoRun: false,
          reason:
            "This CLI is running from a source checkout. Automatic upgrade is unsupported there, so install the published CLI separately with the npm command below.",
        },
        installedVersion: null,
      });
      return;
    case "upgrade-no-update":
      renderUpgradeResult(CONTEXT, {
        mode: "upgrade",
        status: "up_to_date",
        currentVersion: "2.0.0",
        latestVersion: "2.0.0",
        updateAvailable: false,
        performed: false,
        command: null,
        installContext: {
          kind: "npm_global",
          supportedAutoRun: true,
          reason: "Global npm installation detected.",
        },
        installedVersion: "2.0.0",
      });
      return;
    case "upgrade-ready":
    case "upgrade-auto-available":
      renderUpgradeResult(CONTEXT, {
        mode: "upgrade",
        status: "ready",
        currentVersion: "2.0.0",
        latestVersion: "1.8.0",
        updateAvailable: true,
        performed: false,
        command: "npm install -g privacy-pools-cli@1.8.0",
        installContext: {
          kind: "npm_global",
          supportedAutoRun: true,
          reason: "Global npm installation detected.",
        },
        installedVersion: null,
      });
      return;
    case "upgrade-performed":
      renderUpgradeResult(CONTEXT, {
        mode: "upgrade",
        status: "upgraded",
        currentVersion: "2.0.0",
        latestVersion: "1.8.0",
        updateAvailable: true,
        performed: true,
        command: null,
        installContext: {
          kind: "npm_global",
          supportedAutoRun: true,
          reason: "Global npm installation detected.",
        },
        installedVersion: "1.8.0",
      });
      return;
    case "upgrade-confirm-prompt":
      process.stderr.write(formatPromptLine("Install update now? [Y/n]"));
      return;
    default:
      return false;
  }
}

function renderFlowPreview(caseId) {
  switch (caseId) {
    case "flow-start-validation":
      throw new CLIError(
        "Missing required --to <address>.",
        "INPUT",
        "Use 'privacy-pools flow start <amount> <asset> --to 0xRecipient...'.",
      );
    case "flow-start-configured":
      renderFlowResult(CONTEXT, {
        action: "start",
        snapshot: createFlowSnapshot({
          workflowId: "wf-start-configured",
          phase: "awaiting_asp",
          aspStatus: "pending",
        }),
      });
      return;
    case "flow-start-new-wallet":
      renderFlowResult(CONTEXT, {
        action: "start",
        snapshot: createFlowSnapshot({
          workflowId: "wf-start-new-wallet",
          phase: "awaiting_funding",
          walletMode: "new_wallet",
          walletAddress: "0x000000000000000000000000000000000000f10f",
          poolAccountId: null,
          poolAccountNumber: null,
          depositTxHash: null,
          depositBlockNumber: null,
          depositExplorerUrl: null,
          committedValue: null,
        }),
      });
      return;
    case "flow-start-watch":
      renderFlowResult(CONTEXT, {
        action: "start",
        snapshot: createFlowSnapshot({
          workflowId: "wf-start-watch",
          phase: "awaiting_asp",
          aspStatus: "pending",
        }),
      });
      return;
    case "flow-start-confirm-prompt":
      process.stderr.write(formatPromptLine("Confirm flow start? [Y/n]"));
      return;
    case "flow-start-new-wallet-backup-choice":
      process.stderr.write(
        `  Save to file (recommended)\n  I'll back it up manually\n${formatPromptLine("How would you like to back up this workflow wallet?")}`,
      );
      return;
    case "flow-start-new-wallet-backup-path-prompt":
      process.stderr.write(formatPromptLine("Save location: /tmp/preview-flow-wallet.txt"));
      return;
    case "flow-start-new-wallet-backup-confirm":
      process.stderr.write(
        formatPromptLine("I have securely backed up this workflow wallet. [y/N]"),
      );
      return;
    case "flow-watch-awaiting-funding":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-awaiting-funding",
          phase: "awaiting_funding",
          walletMode: "new_wallet",
          walletAddress: "0x000000000000000000000000000000000000f10f",
          poolAccountId: null,
          poolAccountNumber: null,
          depositTxHash: null,
          depositBlockNumber: null,
          depositExplorerUrl: null,
          committedValue: null,
        }),
      });
      return;
    case "flow-watch-awaiting-asp":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-awaiting-asp",
          phase: "awaiting_asp",
          aspStatus: "pending",
        }),
      });
      return;
    case "flow-watch-waiting-privacy-delay":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-waiting-delay",
          phase: "approved_waiting_privacy_delay",
          aspStatus: "approved",
          privacyDelayUntil: "2026-04-07T18:30:00.000Z",
        }),
      });
      return;
    case "flow-watch-ready":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-ready",
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
        }),
      });
      return;
    case "flow-watch-withdrawing":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-withdrawing",
          phase: "withdrawing",
          aspStatus: "approved",
          withdrawTxHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }),
      });
      return;
    case "flow-watch-completed":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-completed",
          phase: "completed",
          aspStatus: "approved",
          withdrawTxHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          withdrawBlockNumber: "12399",
          withdrawExplorerUrl: "https://example.test/tx/0xbbbbbbbb",
        }),
      });
      return;
    case "flow-watch-public-recovery":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-public-recovery",
          phase: "completed_public_recovery",
          aspStatus: "declined",
          ragequitTxHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          ragequitBlockNumber: "12425",
          ragequitExplorerUrl: "https://example.test/tx/0xcccccccc",
        }),
      });
      return;
    case "flow-watch-declined":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-declined",
          phase: "paused_declined",
          aspStatus: "declined",
          lastError: {
            step: "asp_review",
            errorCode: "FLOW_DECLINED",
            errorMessage: "The ASP declined this workflow during review.",
            retryable: false,
            at: "2026-03-27T12:05:00.000Z",
          },
        }),
      });
      return;
    case "flow-watch-poi-required":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-poi-required",
          phase: "paused_poa_required",
          aspStatus: "poi_required",
          lastError: {
            step: "asp_review",
            errorCode: "FLOW_POI_REQUIRED",
            errorMessage: "Proof of Association is required before a private withdrawal.",
            retryable: false,
            at: "2026-03-27T12:05:00.000Z",
          },
        }),
      });
      return;
    case "flow-watch-relayer-minimum":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-relayer-minimum",
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
          lastError: {
            step: "withdraw",
            errorCode: "FLOW_RELAYER_MINIMUM_BLOCKED",
            errorMessage: "The saved workflow balance is below the relayer minimum.",
            retryable: false,
            at: "2026-03-27T12:05:00.000Z",
          },
        }),
      });
      return;
    case "flow-watch-stopped-external":
      renderFlowResult(CONTEXT, {
        action: "watch",
        snapshot: createFlowSnapshot({
          workflowId: "wf-watch-stopped-external",
          phase: "stopped_external",
          aspStatus: "approved",
          lastError: {
            step: "reconcile",
            errorCode: "FLOW_STOPPED_EXTERNAL",
            errorMessage: "The saved Pool Account changed outside this workflow.",
            retryable: false,
            at: "2026-03-27T12:05:00.000Z",
          },
        }),
      });
      return;
    case "flow-ragequit-success":
      renderFlowResult(CONTEXT, {
        action: "ragequit",
        snapshot: createFlowSnapshot({
          workflowId: "wf-ragequit-success",
          phase: "completed_public_recovery",
          aspStatus: "declined",
          ragequitTxHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          ragequitBlockNumber: "12425",
          ragequitExplorerUrl: "https://example.test/tx/0xcccccccc",
        }),
      });
      return;
    case "flow-ragequit-error":
      throw new CLIError(
        "This saved workflow cannot use public recovery anymore because the private withdrawal already completed.",
        "INPUT",
        "Use 'privacy-pools flow status latest' to inspect the completed workflow.",
      );
    default:
      return false;
  }
}

export async function renderPreviewFixture(caseId) {
  process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "1";
  const isPromptCase = caseId.includes("-prompt");

  if (caseId.startsWith("activity-")) {
    await showPreviewSpinner("Fetching public activity...", "Activity loaded.");
    renderActivityPreview(caseId);
    return;
  }

  if (caseId.startsWith("status-")) {
    renderStatusPreview(caseId);
    return;
  }

  if (caseId.startsWith("pools-")) {
    await showPreviewSpinner("Fetching pools...", "Pools loaded.");
    renderPoolsPreview(caseId);
    return;
  }

  if (caseId.startsWith("accounts-")) {
    await showPreviewSpinner("Loading My Pools...", "Pool Accounts ready.");
    renderAccountsPreview(caseId);
    return;
  }

  if (caseId.startsWith("history-")) {
    await showPreviewSpinner("Loading history...", "History loaded.");
    renderHistoryPreview(caseId);
    return;
  }

  if (caseId.startsWith("sync-")) {
    await showPreviewSpinner("Syncing account state...", caseId === "sync-success" ? "Sync complete." : null);
    renderSyncPreview(caseId);
    return;
  }

  if (caseId.startsWith("migrate-status-")) {
    await showPreviewSpinner("Checking legacy migration readiness...", "Migration readiness loaded.");
    renderMigrationPreview(caseId);
    return;
  }

  if (caseId.startsWith("init-")) {
    renderInitPreview(caseId);
    return;
  }

  if (caseId.startsWith("deposit-")) {
    if (!isPromptCase) {
      await showPreviewSpinner("Preparing deposit preview...", "Deposit preview ready.");
    }
    renderDepositPreview(caseId);
    return;
  }

  if (caseId.startsWith("withdraw-")) {
    if (!isPromptCase) {
      await showPreviewSpinner("Preparing withdrawal preview...", "Withdrawal preview ready.");
    }
    renderWithdrawPreview(caseId);
    return;
  }

  if (caseId.startsWith("ragequit-")) {
    await showPreviewSpinner("Preparing public recovery preview...", "Recovery preview ready.");
    renderRagequitPreview(caseId);
    return;
  }

  if (caseId.startsWith("upgrade-")) {
    if (!isPromptCase) {
      await showPreviewSpinner("Checking for upgrades...", caseId === "upgrade-performed" ? "Upgrade installed." : null);
    }
    renderUpgradePreview(caseId);
    return;
  }

  if (caseId.startsWith("flow-")) {
    if (!isPromptCase) {
      await showPreviewSpinner("Reviewing saved workflow...", "Workflow state loaded.");
    }
    renderFlowPreview(caseId);
    return;
  }

  throw new Error(`Unknown preview fixture case: ${caseId}`);
}
