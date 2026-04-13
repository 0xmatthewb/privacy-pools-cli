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
  markUpgradeCancelled,
  performUpgrade,
} from "../services/upgrade.js";
import type { GlobalOptions } from "../types.js";
import { printError, promptCancelledError } from "../utils/errors.js";
import { info } from "../utils/format.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
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
      previewResult ?? inspectUpgrade(pkg);
    let result = shouldShowProgress
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

    const performUpgradeWithProgress = async () => {
      if (!shouldShowProgress) {
        return performUpgrade(result);
      }

      const { spinner } = await import("../utils/format.js");
      const spin = spinner("Installing update...", false);
      spin.start();
      try {
        return await performUpgrade(result);
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

    const { confirm } = await import("@inquirer/prompts");
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
    const confirmed = await confirm({
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
