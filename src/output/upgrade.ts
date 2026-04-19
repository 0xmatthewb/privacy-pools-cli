import type { UpgradeResult } from "../services/upgrade.js";
import type { NextAction } from "../types.js";
import { accent } from "../utils/theme.js";
import type { OutputContext } from "./common.js";
import {
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
  success,
  warn,
  createNextAction,
  appendNextActions,
  renderNextSteps,
} from "./common.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";

export type { UpgradeResult } from "../services/upgrade.js";

export function formatUpgradeInstallReview(
  result: Pick<
    UpgradeResult,
    "currentVersion" | "latestVersion" | "installContext" | "command"
  >,
): string {
  return formatReviewSurface({
    title: "Upgrade review",
    summaryRows: [
      { label: "Current version", value: result.currentVersion },
      {
        label: "Install version",
        value: result.latestVersion,
        valueTone: "success",
      },
      {
        label: "Install context",
        value: result.installContext.kind,
      },
      {
        label: "Auto-run",
        value: result.installContext.supportedAutoRun ? "supported" : "manual only",
        valueTone: result.installContext.supportedAutoRun ? "success" : "warning",
      },
    ],
    primaryCallout: {
      kind: "read-only",
      lines: [
        result.installContext.reason,
        "The current process will not hot-restart after install. Re-run privacy-pools once the upgrade finishes.",
      ],
    },
    secondaryCallout: result.command
      ? {
          kind: "warning",
          lines: `Manual fallback: ${accent(result.command)}`,
        }
      : null,
  });
}

export function renderChangelog(
  ctx: OutputContext,
  content: string | null,
): void {
  guardCsvUnsupported(ctx, "upgrade --changelog");

  if (ctx.mode.isJson) {
    printJsonSuccess({
      changelog: content ?? null,
      available: content !== null,
    });
    return;
  }

  if (isSilent(ctx)) return;

  if (!content) {
    warn("CHANGELOG.md not found in the package root.", ctx.mode.isQuiet);
    return;
  }

  process.stdout.write(content);
  if (!content.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

export function renderUpgradeResult(
  ctx: OutputContext,
  result: UpgradeResult,
): void {
  guardCsvUnsupported(ctx, "upgrade");

  let agentNextActions: NextAction[] | undefined;
  let humanNextActions: NextAction[] | undefined;

  if (result.status === "ready") {
    agentNextActions = [
      createNextAction("upgrade", "Install the available update.", "after_upgrade", {
        options: { agent: true, yes: true },
      }),
    ];
    humanNextActions = [
      createNextAction("upgrade", "Install the available update.", "after_upgrade", {
        options: { yes: true },
      }),
    ];
  }
  if (result.status === "up_to_date" || result.status === "upgraded") {
    agentNextActions = [
      createNextAction("status", "Run the standard health check on the active CLI install.", "after_upgrade", {
        options: { agent: true },
      }),
    ];
    humanNextActions = [
      createNextAction("status", "Run the standard health check on the active CLI install.", "after_upgrade"),
    ];
  }
  if (result.status === "cancelled") {
    agentNextActions = [
      createNextAction("upgrade", "Retry the upgrade when you are ready to install the newer release.", "after_upgrade", {
        options: { agent: true, yes: true },
      }),
    ];
    humanNextActions = [
      createNextAction("upgrade", "Retry the upgrade when you are ready to install the newer release.", "after_upgrade", {
        options: { yes: true },
      }),
    ];
  }
  // No nextAction for "manual" status — the remediation is an external
  // install command (in result.command), not a CLI command. Emitting
  // "upgrade" as a nextAction would cause agents to loop.

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      ...result,
      ...(result.status === "manual"
        ? {
            externalGuidance: {
              kind: "manual_install",
              message: result.installContext.reason,
              command: result.command,
            },
          }
        : {}),
    }, agentNextActions));
    return;
  }

  if (isSilent(ctx)) {
    return;
  }

  process.stderr.write("\n");

  if (result.status === "up_to_date") {
    success(
      `privacy-pools-cli is already up to date (${result.currentVersion}).`,
      ctx.mode.isQuiet,
    );
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Current version", value: result.currentVersion },
        { label: "Latest version", value: result.latestVersion },
        { label: "Status", value: "up to date", valueTone: "success" },
      ]),
    );
    process.stderr.write("\n");
    renderNextSteps(ctx, humanNextActions);
    return;
  }

  if (result.status === "upgraded") {
    success(
      `Upgraded privacy-pools-cli to ${result.installedVersion ?? result.latestVersion}.`,
      ctx.mode.isQuiet,
    );
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        {
          label: "Previous version",
          value: result.currentVersion,
        },
        {
          label: "Installed version",
          value: result.installedVersion ?? result.latestVersion,
          valueTone: "success",
        },
        {
          label: "Install context",
          value: result.installContext.kind,
        },
      ]),
    );
    process.stderr.write(
      formatCallout("success", [
        "The update finished successfully.",
        "Re-run privacy-pools to use the updated version.",
      ]),
    );
    if (result.releaseHighlights && result.releaseHighlights.length > 0) {
      process.stderr.write(formatSectionHeading("Release highlights", { divider: true }));
      for (const highlight of result.releaseHighlights) {
        process.stderr.write(`  - ${highlight}\n`);
      }
    }
    renderNextSteps(ctx, humanNextActions);
    process.stderr.write("\n");
    return;
  }

  info(
    `Update available: ${result.currentVersion} -> ${result.latestVersion}`,
    ctx.mode.isQuiet,
  );
  process.stderr.write(formatSectionHeading("Summary", { divider: true }));
  process.stderr.write(
    formatKeyValueRows([
      { label: "Current version", value: result.currentVersion },
      { label: "Latest version", value: result.latestVersion },
      { label: "Install context", value: result.installContext.kind },
      {
        label: "Auto-run",
        value: result.installContext.supportedAutoRun ? "supported" : "manual only",
        valueTone: result.installContext.supportedAutoRun ? "success" : "warning",
      },
    ]),
  );

  if (result.status === "manual") {
    if (result.releaseHighlights && result.releaseHighlights.length > 0) {
      process.stderr.write(formatSectionHeading("Release highlights", { divider: true }));
      for (const highlight of result.releaseHighlights) {
        process.stderr.write(`  - ${highlight}\n`);
      }
    }
    process.stderr.write(
      formatCallout(
        "warning",
        [
          "Automatic upgrade is not available from this install context.",
          result.installContext.reason,
        ],
      ),
    );
    if (result.command) {
      process.stderr.write(formatSectionHeading("Manual command", { divider: true }));
      process.stderr.write(`  ${accent(result.command)}\n`);
    }
    process.stderr.write("\n");
    return;
  }

  if (result.status === "ready") {
    if (result.releaseHighlights && result.releaseHighlights.length > 0) {
      process.stderr.write(formatSectionHeading("Release highlights", { divider: true }));
      for (const highlight of result.releaseHighlights) {
        process.stderr.write(`  - ${highlight}\n`);
      }
    }
    process.stderr.write(
      formatCallout(
        "read-only",
        [
          result.installContext.reason,
          `Run ${accent("privacy-pools upgrade --yes")} to install automatically, or use the manual command below.`,
        ],
      ),
    );
    if (result.command) {
      process.stderr.write(formatSectionHeading("Manual command", { divider: true }));
      process.stderr.write(`  ${accent(result.command)}\n`);
    }
    renderNextSteps(ctx, humanNextActions);
    process.stderr.write("\n");
    return;
  }

  if (result.status === "cancelled") {
    process.stderr.write(
      formatCallout("warning", "Upgrade cancelled. No changes were made."),
    );
    if (result.command) {
      process.stderr.write(formatSectionHeading("Install later", { divider: true }));
      process.stderr.write(`  ${accent(result.command)}\n`);
    }
    renderNextSteps(ctx, humanNextActions);
    process.stderr.write("\n");
    return;
  }
}
