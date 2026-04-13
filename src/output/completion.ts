/**
 * Output renderer for the `completion` command.
 *
 * `src/commands/completion.ts` delegates output rendering here.
 */

import chalk from "chalk";
import type { OutputContext } from "./common.js";
import { printJsonSuccess, isSilent, guardCsvUnsupported } from "./common.js";
import { formatReviewSurface } from "./review.js";
import type {
  CompletionInstallPlan,
  CompletionInstallResult,
} from "../utils/completion-install.js";

/**
 * Render completion script output.
 *
 * Note: completion scripts must go to stdout (not stderr) so they can be
 * sourced by the shell. This is the only non-JSON command that writes to
 * stdout in human mode.
 */
export function renderCompletionScript(
  ctx: OutputContext,
  shell: string,
  script: string,
): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "completion-script",
      shell,
      completionScript: script,
    });
    return;
  }

  guardCsvUnsupported(ctx, "completion");
  process.stdout.write(script.endsWith("\n") ? script : `${script}\n`);
  if (process.stderr.isTTY && !isSilent(ctx)) {
    process.stderr.write(
      chalk.dim("# Pipe to your shell config or eval to enable completions.\n"),
    );
  }
}

/**
 * Render completion query results.
 */
export function renderCompletionQuery(
  ctx: OutputContext,
  shell: string,
  cword: number | undefined,
  candidates: string[],
): void {
  if (ctx.mode.isJson) {
    printJsonSuccess({
      mode: "completion-query",
      shell,
      cword,
      candidates,
    });
    return;
  }

  guardCsvUnsupported(ctx, "completion");
  if (candidates.length > 0) {
    process.stdout.write(`${candidates.join("\n")}\n`);
  }
}

function installActionLabel(create: boolean, update: boolean): string {
  if (create) return "create";
  if (update) return "update";
  return "no change";
}

export function renderCompletionInstallReview(
  ctx: OutputContext,
  plan: CompletionInstallPlan,
): void {
  guardCsvUnsupported(ctx, "completion");
  if (isSilent(ctx) || !process.stderr.isTTY) {
    return;
  }

  process.stderr.write(
    formatReviewSurface({
      title: "Completion install review",
      summaryRows: [
        { label: "Shell", value: plan.shell },
        { label: "Managed script", value: plan.scriptPath },
        {
          label: "Script action",
          value: installActionLabel(plan.scriptWillCreate, plan.scriptWillUpdate),
        },
        {
          label: "Shell profile",
          value: plan.profilePath ?? "fish auto-load directory",
        },
        {
          label: "Profile action",
          value: plan.profilePath
            ? installActionLabel(plan.profileWillCreate, plan.profileWillUpdate)
            : "not needed",
        },
      ],
      primaryCallout: {
        kind: "recovery",
        lines: [
          "This updates local shell completion files only. Wallet config, recovery phrase data, signer keys, and protocol state are unchanged.",
        ],
      },
    }) + "\n",
  );
}

export function renderCompletionInstallResult(
  ctx: OutputContext,
  result: CompletionInstallResult,
): void {
  if (ctx.mode.isJson) {
    printJsonSuccess(result);
    return;
  }

  guardCsvUnsupported(ctx, "completion");
  if (isSilent(ctx)) {
    return;
  }

  process.stderr.write(
    formatReviewSurface({
      title: "Completion installed",
      summaryRows: [
        { label: "Shell", value: result.shell },
        { label: "Managed script", value: result.scriptPath },
        {
          label: "Script result",
          value: result.scriptCreated
            ? "created"
            : result.scriptUpdated
              ? "updated"
              : "unchanged",
        },
        ...(result.profilePath
          ? [
              { label: "Shell profile", value: result.profilePath },
              {
                label: "Profile result",
                value: result.profileCreated
                  ? "created"
                  : result.profileUpdated
                    ? "updated"
                    : "unchanged",
              },
            ]
          : [{ label: "Shell profile", value: "fish auto-load directory" }]),
        { label: "Reload", value: result.reloadHint },
      ],
      primaryCallout: {
        kind: "success",
        lines: [
          "Completion install is idempotent. Re-running this command updates the managed block instead of duplicating shell config.",
        ],
      },
    }) + "\n",
  );
}
