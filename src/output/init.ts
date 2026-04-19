/**
 * Output renderer for the `init` command.
 *
 * Handles final result output plus the review surfaces used during the
 * interactive onboarding flow.
 */

import type {
  InitReadiness,
  InitSetupMode,
  NextActionOptionValue,
  RestoreDiscoverySummary,
} from "../types.js";
import { MAINNET_CHAIN_NAMES, isTestnetChain } from "../config/chains.js";
import { INIT_STAGED_STEP_NAMES } from "../utils/init-staged-steps.js";
import { accent } from "../utils/theme.js";
import { getTerminalColumns } from "../utils/terminal.js";
import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  guardCsvUnsupported,
  info,
  isSilent,
  printJsonSuccess,
  renderNextSteps,
  success,
} from "./common.js";
import { formatCallout, formatKeyValueRows, formatSectionHeading } from "./layout.js";
import { formatReviewSurface } from "./review.js";

export interface InitRenderResult {
  setupMode: InitSetupMode;
  readiness: InitReadiness;
  defaultChain: string;
  signerKeySet: boolean;
  /** True when the configured recovery phrase was loaded rather than generated. */
  mnemonicImported: boolean;
  /** True only for the very first setup on this profile/home. */
  showCompletionTip?: boolean;
  /** True when --show-recovery-phrase was passed. */
  showMnemonic: boolean;
  /** The recovery phrase (included only when showMnemonic && !mnemonicImported). */
  mnemonic?: string;
  /** Warning message to include in JSON output. */
  warning?: string;
  backupFilePath?: string | null;
  restoreDiscovery?: RestoreDiscoverySummary;
}

export interface InitDryRunResult {
  operation: "init";
  dryRun: true;
  effectiveChain: string;
  recoveryPhraseSource: string;
  signerKeySource: string;
  backupCaptureMode: "none" | "stdout" | "file";
  backupFilePath?: string | null;
  backupFileWouldWrite: boolean;
  overwriteExisting: boolean;
  overwritePromptRequired: boolean;
  writeTargets: string[];
}

export function renderInitStage(
  stage: string,
  payload: Record<string, unknown> = {},
): void {
  printJsonSuccess({
    mode: "init-staged",
    operation: "init",
    stage,
    ...payload,
  });
}

function readinessLabel(readiness: InitReadiness): string {
  switch (readiness) {
    case "ready":
      return "ready";
    case "read_only":
      return "read-only";
    case "discovery_required":
      return "discovery required";
  }
}

function setupModeLabel(result: InitRenderResult): string {
  switch (result.setupMode) {
    case "create":
      return "Create new account";
    case "restore":
      return "Load existing account";
    case "signer_only":
      return "Add or replace signer key";
    case "replace":
      return result.mnemonicImported
        ? "Replace setup by loading an account"
        : "Replace setup with a new account";
  }
}

function initSuccessHeadline(result: InitRenderResult): string {
  if (result.setupMode === "signer_only") {
    return "Signer setup updated.";
  }
  if (result.restoreDiscovery) {
    return "Account loaded successfully.";
  }
  if (result.setupMode === "replace") {
    return "Setup replaced.";
  }
  return "Setup complete!";
}

function formatFoundChains(summary: RestoreDiscoverySummary): string {
  const chains = summary.foundAccountChains ?? [];
  if (chains.length === 0) {
    return "supported chains";
  }
  if (chains.length === 1) {
    return chains[0]!;
  }
  return chains.join(", ");
}

function buildAccountsActionOptions(
  chains: readonly string[] | undefined,
  includeAgent: boolean,
): Record<string, NextActionOptionValue> {
  const options: Record<string, NextActionOptionValue> = {};
  if (includeAgent) {
    options.agent = true;
  }

  if (!chains || chains.length === 0) {
    return options;
  }

  const uniqueChains = [...new Set(chains)];
  const mainnetNames = new Set(MAINNET_CHAIN_NAMES);
  const hasTestnetChain = uniqueChains.some((chain) => !mainnetNames.has(chain));

  if (uniqueChains.length === 1 && hasTestnetChain) {
    options.chain = uniqueChains[0]!;
    return options;
  }

  if (hasTestnetChain) {
    options.includeTestnets = true;
  }

  return options;
}

function buildAgentNextActions(result: InitRenderResult) {
  if (result.setupMode === "signer_only") {
    return [
      createNextAction(
        "status",
        "Verify signer readiness and chain health after updating the signer key.",
        "after_init",
        { options: { agent: true, chain: result.defaultChain } },
      ),
    ];
  }

  if (result.restoreDiscovery) {
    switch (result.restoreDiscovery.status) {
      case "deposits_found":
        return [
          createNextAction(
            "accounts",
            "Review the existing deposits that were discovered for this account.",
            "after_restore",
            {
              options: buildAccountsActionOptions(
                result.restoreDiscovery.foundAccountChains,
                true,
              ),
            },
          ),
        ];
      case "no_deposits":
        return [
          createNextAction(
            "pools",
            result.readiness === "ready"
              ? "No supported deposits were found. Browse pools to make your first deposit."
              : "No supported deposits were found. Browse pools in read-only mode until you add a signer key.",
            "after_restore",
            { options: { agent: true } },
          ),
        ];
      case "legacy_website_action_required":
        return [
          createNextAction(
            "migrate status",
            "Some legacy deposits still need website migration or website-based recovery before the CLI can manage them safely.",
            "after_restore",
            { options: { agent: true, includeTestnets: true } },
          ),
        ];
      case "degraded":
        return [
          createNextAction(
            "status",
            "Supported-chain discovery could not finish. Recheck health and retry once connectivity is stable.",
            "after_restore",
            { options: { agent: true, chain: result.defaultChain } },
          ),
        ];
    }
  }

  return [
    createNextAction(
      "status",
      "Verify wallet readiness and chain health before transacting.",
      "after_init",
      { options: { agent: true, chain: result.defaultChain } },
    ),
  ];
}

function buildHumanNextActions(result: InitRenderResult) {
  if (result.setupMode === "signer_only") {
    return [
      createNextAction(
        "status",
        "Confirm readiness after updating the signer key.",
        "after_init",
        { options: { chain: result.defaultChain } },
      ),
    ];
  }

  if (!result.restoreDiscovery) {
    return [];
  }

  switch (result.restoreDiscovery.status) {
    case "deposits_found":
      return [
        createNextAction(
          "accounts",
          "Review the existing deposits that were discovered for this account.",
          "after_restore",
          {
            options: buildAccountsActionOptions(
              result.restoreDiscovery.foundAccountChains,
              false,
            ),
          },
        ),
      ];
    case "no_deposits":
      return [
        createNextAction(
          "pools",
          result.readiness === "ready"
            ? "No supported deposits were found. Browse pools to make your first deposit."
            : "No supported deposits were found. Browse pools in read-only mode until you add a signer key.",
          "after_restore",
        ),
      ];
    case "legacy_website_action_required":
      return [
        createNextAction(
          "migrate status",
          "Review which legacy chains still need website migration or website-based recovery.",
          "after_restore",
          { options: { includeTestnets: true } },
        ),
      ];
    case "degraded":
      return [
        createNextAction(
          "status",
          "Supported-chain discovery could not finish. Recheck health and retry once connectivity is stable.",
          "after_restore",
          { options: { chain: result.defaultChain } },
        ),
      ];
  }
}

export function renderInitConfiguredReview(params: {
  defaultChain: string;
  signerKeyReady: boolean;
}): string {
  return formatReviewSurface({
    title: "Privacy Pools is already set up",
    summaryRows: [
      { label: "Default chain", value: params.defaultChain },
      {
        label: "Signer key",
        value: params.signerKeyReady ? "configured" : "missing or invalid",
        valueTone: params.signerKeyReady ? "success" : "warning",
      },
    ],
    primaryCallout: {
      kind: "read-only",
      lines: params.signerKeyReady
        ? [
            "Choose whether you want to update the signer key or replace the current local setup.",
          ]
        : [
            "This machine already has a Privacy Pools account, but it is not transaction-ready yet.",
            "Use the signer path to finish setup without replacing your recovery phrase.",
          ],
    },
  });
}

export function renderInitGoalReview(params: {
  hasRecoveryPhrase: boolean;
  signerKeyReady: boolean;
}): string {
  return formatReviewSurface({
    title: params.hasRecoveryPhrase ? "Finish setup" : "Set up Privacy Pools",
    summaryRows: [
      {
        label: "Recovery phrase",
        value: params.hasRecoveryPhrase ? "already on this machine" : "not configured yet",
        valueTone: params.hasRecoveryPhrase ? "success" : "warning",
      },
      {
        label: "Signer key",
        value: params.signerKeyReady ? "configured" : "not ready",
        valueTone: params.signerKeyReady ? "success" : "warning",
      },
    ],
    primaryCallout: {
      kind: "recovery",
      lines: params.hasRecoveryPhrase
        ? [
            "Choose what you want to do on this machine.",
            "The recovery phrase restores this Privacy Pools account. The signer key submits transactions and may come from the same wallet or a separate key.",
          ]
        : [
            "Choose whether to create a new Privacy Pools account or load one you already use.",
            "The recovery phrase restores this Privacy Pools account. The signer key submits transactions and may come from the same wallet or a separate key.",
          ],
    },
  });
}

export function renderInitOverwriteReview(importingRecoveryPhrase: boolean): string {
  return formatReviewSurface({
    title: "Replace current setup",
    summaryRows: [
      {
        label: "Current setup",
        value: "will be replaced",
        valueTone: "danger",
      },
      {
        label: "Next account source",
        value: importingRecoveryPhrase ? "Load existing account" : "Create new account",
      },
    ],
    primaryCallout: {
      kind: "danger",
      lines: importingRecoveryPhrase
        ? [
            "This will replace the current local recovery phrase with the one you are loading now.",
            "Continue only if you are sure this machine should switch accounts.",
          ]
        : [
            "This will replace the current local recovery phrase with a brand-new Privacy Pools account.",
            "Continue only if you are sure this machine should switch accounts.",
          ],
    },
  });
}

export function renderInitLoadRecoveryReview(): string {
  return formatReviewSurface({
    title: "Load existing account",
    summaryRows: [
      { label: "Input", value: "Recovery phrase" },
      { label: "What happens next", value: "Restore access and discover deposits" },
    ],
    primaryCallout: {
      kind: "recovery",
      lines: [
        "Import your recovery phrase to restore account access and discover existing deposits.",
        "This does not derive your account from a connected signer wallet.",
      ],
    },
  });
}

export function renderGeneratedRecoveryPhraseReview(mnemonic: string): string {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  const cells = words.map(
    (word, index) => `${String(index + 1).padStart(2, " ")}. ${word}`,
  );
  const cellWidth = cells.reduce((max, cell) => Math.max(max, cell.length), 0) + 4;
  const availableWidth = Math.max(24, getTerminalColumns() - 4);
  const preferredColumns = words.length >= 18 ? 3 : 2;
  const columns =
    preferredColumns * cellWidth <= availableWidth
      ? preferredColumns
      : 2 * cellWidth <= availableWidth
        ? 2
        : 1;
  const rows = Math.ceil(words.length / columns);
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
    "This recovery phrase is the master key to your Privacy Pools account.",
    "The signer key submits transactions and may come from the same wallet or a separate key.",
    "Never share it.",
  ])}${gridLines.join("\n")}\n${formatCallout("danger", [
    "Save this recovery phrase now.",
    "This is the only time the CLI will display it.",
    "Anyone with this phrase can control this Privacy Pools account and withdraw its deposits.",
    "If you copied it digitally, clear your clipboard and any temporary notes after you move it somewhere safe.",
  ])}`;
}

export function renderInitBackupMethodReview(): string {
  return formatReviewSurface({
    title: "Back up recovery phrase",
    summaryRows: [
      { label: "What you are backing up", value: "Recovery phrase" },
      {
        label: "Risk if lost",
        value: "Deposited funds cannot be recovered",
        valueTone: "danger",
      },
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
        "Never share this file.",
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

export function renderInitRecoveryVerificationReview(
  wordNumbers: readonly number[],
): string {
  return formatReviewSurface({
    title: "Verify recovery phrase",
    summaryRows: wordNumbers.map((wordNumber) => ({
      label: `Word #${wordNumber}`,
      value: "required",
    })),
    primaryCallout: {
      kind: "recovery",
      lines: [
        "Confirm a few words from the saved recovery phrase before continuing.",
        "If a word is wrong, your recovery phrase is still valid. This step will ask again so you can retry before setup continues.",
      ],
    },
  });
}

export function renderInitSignerKeyReview(options: {
  required?: boolean;
} = {}): string {
  return formatCallout("read-only", [
    "Your signer key pays gas and submits transactions.",
    "It may come from the same wallet as your recovery phrase or from a separate key you control.",
    options.required
      ? "Add it now so this machine can submit transactions."
      : "You can skip it now and finish later with privacy-pools init --signer-only.",
  ]);
}

export function renderInitDryRun(
  ctx: OutputContext,
  result: InitDryRunResult,
): void {
  guardCsvUnsupported(ctx, "init --dry-run");

  if (ctx.mode.isJson) {
    printJsonSuccess(
      {
        operation: result.operation,
        dryRun: result.dryRun,
        effectiveChain: result.effectiveChain,
        recoveryPhraseSource: result.recoveryPhraseSource,
        signerKeySource: result.signerKeySource,
        backupCaptureMode: result.backupCaptureMode,
        backupFilePath: result.backupFilePath ?? null,
        backupFileWouldWrite: result.backupFileWouldWrite,
        overwriteExisting: result.overwriteExisting,
        overwritePromptRequired: result.overwritePromptRequired,
        writeTargets: result.writeTargets,
      },
      false,
    );
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
        { label: "Backup capture", value: result.backupCaptureMode },
        {
          label: "Backup file",
          value: result.backupFilePath ?? "not requested",
          valueTone: result.backupFileWouldWrite ? "success" : "muted",
        },
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

/**
 * Render the init command final output.
 */
export function renderInitResult(ctx: OutputContext, result: InitRenderResult): void {
  guardCsvUnsupported(ctx, "init");

  const agentNextActions = buildAgentNextActions(result);
  const humanNextActions = buildHumanNextActions(result);

  if (ctx.mode.isJson) {
    const jsonOutput: Record<string, unknown> = appendNextActions(
      {
        setupMode: result.setupMode,
        readiness: result.readiness,
        defaultChain: result.defaultChain,
        signerKeySet: result.signerKeySet,
        mnemonicImported: result.mnemonicImported,
      },
      agentNextActions,
    ) as Record<string, unknown>;

    if (!result.mnemonicImported) {
      if (result.showMnemonic) {
        jsonOutput.recoveryPhrase = result.mnemonic;
      } else {
        jsonOutput.recoveryPhraseRedacted = true;
      }
    }
    if (result.restoreDiscovery) {
      jsonOutput.restoreDiscovery = result.restoreDiscovery;
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
  success(initSuccessHeadline(result), silent);
  if (result.showCompletionTip) {
    info(
      "Tip: Run 'privacy-pools completion --help' to set up shell tab completion.",
      silent,
    );
  }

  if (!silent) {
    process.stderr.write(formatSectionHeading("Summary", { divider: true }));
    process.stderr.write(
      formatKeyValueRows([
        { label: "Setup mode", value: setupModeLabel(result) },
        { label: "Default chain", value: result.defaultChain },
        {
          label: "Signer key",
          value: result.signerKeySet ? "configured" : "not set",
          valueTone: result.signerKeySet ? "success" : "warning",
        },
        {
          label: "Readiness",
          value: readinessLabel(result.readiness),
          valueTone:
            result.readiness === "ready"
              ? "success"
              : result.readiness === "read_only"
                ? "warning"
                : "warning",
        },
      ]),
    );

    if (result.restoreDiscovery) {
      switch (result.restoreDiscovery.status) {
        case "deposits_found":
          process.stderr.write(
            formatCallout(
              result.readiness === "ready" ? "success" : "read-only",
              [
                `Existing deposits found on ${formatFoundChains(result.restoreDiscovery)}.`,
                result.readiness === "ready"
                  ? "This machine is ready to review those deposits immediately."
                  : "This machine can review those deposits now, but it stays in read-only mode until you add a signer key.",
              ],
            ),
          );
          break;
        case "no_deposits":
          process.stderr.write(
            formatCallout(
              result.readiness === "ready" ? "success" : "read-only",
              [
                "No deposits found on CLI-supported discovery chains.",
                result.readiness === "ready"
                  ? "You are ready to make your first deposit."
                  : "You can browse in read-only mode now and add a signer key later with privacy-pools init --signer-only.",
              ],
            ),
          );
          break;
        case "legacy_website_action_required":
          process.stderr.write(
            formatCallout("warning", [
              "Some legacy deposits still need website migration or website-based recovery before the CLI can manage them safely.",
              "Run privacy-pools migrate status --include-testnets to see which supported chains still need website action.",
            ]),
          );
          break;
        case "degraded":
          process.stderr.write(
            formatCallout("warning", [
              "Discovery did not complete. Retry after RPC and 0xBow ASP health are stable. Your account is unchanged.",
            ]),
          );
          break;
      }
    } else if (result.readiness === "read_only") {
      process.stderr.write(
        formatCallout("read-only", [
          "This machine cannot submit transactions yet.",
          "Add a signer key with privacy-pools init --signer-only.",
        ]),
      );
    } else if (result.setupMode === "signer_only") {
      process.stderr.write(
        formatCallout("success", [
          "This machine is ready for deposits and withdrawals.",
        ]),
      );
    }
  }

  if (!isSilent(ctx) && !result.restoreDiscovery && result.setupMode !== "signer_only") {
    const browsePoolsCommand = isTestnetChain(result.defaultChain)
      ? `privacy-pools pools --chain ${result.defaultChain}`
      : "privacy-pools pools";
    process.stderr.write(
      formatSectionHeading("Next steps", { divider: true, tone: "muted" }),
    );

    if (result.readiness === "read_only") {
      process.stderr.write(
        `  1. Finish setup:   ${accent("privacy-pools init --signer-only")}\n` +
        `  2. Browse pools:   ${accent(browsePoolsCommand)}\n` +
        `  3. Read the guide: ${accent("privacy-pools guide quickstart")}\n\n`,
      );
    } else {
      process.stderr.write(
        `  1. Browse pools:    ${accent(browsePoolsCommand)}\n` +
        `  2. Start a flow:    ${accent("privacy-pools flow start <amount> <asset> --to <address>")}\n` +
        `  3. Read the guide:  ${accent("privacy-pools guide quickstart")}\n\n`,
      );
    }
  }

  renderNextSteps(ctx, humanNextActions);
}
