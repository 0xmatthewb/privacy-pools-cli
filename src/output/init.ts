/**
 * Output renderer for the `init` command.
 *
 * Handles final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */

import type { OutputContext } from "./common.js";
import type { NextActionOptionValue } from "../types.js";
import {
  appendNextActions,
  createNextAction,
  renderNextSteps,
  printJsonSuccess,
  success,
  info,
  warn,
  isSilent,
  guardCsvUnsupported,
} from "./common.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";
import { accent } from "../utils/theme.js";

export interface InitRenderResult {
  defaultChain: string;
  signerKeySet: boolean;
  /** True when mnemonic was imported (not generated). */
  mnemonicImported: boolean;
  /** True only for the very first setup on this profile/home. */
  showCompletionTip?: boolean;
  /** True when --show-mnemonic was passed. */
  showMnemonic: boolean;
  /** The recovery phrase (included only when showMnemonic && !mnemonicImported). */
  mnemonic?: string;
  /** Warning message to include in JSON output (e.g. for agent recovery phrase capture). */
  warning?: string;
  backupFilePath?: string | null;
}

export interface InitDryRunResult {
  operation: "init";
  dryRun: true;
  effectiveChain: string;
  recoveryPhraseSource: string;
  signerKeySource: string;
  overwriteExisting: boolean;
  overwritePromptRequired: boolean;
  writeTargets: string[];
}

export function renderInitOverwriteReview(importingRecoveryPhrase: boolean): string {
  return formatReviewSurface({
    title: "Replace existing wallet setup",
    summaryRows: [
      {
        label: "Current setup",
        value: "will be replaced",
        valueTone: "danger",
      },
      {
        label: "Recovery phrase source",
        value: importingRecoveryPhrase ? "Imported phrase" : "New generated phrase",
      },
    ],
    primaryCallout: {
      kind: "danger",
      lines: importingRecoveryPhrase
        ? [
            "Reinitializing will replace your current recovery phrase with the one you provided and overwrite saved settings.",
          ]
        : [
            "Reinitializing will replace your current recovery phrase and overwrite saved settings.",
          ],
    },
  });
}

export function renderGeneratedRecoveryPhraseReview(mnemonic: string): string {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  const columns = words.length >= 18 ? 3 : 2;
  const rows = Math.ceil(words.length / columns);
  const cells = words.map(
    (word, index) => `${String(index + 1).padStart(2, " ")}. ${word}`,
  );
  const cellWidth = cells.reduce((max, cell) => Math.max(max, cell.length), 0) + 4;
  const gridLines: string[] = [];

  for (let row = 0; row < rows; row++) {
    const rowCells: string[] = [];
    for (let column = 0; column < columns; column++) {
      const index = row + column * rows;
      if (index >= cells.length) continue;
      rowCells.push(cells[index]!.padEnd(cellWidth, " "));
    }
    gridLines.push(`  ${rowCells.join("")}`.trimEnd());
  }

  return `${formatSectionHeading("Recovery phrase", {
    divider: true,
    padTop: false,
  })}${formatCallout("recovery", [
    "Your recovery phrase is the master key to your deposited funds. It is independent of your signer wallet.",
  ])}${gridLines.join("\n")}\n${formatCallout("danger", [
    "Save this recovery phrase now.",
    "This is the only time the CLI will display it.",
    "Anyone with this phrase can recover your deposited funds.",
  ])}`;
}

export function renderInitDryRun(
  ctx: OutputContext,
  result: InitDryRunResult,
): void {
  guardCsvUnsupported(ctx, "init --dry-run");

  if (ctx.mode.isJson) {
    printJsonSuccess({
      operation: result.operation,
      dryRun: result.dryRun,
      effectiveChain: result.effectiveChain,
      recoveryPhraseSource: result.recoveryPhraseSource,
      signerKeySource: result.signerKeySource,
      overwriteExisting: result.overwriteExisting,
      overwritePromptRequired: result.overwritePromptRequired,
      writeTargets: result.writeTargets,
    }, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  info("Dry-run complete. No files were changed.", silent);
  if (silent) return;

  process.stderr.write(
    formatReviewSurface({
      title: "Init dry-run",
      summaryRows: [
        { label: "Effective chain", value: result.effectiveChain },
        { label: "Recovery phrase", value: result.recoveryPhraseSource },
        { label: "Signer key", value: result.signerKeySource },
        {
          label: "Existing setup",
          value: result.overwriteExisting ? "would be replaced" : "fresh setup",
          valueTone: result.overwriteExisting ? "warning" : "success",
        },
        {
          label: "Overwrite prompt",
          value: result.overwritePromptRequired ? "would prompt first" : "not needed",
          valueTone: result.overwritePromptRequired ? "warning" : "muted",
        },
      ],
      primaryCallout: {
        kind: "read-only",
        lines: [
          "This preview does not generate a live recovery phrase or write any files.",
          `Would write: ${result.writeTargets.join(", ")}`,
        ],
      },
    }),
  );
}

export function renderInitBackupMethodReview(): string {
  return formatReviewSurface({
    title: "Back up recovery phrase",
    summaryRows: [
      { label: "What you are backing up", value: "Recovery phrase" },
      { label: "Risk if lost", value: "Deposited funds cannot be recovered", valueTone: "danger" },
    ],
    primaryCallout: {
      kind: "recovery",
      lines: [
        "Choose how you want to secure this phrase before continuing.",
      ],
    },
  });
}

export function renderInitBackupPathReview(defaultPath: string): string {
  return formatReviewSurface({
    title: "Save recovery phrase backup",
    summaryRows: [
      { label: "Default path", value: defaultPath },
      { label: "File contents", value: "Live recovery phrase", valueTone: "warning" },
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        "Anyone who can read this file can recover your deposited funds.",
        "Move it to a secure location and delete the original after transfer.",
      ],
    },
  });
}

export function renderInitBackupSaved(backupPath: string): string {
  return formatReviewSurface({
    title: "Recovery phrase saved",
    summaryRows: [
      { label: "Saved to", value: backupPath },
      { label: "Contains", value: "Live recovery phrase", valueTone: "warning" },
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        "Move this file to a secure location now, then delete the original copy.",
      ],
    },
  });
}

export function renderInitBackupConfirmationReview(
  backupMode: "file" | "manual",
  backupPath?: string | null,
): string {
  return formatReviewSurface({
    title: "Confirm recovery phrase backup",
    summaryRows: [
      {
        label: "Backup mode",
        value: backupMode === "file" ? "Saved to file" : "Manual copy",
      },
      ...(backupMode === "file" && backupPath
        ? [{ label: "Saved to", value: backupPath }]
        : []),
    ],
    primaryCallout: {
      kind: "danger",
      lines: [
        "Do not continue unless this recovery phrase is stored somewhere you trust.",
      ],
    },
  });
}

export function renderInitSignerKeyReview(): string {
  return formatCallout("read-only", [
    "Your signer key pays gas and submits transactions.",
    "It is separate from your recovery phrase, which remains the master key to your deposited funds.",
    "Without a signer key, you can still view accounts and balances.",
    "You can set it now, later via PRIVACY_POOLS_PRIVATE_KEY, or by re-running init.",
  ]);
}

/**
 * Render the init command final output.
 */
export function renderInitResult(ctx: OutputContext, result: InitRenderResult): void {
  guardCsvUnsupported(ctx, "init");

  // Agent path: new wallet → status (verify readiness); restore → migrate status first.
  // Imported website accounts can require legacy migration or website recovery before the
  // CLI can safely restore them, so migrate status is the canonical first check.
  const agentNextActions = result.mnemonicImported
    ? [
        createNextAction(
          "migrate status",
          "You imported a recovery phrase. Check for existing deposits across all chains before transacting.",
          "after_restore",
          { options: { agent: true, allChains: true } },
        ),
      ]
    : [
        createNextAction(
          "status",
          "Verify wallet readiness and chain health before transacting.",
          "after_init",
          { options: { agent: true, chain: result.defaultChain } },
        ),
      ];

  // Differentiate new-wallet vs restore/migration:
  //   New wallet  → "browse pools before depositing" (testnet needs --chain)
  //   Restore     → "check migration readiness first" with --all-chains for broadest coverage
  const humanNextActions = result.mnemonicImported
    ? [
        createNextAction(
          "migrate status",
          "You imported a recovery phrase. Check for existing deposits across all chains before transacting.",
          "after_restore",
          { options: { allChains: true } },
        ),
      ]
    : [];

  if (ctx.mode.isJson) {
    const jsonOutput: Record<string, unknown> = appendNextActions({
      defaultChain: result.defaultChain,
      signerKeySet: result.signerKeySet,
    }, agentNextActions) as Record<string, unknown>;
    if (!result.mnemonicImported) {
      if (result.showMnemonic) {
        jsonOutput.recoveryPhrase = result.mnemonic;
      } else {
        jsonOutput.recoveryPhraseRedacted = true;
      }
    }
    if (result.warning) {
      jsonOutput.warning = result.warning;
    }
    if (result.backupFilePath) {
      jsonOutput.backupFilePath = result.backupFilePath;
    }
    printJsonSuccess(jsonOutput, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Setup complete!", silent);
  if (result.showCompletionTip) {
    info("Tip: Run 'privacy-pools completion --help' to set up shell tab completion.", silent);
  }
  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Default chain", value: result.defaultChain },
        {
          label: "Recovery phrase",
          value: result.mnemonicImported ? "imported" : "generated",
        },
        {
          label: "Signer key",
          value: result.signerKeySet ? "configured" : "not set",
          valueTone: result.signerKeySet ? "success" : "warning",
        },
      ]),
    );
    if (result.mnemonicImported) {
      process.stderr.write(
        formatCallout(
          "recovery",
          "Your signer key pays gas; your recovery phrase is still the only way to recover deposited funds.",
        ),
      );
    } else if (ctx.mode.skipPrompts) {
      process.stderr.write(
        formatCallout(
          "danger",
          "You skipped the backup confirmation step. Make sure your recovery phrase is securely stored before depositing funds.",
        ),
      );
    }
  }
  // Prominent "What's next?" for interactive users who just finished a fresh init (not restore).
  if (!isSilent(ctx) && !ctx.mode.skipPrompts && !result.mnemonicImported) {
    process.stderr.write(formatSectionHeading("What's next?", { divider: true }));
    process.stderr.write(
      `  1. Browse pools:    ${accent("privacy-pools pools")}\n` +
      `  2. Start a flow:    ${accent("privacy-pools flow start <amount> <asset> --to <address>")}\n` +
      `  3. Read the guide:  ${accent("privacy-pools guide quickstart")}\n\n`,
    );
  }
  renderNextSteps(ctx, humanNextActions);
}
