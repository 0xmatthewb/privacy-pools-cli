import { type ChainConfig } from "../types.js";
import { CHAINS, getDefaultReadOnlyChains, resolveChainOverrides } from "../config/chains.js";
import type { RestoreDiscoverySummary } from "../types.js";
import { CLIError } from "../utils/errors.js";
import { getDataService } from "./sdk.js";
import { listKnownPoolsFromRegistry } from "./pools.js";
import { initializeAccountServiceWithState, toPoolInfo } from "./account.js";
import { accountHasDeposits } from "./account-storage.js";

const LEGACY_WEBSITE_ACTION_CODES = new Set([
  "ACCOUNT_MIGRATION_REQUIRED",
  "ACCOUNT_WEBSITE_RECOVERY_REQUIRED",
]);

export interface InitRestoreDiscoveryOptions {
  defaultChain: string;
  rpcUrl?: string;
  onProgress?: (state: {
    currentChain: string;
    completedChains: number;
    totalChains: number;
  }) => void;
}

function resolveDiscoveryChains(defaultChain: string): ChainConfig[] {
  const chains = new Map<string, ChainConfig>(
    getDefaultReadOnlyChains().map((chain) => [chain.name, chain]),
  );

  const selectedChain = CHAINS[defaultChain];
  if (selectedChain?.isTestnet) {
    chains.set(selectedChain.name, resolveChainOverrides(selectedChain));
  }

  return [...chains.values()];
}

function classifyRestoreDiscoveryError(error: unknown): RestoreDiscoverySummary["status"] {
  if (
    error instanceof CLIError &&
    typeof error.code === "string" &&
    LEGACY_WEBSITE_ACTION_CODES.has(error.code)
  ) {
    return "legacy_website_action_required";
  }

  return "degraded";
}

export async function discoverLoadedAccounts(
  mnemonic: string,
  options: InitRestoreDiscoveryOptions,
): Promise<RestoreDiscoverySummary> {
  const discoveryChains = resolveDiscoveryChains(options.defaultChain);
  const chainsChecked: string[] = [];
  const foundAccountChains = new Set<string>();
  let sawWebsiteActionRequired = false;
  let sawDegradedChain = false;

  for (const [index, chainConfig] of discoveryChains.entries()) {
    chainsChecked.push(chainConfig.name);
    options.onProgress?.({
      currentChain: chainConfig.name,
      completedChains: index,
      totalChains: discoveryChains.length,
    });

    try {
      const chainRpcOverride =
        chainConfig.name === options.defaultChain ? options.rpcUrl : undefined;
      const pools = await listKnownPoolsFromRegistry(chainConfig, chainRpcOverride);
      if (pools.length === 0) {
        sawDegradedChain = true;
        continue;
      }

      const dataService = await getDataService(
        chainConfig,
        pools[0]!.pool,
        chainRpcOverride,
      );

      await initializeAccountServiceWithState(
        dataService,
        mnemonic,
        pools.map((pool) =>
          toPoolInfo({
            chainId: chainConfig.id,
            address: pool.pool,
            scope: pool.scope,
            deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
          }),
        ),
        chainConfig.id,
        {
          allowLegacyAccountRebuild: true,
          forceSyncSavedAccount: true,
          suppressWarnings: true,
          strictSync: true,
          allowLegacyRecoveryVisibility: true,
        },
      );

      if (accountHasDeposits(chainConfig.id)) {
        foundAccountChains.add(chainConfig.name);
      }
    } catch (error) {
      const classified = classifyRestoreDiscoveryError(error);
      if (classified === "legacy_website_action_required") {
        sawWebsiteActionRequired = true;
      } else {
        sawDegradedChain = true;
      }
    }
  }

  const foundChains = [...foundAccountChains];

  if (sawWebsiteActionRequired) {
    return {
      status: "legacy_website_action_required",
      chainsChecked,
      ...(foundChains.length > 0 ? { foundAccountChains: foundChains } : {}),
    };
  }

  if (foundChains.length > 0) {
    return {
      status: "deposits_found",
      chainsChecked,
      foundAccountChains: foundChains,
    };
  }

  if (sawDegradedChain) {
    return {
      status: "degraded",
      chainsChecked,
    };
  }

  return {
    status: "no_deposits",
    chainsChecked,
  };
}
