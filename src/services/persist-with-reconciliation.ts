import type {
  AccountService,
  DataService,
} from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import { syncAccountEvents } from "./account.js";
import { guardCriticalSection, releaseCriticalSection } from "../utils/critical-section.js";
import { info, warn } from "../utils/format.js";
import { sanitizeDiagnosticText } from "../utils/errors.js";
import type { ChainConfig } from "../types.js";

export interface PersistWithReconciliationParams {
  accountService: AccountService;
  chainConfig: ChainConfig;
  dataService: DataService;
  mnemonic: string;
  pool: {
    pool: Address;
    symbol: string;
    scope: bigint;
    deploymentBlock?: bigint;
  };
  silent: boolean;
  isJson: boolean;
  isVerbose: boolean;
  errorLabel: string;
  reconcileHint: string;
  persistFailureMessage: string;
  forceReconciliation?: boolean;
  allowLegacyRecoveryVisibility?: boolean;
  warningCode?: string;
  persist?: () => void | Promise<void>;
}

export interface PersistWithReconciliationResult {
  reconciliationRequired: boolean;
  localStateSynced: boolean;
  warningCode: string | null;
}

const DEFAULT_RECONCILIATION_WARNING_CODE = "LOCAL_STATE_RECONCILIATION_REQUIRED";

export async function persistWithReconciliation(
  params: PersistWithReconciliationParams,
): Promise<PersistWithReconciliationResult> {
  let needsReconciliation = params.forceReconciliation ?? false;
  let localStateSynced = true;
  let warningCode: string | null = null;

  guardCriticalSection();
  try {
    if (!needsReconciliation && params.persist) {
      try {
        await params.persist();
      } catch (persistError) {
        warn(
          `${params.persistFailureMessage}: ${sanitizeDiagnosticText(
            persistError instanceof Error ? persistError.message : String(persistError),
          )}`,
          params.silent,
        );
        needsReconciliation = true;
        localStateSynced = false;
      }
    }

    if (needsReconciliation) {
      try {
        await syncAccountEvents(
          params.accountService,
          [{
            chainId: params.chainConfig.id,
            address: params.pool.pool,
            scope: params.pool.scope,
            deploymentBlock: params.pool.deploymentBlock ?? params.chainConfig.startBlock,
          }],
          [{ pool: params.pool.pool, symbol: params.pool.symbol }],
          params.chainConfig.id,
          {
            skip: false,
            force: true,
            silent: params.silent,
            isJson: params.isJson,
            isVerbose: params.isVerbose,
            errorLabel: params.errorLabel,
            dataService: params.dataService,
            mnemonic: params.mnemonic,
            allowLegacyRecoveryVisibility: params.allowLegacyRecoveryVisibility,
          },
        );
        info("Local account state reconciled from chain events.", params.silent);
        needsReconciliation = false;
        localStateSynced = true;
      } catch (syncError) {
        warn(
          `Automatic reconciliation failed: ${sanitizeDiagnosticText(
            syncError instanceof Error ? syncError.message : String(syncError),
          )}`,
          params.silent,
        );
        warn(params.reconcileHint, params.silent);
        localStateSynced = false;
        warningCode =
          params.warningCode ?? DEFAULT_RECONCILIATION_WARNING_CODE;
      }
    }
  } finally {
    releaseCriticalSection();
  }

  return {
    reconciliationRequired: needsReconciliation || !localStateSynced,
    localStateSynced,
    warningCode,
  };
}
