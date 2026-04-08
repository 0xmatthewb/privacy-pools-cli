import type { Command } from "commander";
import { readCliPackageInfo } from "../package-info.js";
import { createOutputContext } from "../output/common.js";
import { renderUpgradeResult } from "../output/upgrade.js";
import {
  inspectUpgrade,
  markUpgradeCancelled,
  performUpgrade,
} from "../services/upgrade.js";
import type { GlobalOptions } from "../types.js";
import { printError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  maybeRenderPreviewProgressStep,
  maybeRenderPreviewScenario,
} from "../preview/runtime.js";

interface UpgradeCommandOptions {
  check?: boolean;
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
              inspectUpgrade(pkg)
            );
          } finally {
            spin.stop();
          }
        })()
      : await inspectUpgrade(pkg);

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
    if (
      await maybeRenderPreviewScenario("upgrade confirm", {
        timing: "after-prompts",
      })
    ) {
      return;
    }
    const confirmed = await confirm({
      message:
        `Install privacy-pools-cli ${result.latestVersion} now with npm?`,
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
    printError(error, mode.isJson);
  }
}
