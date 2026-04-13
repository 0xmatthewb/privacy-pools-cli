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
import { isTestnetChain } from "../config/chains.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";
import { formatReviewSurface } from "./review.js";

export interface InitRenderResult {
  defaultChain: string;
  signerKeySet: boolean;
  /** True when mnemonic was imported (not generated). */
  mnemonicImported: boolean;
  /** True when --show-mnemonic was passed. */
  showMnemonic: boolean;
  /** The recovery phrase (included only when showMnemonic && !mnemonicImported). */
  mnemonic?: string;
  /** Warning message to include in JSON output (e.g. for agent recovery phrase capture). */
  warning?: string;
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
  return `${formatSectionHeading("Recovery phrase", {
    divider: true,
    padTop: false,
  })}  ${mnemonic}\n${formatCallout("danger", [
    "Save this recovery phrase now.",
    "This is the only time the CLI will display it.",
    "Anyone with this phrase can recover your deposited funds.",
  ])}`;
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

/**
 * Render the init command final output.
 */
export function renderInitResult(ctx: OutputContext, result: InitRenderResult): void {
  guardCsvUnsupported(ctx, "init");

  // Agent path: new wallet → status (verify readiness); restore → migrate status first.
  // Imported website accounts can require legacy migration or website recovery before the
  // CLI can safely restore them, so migrate status is the canonical first check.
  const isTestnet = isTestnetChain(result.defaultChain);
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
    : [
        createNextAction(
          "flow start",
          "Start with the guided workflow for your first deposit and later private withdrawal.",
          "after_init",
          {
            args: ["0.1", "ETH"],
            options: {
              to: "0xRecipient",
              ...(isTestnet ? { chain: result.defaultChain } : {}),
            },
          },
        ),
        createNextAction(
          "pools",
          "Browse available pools if you prefer the manual path before depositing.",
          "after_init",
          isTestnet ? { options: { chain: result.defaultChain } } : undefined,
        ),
      ];

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
    printJsonSuccess(jsonOutput, false);
    return;
  }

  const silent = isSilent(ctx);
  if (!silent) process.stderr.write("\n");
  success("Setup complete!", silent);
  info("Tip: Run 'privacy-pools completion --help' to set up shell tab completion.", silent);
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
  renderNextSteps(ctx, humanNextActions);
}
