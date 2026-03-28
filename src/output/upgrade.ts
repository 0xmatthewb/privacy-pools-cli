import type { UpgradeResult } from "../services/upgrade.js";
import { accent } from "../utils/theme.js";
import type { OutputContext } from "./common.js";
import {
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
  success,
  warn,
} from "./common.js";

export type { UpgradeResult } from "../services/upgrade.js";

export function renderUpgradeResult(
  ctx: OutputContext,
  result: UpgradeResult,
): void {
  guardCsvUnsupported(ctx, "upgrade");

  if (ctx.mode.isJson) {
    printJsonSuccess(result);
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
    process.stderr.write("\n");
    return;
  }

  info(
    `Update available: ${result.currentVersion} -> ${result.latestVersion}`,
    ctx.mode.isQuiet,
  );

  if (result.status === "manual") {
    warn(
      "Automatic upgrade is not available from this install context.",
      ctx.mode.isQuiet,
    );
    process.stderr.write(`${result.installContext.reason}\n`);
    if (result.command) {
      process.stderr.write(`Run manually:\n  ${accent(result.command)}\n`);
    }
    process.stderr.write("\n");
    return;
  }

  if (result.status === "ready") {
    info(result.installContext.reason, ctx.mode.isQuiet);
    process.stderr.write(
      `Run ${accent("privacy-pools upgrade --yes")} to install automatically, or run:\n`,
    );
    if (result.command) {
      process.stderr.write(`  ${accent(result.command)}\n`);
    }
    process.stderr.write("\n");
    return;
  }

  if (result.status === "cancelled") {
    warn("Upgrade cancelled. No changes were made.", ctx.mode.isQuiet);
    if (result.command) {
      process.stderr.write(`Install later with:\n  ${accent(result.command)}\n`);
    }
    process.stderr.write("\n");
    return;
  }

  success(
    `Upgraded privacy-pools-cli to ${result.installedVersion ?? result.latestVersion}.`,
    ctx.mode.isQuiet,
  );
  info(
    "Re-run privacy-pools to use the updated version.",
    ctx.mode.isQuiet,
  );
  process.stderr.write("\n");
}
