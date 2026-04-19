import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readCliPackageInfo } from "../package-info.js";
import { createOutputContext } from "../output/common.js";
import {
  formatUpgradeInstallReview,
  renderUpgradeResult,
  renderChangelog,
} from "../output/upgrade.js";
import {
  inspectUpgrade,
  loadBundledReleaseHighlights,
  markUpgradeCancelled,
  performUpgrade,
} from "../services/upgrade.js";
import type { GlobalOptions } from "../types.js";
import { printJsonSuccess } from "../utils/json.js";
import { printError, promptCancelledError } from "../utils/errors.js";
import { info, warn } from "../utils/format.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
import { confirmPrompt } from "../utils/prompts.js";
import {
  PREVIEW_SCENARIO_ENV,
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";
import type { UpgradeResult } from "../services/upgrade.js";

interface UpgradeCommandOptions {
  check?: boolean;
  changelog?: boolean;
}

function handleUpgradeInspectFailure(params: {
  mode: ReturnType<typeof resolveGlobalMode>;
  packageVersion: string;
  error: Error;
}): void {
  const message =
    params.error instanceof Error ? params.error.message : "Upgrade check failed.";
  const hint =
    params.error instanceof Error && "hint" in params.error &&
      typeof (params.error as { hint?: unknown }).hint === "string"
      ? (params.error as { hint: string }).hint
      : "Retry later or check npm connectivity, then rerun privacy-pools upgrade --check.";
  const retryable =
    params.error instanceof Error && "retryable" in params.error &&
      typeof (params.error as { retryable?: unknown }).retryable === "boolean"
      ? (params.error as { retryable: boolean }).retryable
      : true;
  const warning = {
    code: "UPGRADE_CHECK_FAILED",
    message,
    hint,
    retryable,
  };

  if (params.mode.isJson) {
    printJsonSuccess({
      mode: "upgrade",
      status: "manual",
      currentVersion: params.packageVersion,
      latestVersion: null,
      updateAvailable: null,
      performed: false,
      command: null,
      installContext: {
        kind: "unknown",
        supportedAutoRun: false,
        reason: "npm release checks are temporarily unavailable.",
      },
      installedVersion: null,
      warnings: [warning],
    });
    return;
  }

  warn(hint, params.mode.isQuiet);
}

function withBundledReleaseHighlights(
  result: UpgradeResult,
  packageRoot: string,
): UpgradeResult {
  const targetVersion = result.installedVersion ?? result.latestVersion;
  const releaseHighlights = loadBundledReleaseHighlights(packageRoot, targetVersion);
  return releaseHighlights.length > 0
    ? { ...result, releaseHighlights }
    : result;
}

function previewUpgradeInspectResult(
  currentVersion: string,
): UpgradeResult | null {
  if (process.env[PREVIEW_SCENARIO_ENV]?.trim() !== "upgrade-confirm-prompt") {
    return null;
  }

  return {
    mode: "upgrade",
    status: "ready",
    currentVersion,
    latestVersion: "1.8.0",
    updateAvailable: true,
    performed: false,
    command: "npm install -g privacy-pools-cli@1.8.0",
    installContext: {
      kind: "global_npm",
      supportedAutoRun: true,
      reason:
        "Global npm installation detected. Run privacy-pools upgrade --yes to install automatically, or use the manual npm command instead.",
    },
    installedVersion: null,
  };
}

export async function handleUpgradeCommand(
  opts: UpgradeCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode, globalOpts?.verbose ?? false);
  const shouldShowProgress =
    !mode.isQuiet &&
    !mode.isJson &&
    !mode.isCsv;

  try {
    if (await maybeRenderPreviewScenario("upgrade")) {
      return;
    }

    if (opts.changelog) {
      const pkg = readCliPackageInfo(import.meta.url);
      const changelogPath = join(pkg.packageRoot, "CHANGELOG.md");
      const content = existsSync(changelogPath)
        ? readFileSync(changelogPath, "utf-8")
        : null;
      renderChangelog(ctx, content);
      return;
    }

    if (
      await maybeRenderPreviewProgressStep("upgrade.install", {
        spinnerText: "Installing update...",
        doneText: "Upgrade installed.",
      })
    ) {
      return;
    }

    if (
      await maybeRenderPreviewProgressStep("upgrade.check", {
        spinnerText: "Checking for upgrades...",
        doneText: "Upgrade status loaded.",
      })
    ) {
      return;
    }

    const pkg = readCliPackageInfo(import.meta.url);
    const previewResult = previewUpgradeInspectResult(pkg.version);
    const inspectUpgradeWithPreview = async () =>
      withBundledReleaseHighlights(
        previewResult ?? await inspectUpgrade(pkg),
        pkg.packageRoot,
      );
    let result: UpgradeResult;
    try {
      result = shouldShowProgress
        ? await (async () => {
            const [{ spinner }, { withSpinnerProgress }] = await Promise.all([
              import("../utils/format.js"),
              import("../utils/proof-progress.js"),
            ]);
            const spin = spinner("Checking for upgrades...", false);
            spin.start();
            try {
              return await withSpinnerProgress(spin, "Checking for upgrades", () =>
                inspectUpgradeWithPreview()
              );
            } finally {
              spin.stop();
            }
          })()
        : await inspectUpgradeWithPreview();
    } catch (error) {
      handleUpgradeInspectFailure({
        mode,
        packageVersion: pkg.version,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    const performUpgradeWithProgress = async () => {
      if (!shouldShowProgress) {
        return performUpgrade(result);
      }

      const { spinner } = await import("../utils/format.js");
      const spin = spinner("Installing update...", false);
      spin.start();
      try {
        return withBundledReleaseHighlights(
          await performUpgrade(result),
          pkg.packageRoot,
        );
      } finally {
        spin.stop();
      }
    };

    const forceCheckOnly = opts.check === true || !result.updateAvailable;
    const shouldAutoRun =
      result.updateAvailable &&
      result.installContext.supportedAutoRun &&
      globalOpts?.yes === true;
    const isMachineCheckOnly =
      result.updateAvailable &&
      (mode.isJson || mode.isAgent) &&
      globalOpts?.yes !== true;

    if (
      forceCheckOnly ||
      isMachineCheckOnly ||
      !result.installContext.supportedAutoRun
    ) {
      renderUpgradeResult(ctx, result);
      return;
    }

    if (shouldAutoRun) {
      if (
        await maybeRenderPreviewProgressStep("upgrade.install", {
          spinnerText: "Installing update...",
          doneText: "Upgrade installed.",
        })
      ) {
        return;
      }
      result = await performUpgradeWithProgress();
      renderUpgradeResult(ctx, result);
      return;
    }

    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      renderUpgradeResult(ctx, result);
      return;
    }

    process.stderr.write("\n");
    process.stderr.write(formatUpgradeInstallReview(result));
    if (
      await maybeRenderPreviewScenario("upgrade confirm", {
        timing: "after-prompts",
      })
      ) {
      return;
    }
    ensurePromptInteractionAvailable();
    const confirmed = await confirmPrompt({
      message: "Install update now?",
      default: true,
    });

    if (!confirmed) {
      renderUpgradeResult(ctx, markUpgradeCancelled(result));
      return;
    }

    if (
      await maybeRenderPreviewProgressStep("upgrade.install", {
        spinnerText: "Installing update...",
        doneText: "Upgrade installed.",
      })
    ) {
      return;
    }
    result = await performUpgradeWithProgress();
    renderUpgradeResult(ctx, result);
  } catch (error) {
    if (isPromptCancellationError(error)) {
      if (mode.isJson) {
        printError(promptCancelledError(), true);
      } else {
        info(PROMPT_CANCELLATION_MESSAGE, mode.isQuiet);
        process.exitCode = 0;
      }
      return;
    }
    printError(error, mode.isJson);
  }
}
