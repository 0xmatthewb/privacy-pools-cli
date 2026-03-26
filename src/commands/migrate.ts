import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import type { Command } from "commander";
import {
  getAllChainsWithOverrides,
  getDefaultReadOnlyChains,
  MULTI_CHAIN_SCOPE_ALL_CHAINS,
  MULTI_CHAIN_SCOPE_ALL_MAINNETS,
} from "../config/chains.js";
import { resolveChain } from "../utils/validation.js";
import { loadConfig } from "../services/config.js";
import { loadMnemonic } from "../services/wallet.js";
import { getDataService } from "../services/sdk.js";
import { listKnownPoolsFromRegistry } from "../services/pools.js";
import {
  buildMigrationChainReadinessFromLegacyAccount,
  type MigrationChainReadiness,
  type MigrationChainStatus,
} from "../services/migration.js";
import { spinner } from "../utils/format.js";
import { CLIError, classifyError, printError } from "../utils/errors.js";
import type { ChainConfig, GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  createOutputContext,
  isSilent,
  renderMigrationStatus,
  type MigrationChainRenderData,
  type MigrationRenderData,
  type MigrationStatusSummary,
  type MigrationWarning,
} from "../output/mod.js";
import {
  toPoolInfo,
  withSuppressedSdkStdout,
} from "../services/account.js";

interface MigrateStatusCommandOptions {
  allChains?: boolean;
}

interface LoadedChainMigration {
  chainConfig: ChainConfig;
  readiness: MigrationChainReadiness;
}

export { createMigrateCommand } from "../command-shells/migrate.js";

function createCoverageLimitationWarning(rootChain: string): MigrationWarning {
  return {
    chain: rootChain,
    category: "COVERAGE",
    message:
      "This command only checks chains currently supported by the CLI. Review beta or other website-only legacy migration surfaces in the Privacy Pools website.",
  };
}

function formatMigrationLoadingText(
  allChains: boolean | undefined,
  completedChains?: number,
  totalChains?: number,
): string {
  const scope = allChains ? "all chains" : "mainnet chains";
  const base = `Checking legacy migration readiness across ${scope}...`;
  if (completedChains === undefined || totalChains === undefined) {
    return base;
  }
  return `${base} (${completedChains}/${totalChains} complete)`;
}

function formatIncompleteMigrationReviewWarning(chainName: string): string {
  return `Some legacy ASP review data was unavailable or incomplete on ${chainName}; declined legacy deposits may still be mixed into this readiness result. Review the account in the Privacy Pools website before treating it as final.`;
}

function summarizeInitErrors(
  initErrors: Array<{ scope: bigint; reason: string }>,
): string {
  return initErrors
    .slice(0, 3)
    .map((entry) => `scope ${entry.scope.toString()}: ${entry.reason}`)
    .join("; ");
}

function normalizeTopLevelMigrationStatus(
  chainReadiness: readonly MigrationChainRenderData[],
): MigrationStatusSummary {
  if (chainReadiness.some((entry) => !entry.reviewStatusComplete)) {
    return "review_incomplete";
  }
  if (chainReadiness.some((entry) => entry.requiresMigration)) {
    return "migration_required";
  }
  if (chainReadiness.some((entry) => entry.requiresWebsiteRecovery)) {
    return "website_recovery_required";
  }
  if (chainReadiness.some((entry) => entry.status === "fully_migrated")) {
    return "fully_migrated";
  }
  return "no_legacy";
}

export interface MigrationStatusSummaryState {
  requiredChainIds: number[];
  migratedChainIds: number[];
  missingChainIds: number[];
  websiteRecoveryChainIds: number[];
  unresolvedChainIds: number[];
  requiresMigration: boolean;
  requiresWebsiteRecovery: boolean;
  isFullyMigrated: boolean;
  readinessResolved: boolean;
}

export function summarizeMigrationStatusState(
  chainReadiness: readonly MigrationChainRenderData[],
): MigrationStatusSummaryState {
  const requiredChainIds = chainReadiness
    .filter((entry) => entry.expectedLegacyCommitments > 0)
    .map((entry) => entry.chainId);
  const migratedChainIds = chainReadiness
    .filter(
      (entry) =>
        entry.expectedLegacyCommitments > 0 && entry.status === "fully_migrated",
    )
    .map((entry) => entry.chainId);
  const missingChainIds = chainReadiness
    .filter((entry) => entry.requiresMigration)
    .map((entry) => entry.chainId);
  const websiteRecoveryChainIds = chainReadiness
    .filter((entry) => entry.requiresWebsiteRecovery)
    .map((entry) => entry.chainId);
  const unresolvedChainIds = chainReadiness
    .filter((entry) => !entry.reviewStatusComplete)
    .map((entry) => entry.chainId);
  const readinessResolved = unresolvedChainIds.length === 0;
  const requiresMigration = missingChainIds.length > 0;
  const requiresWebsiteRecovery = websiteRecoveryChainIds.length > 0;
  const isFullyMigrated =
    readinessResolved &&
    !requiresMigration &&
    !requiresWebsiteRecovery;

  return {
    requiredChainIds,
    migratedChainIds,
    missingChainIds,
    websiteRecoveryChainIds,
    unresolvedChainIds,
    requiresMigration,
    requiresWebsiteRecovery,
    isFullyMigrated,
    readinessResolved,
  };
}

function toRenderReadiness(
  chainConfig: ChainConfig,
  readiness: MigrationChainReadiness,
): MigrationChainRenderData {
  return {
    chain: chainConfig.name,
    chainId: chainConfig.id,
    status: readiness.status,
    candidateLegacyCommitments: readiness.candidateLegacyCommitments,
    expectedLegacyCommitments: readiness.expectedLegacyCommitments,
    migratedCommitments: readiness.migratedCommitments,
    legacyMasterSeedNullifiedCount: readiness.legacyMasterSeedNullifiedCount,
    hasPostMigrationCommitments: readiness.hasPostMigrationCommitments,
    isMigrated: readiness.isMigrated,
    legacySpendableCommitments: readiness.legacySpendableCommitments,
    upgradedSpendableCommitments: readiness.upgradedSpendableCommitments,
    declinedLegacyCommitments: readiness.declinedLegacyCommitments,
    reviewStatusComplete: readiness.reviewStatusComplete,
    requiresMigration: readiness.requiresMigration,
    requiresWebsiteRecovery: readiness.requiresWebsiteRecovery,
    scopes: readiness.scopes,
  };
}

async function loadMigrationStatusForChain(
  chainConfig: ChainConfig,
  mnemonic: string,
  rpcUrl: string | undefined,
  spin: ReturnType<typeof spinner> | undefined,
): Promise<LoadedChainMigration> {
  if (spin) {
    spin.text = `Resolving supported pools on ${chainConfig.name}...`;
  }
  const pools = await listKnownPoolsFromRegistry(chainConfig, rpcUrl);
  if (pools.length === 0) {
    throw new CLIError(
      `No CLI-supported pools are configured for ${chainConfig.name}.`,
      "UNKNOWN",
      "Update the CLI or review this account in the Privacy Pools website instead.",
    );
  }

  if (spin) {
    spin.text = `Loading legacy account view on ${chainConfig.name}...`;
  }
  const dataService = await getDataService(chainConfig, pools[0].pool, rpcUrl);
  const poolInfos = pools.map((pool) =>
    toPoolInfo({
      chainId: chainConfig.id,
      address: pool.pool,
      scope: pool.scope,
      deploymentBlock: pool.deploymentBlock ?? chainConfig.startBlock,
    }),
  );

  const result = await withSuppressedSdkStdout(async () =>
    AccountService.initializeWithEvents(dataService, { mnemonic }, poolInfos),
  );

  const initErrors = result.errors ?? [];
  if (initErrors.length > 0) {
    throw new CLIError(
      `Failed to load legacy migration readiness on ${chainConfig.name} for ${initErrors.length} pool(s). ${summarizeInitErrors(initErrors)}`,
      "RPC",
      "Check your RPC connectivity and retry.",
      "RPC_ERROR",
      true,
    );
  }

  return {
    chainConfig,
    readiness: await buildMigrationChainReadinessFromLegacyAccount(
      result.legacyAccount,
      chainConfig.id,
    ),
  };
}

export async function handleMigrateStatusCommand(
  opts: MigrateStatusCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isVerbose = globalOpts?.verbose ?? false;
  const outCtx = createOutputContext(mode, isVerbose);
  const silent = isSilent(outCtx);
  let spin: ReturnType<typeof spinner> | undefined;

  try {
    const config = loadConfig();
    const explicitChain = globalOpts?.chain;
    const useMultiChain = opts.allChains || !explicitChain;

    if (useMultiChain && globalOpts?.rpcUrl) {
      throw new CLIError(
        "--rpc-url cannot be combined with multi-chain migrate status queries.",
        "INPUT",
        "Use --chain <name> to target a single chain with --rpc-url.",
      );
    }

    const chainsToQuery = opts.allChains
      ? getAllChainsWithOverrides()
      : explicitChain
        ? [resolveChain(explicitChain, config.defaultChain)]
        : getDefaultReadOnlyChains();

    const rootChain = explicitChain
      ? chainsToQuery[0].name
      : opts.allChains
        ? MULTI_CHAIN_SCOPE_ALL_CHAINS
        : MULTI_CHAIN_SCOPE_ALL_MAINNETS;
    const queriedChains = useMultiChain
      ? chainsToQuery.map((chain) => chain.name)
      : undefined;
    const mnemonic = loadMnemonic();

    spin = spinner(
      useMultiChain
        ? formatMigrationLoadingText(opts.allChains)
        : `Checking legacy migration readiness on ${chainsToQuery[0].name}...`,
      silent,
    );
    spin.start();

    const chainReadiness: MigrationChainRenderData[] = [];
    const warnings: MigrationWarning[] = [];
    let firstError: unknown;

    if (useMultiChain && chainsToQuery.length > 1) {
      const totalChains = chainsToQuery.length;
      let completedChains = 0;
      let showAggregateProgress = false;
      const updateAggregateProgress = () => {
        if (!showAggregateProgress || silent || !spin) return;
        spin.text = formatMigrationLoadingText(
          opts.allChains,
          completedChains,
          totalChains,
        );
      };
      const progressTimer = setTimeout(() => {
        showAggregateProgress = true;
        updateAggregateProgress();
      }, 3000);

      type ChainLoadOutcome =
        | { chainConfig: ChainConfig; loaded: LoadedChainMigration }
        | { chainConfig: ChainConfig; error: unknown };

      let outcomes: ChainLoadOutcome[] = [];
      try {
        outcomes = await Promise.all(
          chainsToQuery.map(async (chainConfig) => {
            try {
              const loaded = await loadMigrationStatusForChain(
                chainConfig,
                mnemonic,
                globalOpts?.rpcUrl,
                undefined,
              );
              return { chainConfig, loaded };
            } catch (error) {
              return { chainConfig, error };
            } finally {
              completedChains += 1;
              updateAggregateProgress();
            }
          }),
        );
      } finally {
        clearTimeout(progressTimer);
      }

      for (const outcome of outcomes) {
        if ("error" in outcome) {
          if (firstError === undefined) firstError = outcome.error;
          const classified = classifyError(outcome.error);
          warnings.push({
            chain: outcome.chainConfig.name,
            category: classified.category,
            message: classified.message,
          });
          continue;
        }

        const renderReadiness = toRenderReadiness(
          outcome.loaded.chainConfig,
          outcome.loaded.readiness,
        );
        chainReadiness.push(renderReadiness);
        if (!renderReadiness.reviewStatusComplete) {
          warnings.push({
            chain: renderReadiness.chain,
            category: "ASP",
            message: formatIncompleteMigrationReviewWarning(renderReadiness.chain),
          });
        }
      }
    } else {
      for (const chainConfig of chainsToQuery) {
        try {
          const loaded = await loadMigrationStatusForChain(
            chainConfig,
            mnemonic,
            globalOpts?.rpcUrl,
            spin,
          );
          const renderReadiness = toRenderReadiness(
            loaded.chainConfig,
            loaded.readiness,
          );
          chainReadiness.push(renderReadiness);
          if (!renderReadiness.reviewStatusComplete) {
            warnings.push({
              chain: renderReadiness.chain,
              category: "ASP",
              message: formatIncompleteMigrationReviewWarning(renderReadiness.chain),
            });
          }
        } catch (error) {
          if (firstError === undefined) firstError = error;
          break;
        }
      }
    }

    if (chainReadiness.length === 0) {
      throw (firstError ?? new CLIError(
        "Could not determine migration readiness on any chain.",
        "RPC",
        "Check your RPC and ASP connectivity, then retry.",
        "RPC_ERROR",
        true,
      ));
    }

    chainReadiness.sort((a, b) => a.chainId - b.chainId);
    warnings.push(createCoverageLimitationWarning(rootChain));
    const summary = summarizeMigrationStatusState(chainReadiness);

    const renderData: MigrationRenderData = {
      mode: "migration-status",
      chain: rootChain,
      ...(opts.allChains ? { allChains: true } : {}),
      ...(queriedChains ? { chains: queriedChains } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      status: normalizeTopLevelMigrationStatus(chainReadiness),
      requiresMigration: summary.requiresMigration,
      requiresWebsiteRecovery: summary.requiresWebsiteRecovery,
      isFullyMigrated: summary.isFullyMigrated,
      readinessResolved: summary.readinessResolved,
      submissionSupported: false,
      requiredChainIds: summary.requiredChainIds,
      migratedChainIds: summary.migratedChainIds,
      missingChainIds: summary.missingChainIds,
      websiteRecoveryChainIds: summary.websiteRecoveryChainIds,
      unresolvedChainIds: summary.unresolvedChainIds,
      chainReadiness,
    };

    spin.stop();
    spin = undefined;
    renderMigrationStatus(outCtx, renderData);
  } catch (error) {
    spin?.stop();
    printError(error, mode.isJson);
  }
}
