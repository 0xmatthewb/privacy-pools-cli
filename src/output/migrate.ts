import chalk from "chalk";
import type { OutputContext } from "./common.js";
import {
  createNextAction,
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
  printTable,
  warn,
} from "./common.js";
import { accentBold, notice } from "../utils/theme.js";
import type { MigrationChainStatus } from "../services/migration.js";
import { formatCallout, formatKeyValueRows, formatSectionHeading } from "./layout.js";

export interface MigrationWarning {
  chain: string;
  category: string;
  message: string;
}

export interface MigrationChainRenderData {
  chain: string;
  chainId: number;
  status: MigrationChainStatus;
  candidateLegacyCommitments: number;
  expectedLegacyCommitments: number;
  migratedCommitments: number;
  legacyMasterSeedNullifiedCount: number;
  hasPostMigrationCommitments: boolean;
  isMigrated: boolean;
  legacySpendableCommitments: number;
  upgradedSpendableCommitments: number;
  declinedLegacyCommitments: number;
  reviewStatusComplete: boolean;
  requiresMigration: boolean;
  requiresWebsiteRecovery: boolean;
  scopes: string[];
}

export type MigrationStatusSummary =
  | "no_legacy"
  | "migration_required"
  | "fully_migrated"
  | "website_recovery_required"
  | "review_incomplete";

export interface MigrationRenderData {
  mode: "migration-status";
  chain: string;
  allChains?: boolean;
  chains?: string[];
  warnings?: MigrationWarning[];
  status: MigrationStatusSummary;
  requiresMigration: boolean;
  requiresWebsiteRecovery: boolean;
  isFullyMigrated: boolean;
  readinessResolved: boolean;
  submissionSupported: false;
  requiredChainIds: number[];
  migratedChainIds: number[];
  missingChainIds: number[];
  websiteRecoveryChainIds: number[];
  unresolvedChainIds: number[];
  chainReadiness: MigrationChainRenderData[];
}

function statusSummaryLine(status: MigrationStatusSummary): string {
  switch (status) {
    case "migration_required":
      return "Some deposits need to be migrated on at least one chain. Visit privacypools.com to migrate.";
    case "website_recovery_required":
      return "Legacy declined deposits were found. Review the Privacy Pools website for website-based public recovery.";
    case "fully_migrated":
      return "All older deposits have already been migrated. No action needed.";
    case "review_incomplete":
      return "Migration readiness is incomplete because some legacy ASP review data could not be confirmed.";
    case "no_legacy":
      return "No deposits requiring migration were found.";
  }
}

function renderChainStatus(status: MigrationChainStatus): string {
  switch (status) {
    case "migration_required":
      return chalk.yellow("migration required");
    case "partially_migrated":
      return chalk.yellow("partially migrated");
    case "fully_migrated":
      return chalk.green("fully migrated");
    case "website_recovery_required":
      return chalk.red("website recovery");
    case "review_incomplete":
      return chalk.yellow("review incomplete");
    case "no_legacy":
      return chalk.dim("no legacy");
  }
}

function countCell(value: number, known: boolean): string {
  return known ? String(value) : "?";
}

function migrationNextActions(
  result: MigrationRenderData,
): ReturnType<typeof createNextAction>[] {
  if (result.status !== "review_incomplete") {
    return [];
  }

  return [
    createNextAction(
      "migrate status",
      "Retry once legacy ASP review data is available.",
      "after_restore",
      {
        options: {
          agent: true,
          ...(result.allChains ? { includeTestnets: true } : {}),
          ...(!result.allChains && result.chain ? { chain: result.chain } : {}),
        },
      },
    ),
  ];
}

export function renderMigrationStatus(
  ctx: OutputContext,
  result: MigrationRenderData,
): void {
  guardCsvUnsupported(ctx, "migrate status");

  if (ctx.mode.isJson) {
    const nextActions = migrationNextActions(result);
    printJsonSuccess({
      mode: result.mode,
      chain: result.chain,
      ...(result.allChains ? { allChains: true } : {}),
      ...(result.chains ? { chains: result.chains } : {}),
      ...(result.warnings && result.warnings.length > 0
        ? { warnings: result.warnings }
        : {}),
      status: result.status,
      requiresMigration: result.requiresMigration,
      requiresWebsiteRecovery: result.requiresWebsiteRecovery,
      isFullyMigrated: result.isFullyMigrated,
      readinessResolved: result.readinessResolved,
      submissionSupported: result.submissionSupported,
      requiredChainIds: result.requiredChainIds,
      migratedChainIds: result.migratedChainIds,
      missingChainIds: result.missingChainIds,
      websiteRecoveryChainIds: result.websiteRecoveryChainIds,
      unresolvedChainIds: result.unresolvedChainIds,
      chainReadiness: result.chainReadiness,
      nextActions,
    });
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) {
    process.stderr.write(`\n${accentBold("Migration Status")}\n\n`);
  }

  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Status", value: statusSummaryLine(result.status) },
        { label: "Requires migration", value: result.requiresMigration ? "yes" : "no" },
        {
          label: "Website recovery",
          value: result.requiresWebsiteRecovery ? "required" : "not required",
          valueTone: result.requiresWebsiteRecovery ? "warning" as const : "success" as const,
        },
        {
          label: "Readiness resolved",
          value: result.readinessResolved ? "yes" : "no",
          valueTone: result.readinessResolved ? "success" as const : "warning" as const,
        },
      ]),
    );
    process.stderr.write(
      formatCallout(
        "read-only",
        "Read-only check only. The CLI does not submit migrations; use the Privacy Pools website to migrate or recover legacy accounts.",
      ),
    );
  }

  if (result.chainReadiness.length > 0) {
    if (!silent) {
      process.stderr.write(formatSectionHeading("Per-chain readiness", { divider: true }));
    }
    printTable(
      ["Chain", "Status", "Legacy", "Migrated", "Remaining", "Declined"],
      result.chainReadiness.map((entry) => [
        entry.chain,
        renderChainStatus(entry.status),
        countCell(
          entry.expectedLegacyCommitments,
          entry.reviewStatusComplete,
        ),
        String(entry.migratedCommitments),
        countCell(
          entry.legacySpendableCommitments,
          entry.reviewStatusComplete,
        ),
        countCell(
          entry.declinedLegacyCommitments,
          entry.reviewStatusComplete,
        ),
      ]),
    );
  }

  for (const entry of result.chainReadiness) {
    if (entry.scopes.length === 0) continue;
    info(
      `${entry.chain} pools: ${entry.scopes.join(", ")}`,
      silent,
    );
  }

  if (result.warnings && result.warnings.length > 0) {
    if (!silent) {
      process.stderr.write(
        formatCallout(
          "warning",
          result.warnings.map((entry) => `${entry.chain}: ${entry.message}`),
        ),
      );
    }
  }

  if (!result.readinessResolved) {
    if (!silent) {
      process.stderr.write(
        formatCallout(
          "warning",
          "Some legacy ASP review data was unavailable. Review the account in the website before treating this result as final.",
        ),
      );
    }
  }

  if (!silent) {
    process.stderr.write(
      formatCallout(
        "recovery",
        `${notice("Website-only action")}: migrate or recover legacy accounts in privacypools.com, then rerun this command.`,
      ),
    );
  }
}
