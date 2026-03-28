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

  try {
    const pkg = readCliPackageInfo(import.meta.url);
    let result = await inspectUpgrade(pkg);

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
      result = await performUpgrade(result);
      renderUpgradeResult(ctx, result);
      return;
    }

    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      renderUpgradeResult(ctx, result);
      return;
    }

    const { confirm } = await import("@inquirer/prompts");
    const confirmed = await confirm({
      message:
        `Install privacy-pools-cli ${result.latestVersion} now with npm?`,
      default: true,
    });

    if (!confirmed) {
      renderUpgradeResult(ctx, markUpgradeCancelled(result));
      return;
    }

    result = await performUpgrade(result);
    renderUpgradeResult(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
