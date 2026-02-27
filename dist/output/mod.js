/**
 * Output module barrel.
 *
 * Re-exports shared primitives and command-specific renderers.
 * Command handlers import from here or from individual renderer files.
 */
// Shared primitives
export { createOutputContext, isSilent, stderrLine, printJsonSuccess, printError, info, success, warn, verbose, spinner, printTable, } from "./common.js";
// Command renderers
export { renderGuide } from "./guide.js";
export { renderCapabilities, } from "./capabilities.js";
export { renderCompletionScript, renderCompletionQuery, } from "./completion.js";
export { renderSyncEmpty, renderSyncComplete, } from "./sync.js";
export { renderStatus, } from "./status.js";
export { renderPoolsEmpty, renderPools, poolToJson, } from "./pools.js";
export { renderBalanceNoPools, renderBalanceEmpty, renderBalance, } from "./balance.js";
export { renderAccountsNoPools, renderAccounts, } from "./accounts.js";
export { renderHistoryNoPools, renderHistory, } from "./history.js";
export { renderInitResult, } from "./init.js";
export { renderDepositDryRun, renderDepositSuccess, } from "./deposit.js";
export { renderRagequitDryRun, renderRagequitSuccess, } from "./ragequit.js";
export { renderWithdrawDryRun, renderWithdrawSuccess, renderWithdrawQuote, } from "./withdraw.js";
