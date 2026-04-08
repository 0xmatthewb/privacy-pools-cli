import chalk from "chalk";
import { formatAddress } from "../utils/format.js";
import { accent, accentBold } from "../utils/theme.js";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionHeading,
} from "./layout.js";

interface WorkflowWalletBackupBaseData {
  walletAddress: string;
  backupPath?: string | null;
  privateKey?: string | null;
}

function formatWorkflowWalletHeading(title: string): string {
  return `\n${accentBold(title)}\n${chalk.dim("─".repeat(44))}\n`;
}

function formatWorkflowWalletSummary(
  data: WorkflowWalletBackupBaseData,
  options: {
    backupMode?: string;
    backupPathLabel?: string;
  } = {},
): string {
  const rows = [
    { label: "Wallet", value: formatAddress(data.walletAddress) },
    ...(options.backupMode
      ? [{ label: "Backup mode", value: options.backupMode }]
      : []),
    ...(data.backupPath
      ? [{ label: options.backupPathLabel ?? "Backup file", value: data.backupPath }]
      : []),
  ];

  return `${formatSectionHeading("Summary", {
    divider: true,
    padTop: false,
  })}${formatKeyValueRows(rows)}`;
}

function formatWorkflowWalletPrivateKey(privateKey: string): string {
  return `${formatSectionHeading("Recovery key", {
    divider: true,
    padTop: false,
  })}  ${accent(privateKey)}\n`;
}

export function renderWorkflowWalletBackupChoicePreview(
  data: WorkflowWalletBackupBaseData,
): string {
  return `${formatWorkflowWalletHeading("Workflow wallet backup")}${formatWorkflowWalletSummary(
    data,
    { backupMode: "Choose a backup method" },
  )}${formatCallout("recovery", [
    "Back up this generated wallet before funding it.",
    "If the workflow stalls or needs public recovery later, this key is how you regain control of the funds.",
  ])}${formatSectionHeading("Choose backup", {
    divider: true,
    padTop: false,
  })}  Save to file (recommended)\n  I'll back it up manually\n`;
}

export function renderWorkflowWalletBackupSaved(
  data: WorkflowWalletBackupBaseData & { backupPath: string },
): string {
  return `${formatWorkflowWalletHeading("Workflow wallet backup")}${formatWorkflowWalletSummary(
    data,
    { backupMode: "Saved to file" },
  )}${formatCallout("success", [
    `Backup written to ${data.backupPath}.`,
  ])}${formatCallout("danger", [
    "That file contains a live recovery key.",
    "Anyone with that key can move workflow funds. Store it securely before continuing.",
  ])}`;
}

export function renderWorkflowWalletBackupManual(
  data: WorkflowWalletBackupBaseData & { privateKey: string },
): string {
  return `${formatWorkflowWalletHeading("Workflow wallet backup")}${formatWorkflowWalletSummary(
    data,
    { backupMode: "Manual copy" },
  )}${formatCallout("recovery", [
    "This key controls the dedicated workflow wallet.",
    "You will need it to recover funds if the workflow cannot finish privately.",
  ])}${formatWorkflowWalletPrivateKey(data.privateKey)}${formatCallout("danger", [
    "This is a live recovery key.",
    "Copy it somewhere secure now. Losing it can strand any funds left in the workflow wallet.",
  ])}`;
}

export function renderWorkflowWalletBackupConfirmation(
  data: WorkflowWalletBackupBaseData,
): string {
  return `${formatWorkflowWalletHeading("Confirm workflow wallet backup")}${formatWorkflowWalletSummary(
    data,
    {
      backupMode: data.backupPath ? "Saved to file" : "Manual copy",
      backupPathLabel: "Confirmed backup",
    },
  )}${formatCallout("danger", [
    "Do not continue unless this recovery key is stored somewhere you trust.",
    "Once the flow is funded, this wallet may be your only recovery path for leftover funds or public recovery.",
  ])}`;
}
