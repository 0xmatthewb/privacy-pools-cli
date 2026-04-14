import {
  existsSync,
  lstatSync,
  readFileSync,
  unlinkSync,
} from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import { Separator } from "@inquirer/select";
import {
  CHAIN_NAMES,
  CHAINS,
  MAINNET_CHAIN_NAMES,
  TESTNET_CHAIN_NAMES,
} from "../config/chains.js";
import {
  configExists,
  ensureConfigDir,
  getConfigFilePath,
  getMnemonicFilePath,
  getSignerFilePath,
  invalidateConfigCache,
  loadConfig,
  loadSignerKey,
  mnemonicExists,
  writePrivateFileAtomic,
} from "../services/config.js";
import { discoverLoadedAccounts } from "../services/init-discovery.js";
import {
  extractMnemonicFromFileDetailed,
  generateMnemonic,
  validateMnemonic,
} from "../services/wallet.js";
import { stageHeader, info, success, warn, spinner } from "../utils/format.js";
import { createOutputContext } from "../output/common.js";
import {
  renderGeneratedRecoveryPhraseReview,
  renderInitBackupConfirmationReview,
  renderInitBackupMethodReview,
  renderInitBackupPathReview,
  renderInitBackupSaved,
  renderInitConfiguredReview,
  renderInitDryRun,
  renderInitGoalReview,
  renderInitLoadRecoveryReview,
  renderInitOverwriteReview,
  renderInitRecoveryVerificationReview,
  renderInitResult,
  renderInitSignerKeyReview,
} from "../output/init.js";
import {
  ensurePromptInteractionAvailable,
  isPromptCancellationError,
  PROMPT_CANCELLATION_MESSAGE,
} from "../utils/prompt-cancellation.js";
import {
  CLIError,
  printError,
  promptCancelledError,
} from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  maybeRenderPreviewScenario,
  maybeRenderPreviewProgressStep,
  PreviewScenarioRenderedError,
} from "../preview/runtime.js";
import { notice } from "../utils/theme.js";
import type {
  CLIConfig,
  GlobalOptions,
  InitReadiness,
  InitSetupMode,
  RestoreDiscoverySummary,
} from "../types.js";

interface InitCommandOptions {
  recoveryPhrase?: string;
  recoveryPhraseFile?: string;
  recoveryPhraseStdin?: boolean;
  showRecoveryPhrase?: boolean;
  backupFile?: string;
  signerOnly?: boolean;
  // Hidden aliases (backwards compatibility)
  mnemonic?: string;
  mnemonicFile?: string;
  mnemonicStdin?: boolean;
  showMnemonic?: boolean;
  privateKey?: string;
  privateKeyFile?: string;
  privateKeyStdin?: boolean;
  defaultChain?: string;
  rpcUrl?: string;
  force?: boolean;
  dryRun?: boolean;
}

interface InitFileSnapshot {
  path: string;
  existed: boolean;
  content?: string;
}

interface InitPendingWrite {
  path: string;
  content: string;
}

interface ExistingInitState {
  hasConfig: boolean;
  hasRecoveryPhrase: boolean;
  hasSignerKey: boolean;
  signerKeyValid: boolean;
  hasExistingState: boolean;
  existingConfig: CLIConfig | null;
}

type InitWorkflow = "create" | "restore" | "signer_only";

interface InitPlan {
  workflow: InitWorkflow;
  setupMode: InitSetupMode;
  replacingExisting: boolean;
}

const RECOVERY_VERIFICATION_WORDS = [3, 12, 24] as const;

export { createInitCommand } from "../command-shells/init.js";

function buildRecoveryBackupContents(mnemonic: string): string {
  return [
    "Privacy Pools Recovery Phrase",
    "",
    "Recovery Phrase:",
    mnemonic,
    "",
    "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
    "Anyone with this phrase can access your Privacy Pools deposits.",
  ].join("\n");
}

function writeRecoveryBackupFile(filePath: string, content: string): string {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new CLIError(
      "Recovery phrase backup path cannot be empty.",
      "INPUT",
      "Choose a non-empty file path for the recovery phrase backup.",
    );
  }

  const parentDir = dirname(normalizedPath);
  if (!existsSync(parentDir)) {
    throw new CLIError(
      `Recovery phrase backup directory does not exist: ${parentDir}`,
      "INPUT",
      "Choose an existing parent directory for the recovery phrase backup.",
    );
  }

  if (existsSync(normalizedPath)) {
    const existing = lstatSync(normalizedPath);
    if (existing.isSymbolicLink()) {
      throw new CLIError(
        "Recovery phrase backup path cannot be a symlink.",
        "INPUT",
        "Choose a new file path for the recovery phrase backup.",
      );
    }
    throw new CLIError(
      `Recovery phrase backup already exists: ${normalizedPath}`,
      "INPUT",
      "Choose a new file path or remove the existing backup before retrying.",
    );
  }

  try {
    writePrivateFileAtomic(normalizedPath, content);
    return normalizedPath;
  } catch (error) {
    throw new CLIError(
      `Could not write the recovery phrase backup to ${normalizedPath}.`,
      "INPUT",
      error instanceof Error
        ? `Check that the parent directory is writable and retry. Original error: ${error.message}`
        : "Check that the parent directory is writable and retry.",
    );
  }
}

function captureInitFileSnapshot(path: string): InitFileSnapshot {
  if (!existsSync(path)) {
    return { path, existed: false };
  }

  const stats = lstatSync(path);
  if (!stats.isFile()) {
    return { path, existed: true };
  }

  return {
    path,
    existed: true,
    content: readFileSync(path, "utf8"),
  };
}

function restoreInitFileSnapshot(snapshot: InitFileSnapshot): void {
  if (!snapshot.existed) {
    try {
      unlinkSync(snapshot.path);
    } catch {
      // Best effort rollback cleanup only.
    }
    return;
  }

  if (typeof snapshot.content === "string") {
    writePrivateFileAtomic(snapshot.path, snapshot.content);
  }
}

function persistInitFilesAtomically(writes: InitPendingWrite[]): void {
  invalidateConfigCache();
  const snapshots = new Map<string, InitFileSnapshot>(
    writes.map((write) => [write.path, captureInitFileSnapshot(write.path)]),
  );
  const committedPaths: string[] = [];

  try {
    for (const write of writes) {
      writePrivateFileAtomic(write.path, write.content);
      committedPaths.push(write.path);
    }
  } catch (error) {
    for (const path of committedPaths.reverse()) {
      const snapshot = snapshots.get(path);
      if (snapshot) {
        restoreInitFileSnapshot(snapshot);
      }
    }
    throw error;
  }
}

function describeRecoveryPhraseSource(options: {
  phrase?: string;
  phraseFile?: string;
  phraseStdin?: boolean;
  signerOnly?: boolean;
}): string {
  if (options.signerOnly) return "keep existing phrase";
  if (options.phraseFile) return "load from file";
  if (options.phraseStdin) return "load from stdin";
  if (options.phrase) return "load inline";
  return "generate new phrase";
}

function describeSignerKeySource(options: {
  privateKey?: string;
  privateKeyFile?: string;
  privateKeyStdin?: boolean;
}): string {
  if (options.privateKeyFile) return "save from file";
  if (options.privateKeyStdin) return "save from stdin";
  if (options.privateKey) return "save inline";
  if (process.env.PRIVACY_POOLS_PRIVATE_KEY?.trim()) return "use environment only";
  return "prompt or skip";
}

function normalizePrivateKeyOrThrow(privateKey: string): string {
  const normalized = privateKey.startsWith("0x")
    ? privateKey
    : `0x${privateKey}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new CLIError(
      "Invalid private key format.",
      "INPUT",
      "Private key must be 64 hex characters (with or without 0x prefix).",
    );
  }
  return normalized;
}

function normalizeSecretWord(word: string): string {
  return word.trim().toLowerCase();
}

function resolveExistingInitState(
  defaultChainOverride: string | undefined,
): ExistingInitState {
  const hasConfig = configExists();
  const hasRecoveryPhrase = mnemonicExists();
  const hasStoredSignerFile = existsSync(getSignerFilePath());
  const signerKey = loadSignerKey();
  let signerKeyValid = false;

  if (signerKey) {
    try {
      normalizePrivateKeyOrThrow(signerKey);
      signerKeyValid = true;
    } catch {
      signerKeyValid = false;
    }
  }

  const existingConfig = hasConfig ? loadConfig() : null;
  if (defaultChainOverride && !CHAINS[defaultChainOverride.toLowerCase()]) {
    throw new CLIError(
      `Unknown chain: ${defaultChainOverride}`,
      "INPUT",
      `Available chains: ${CHAIN_NAMES.join(", ")}`,
    );
  }

  return {
    hasConfig,
    hasRecoveryPhrase,
    hasSignerKey: Boolean(signerKey),
    signerKeyValid,
    hasExistingState: hasConfig || hasRecoveryPhrase || hasStoredSignerFile,
    existingConfig,
  };
}

function resolveDryRunPlan(params: {
  opts: InitCommandOptions;
  state: ExistingInitState;
  hasMnemonicSource: boolean;
  hasSignerSource: boolean;
}): InitPlan {
  if (params.opts.signerOnly) {
    return {
      workflow: "signer_only",
      setupMode: "signer_only",
      replacingExisting: false,
    };
  }

  if (params.hasMnemonicSource) {
    return {
      workflow: "restore",
      setupMode: params.state.hasExistingState ? "replace" : "restore",
      replacingExisting: params.state.hasExistingState,
    };
  }

  if (
    params.state.hasRecoveryPhrase &&
    !params.state.signerKeyValid &&
    params.hasSignerSource
  ) {
    return {
      workflow: "signer_only",
      setupMode: "signer_only",
      replacingExisting: false,
    };
  }

  return {
    workflow: "create",
    setupMode: params.state.hasExistingState ? "replace" : "create",
    replacingExisting: params.state.hasExistingState,
  };
}

async function promptForWorkflowGoal(
  state: ExistingInitState,
  silent: boolean,
): Promise<InitPlan> {
  if (!state.hasRecoveryPhrase) {
    stageHeader(1, 4, "Choose setup path", silent);
    process.stderr.write(
      renderInitGoalReview({
        hasRecoveryPhrase: false,
        signerKeyReady: state.signerKeyValid,
      }),
    );
  if (await maybeRenderPreviewScenario("init setup mode")) {
      throw new PreviewScenarioRenderedError();
    }
    ensurePromptInteractionAvailable();
    const goal = await select({
      message: "How would you like to get started?",
      choices: [
        {
          name: "Create a new Privacy Pools account",
          value: "create",
        },
        {
          name: "Load an existing Privacy Pools account",
          value: "restore",
        },
      ],
    });

    return {
      workflow: goal as InitWorkflow,
      setupMode: goal === "create" ? "create" : "restore",
      replacingExisting: false,
    };
  }

  if (state.signerKeyValid) {
    stageHeader(1, 2, "Choose setup path", silent);
    process.stderr.write(
      renderInitConfiguredReview({
        defaultChain: state.existingConfig?.defaultChain ?? "mainnet",
        signerKeyReady: true,
      }),
    );
  if (await maybeRenderPreviewScenario("init setup mode")) {
      throw new PreviewScenarioRenderedError();
    }
    ensurePromptInteractionAvailable();
    const configuredGoal = await select({
      message: "What would you like to do?",
      choices: [
        {
          name: "Add or replace the signer key",
          value: "signer_only",
        },
        {
          name: "Load an existing Privacy Pools account",
          value: "restore",
        },
        {
          name: "Create a new Privacy Pools account",
          value: "create",
        },
      ],
    });

    if (configuredGoal === "signer_only") {
      return {
        workflow: "signer_only",
        setupMode: "signer_only",
        replacingExisting: false,
      };
    }

    return {
      workflow: configuredGoal as InitWorkflow,
      setupMode: "replace",
      replacingExisting: true,
    };
  }

  stageHeader(1, 4, "Choose setup path", silent);
  process.stderr.write(
    renderInitGoalReview({
      hasRecoveryPhrase: true,
      signerKeyReady: false,
    }),
  );
  if (await maybeRenderPreviewScenario("init setup mode")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();
  const goal = await select({
    message: "What would you like to do?",
    choices: [
      {
        name: "Add or replace the signer key",
        value: "signer_only",
      },
      {
        name: "Load an existing Privacy Pools account",
        value: "restore",
      },
      {
        name: "Create a new Privacy Pools account",
        value: "create",
      },
    ],
  });

  if (goal === "signer_only") {
    return {
      workflow: "signer_only",
      setupMode: "signer_only",
      replacingExisting: false,
    };
  }

  return {
    workflow: goal as InitWorkflow,
    setupMode: "replace",
    replacingExisting: true,
  };
}

function resolveNonInteractivePlan(params: {
  opts: InitCommandOptions;
  state: ExistingInitState;
  hasMnemonicSource: boolean;
  hasSignerSource: boolean;
  hasEnvironmentSigner: boolean;
}): InitPlan {
  if (params.opts.signerOnly) {
    if (!params.state.hasRecoveryPhrase) {
      throw new CLIError(
        "No recovery phrase is configured yet.",
        "INPUT",
        "Create or load a Privacy Pools account before using --signer-only.",
      );
    }
    if (!params.hasSignerSource && !params.hasEnvironmentSigner) {
      throw new CLIError(
        "The signer-only path needs a signer key source in non-interactive mode.",
        "INPUT",
        "Pass --private-key-file, --private-key-stdin, --private-key, or set PRIVACY_POOLS_PRIVATE_KEY.",
      );
    }
    return {
      workflow: "signer_only",
      setupMode: "signer_only",
      replacingExisting: false,
    };
  }

  if (params.hasMnemonicSource) {
    if (params.state.hasExistingState && !params.opts.force) {
      throw new CLIError(
        "A Privacy Pools account is already configured on this machine. Re-run with --force to replace it.",
        "INPUT",
        "Use --force to replace the current setup, or use --signer-only to change only the signer key.",
      );
    }
    return {
      workflow: "restore",
      setupMode: params.state.hasExistingState ? "replace" : "restore",
      replacingExisting: params.state.hasExistingState,
    };
  }

  if (
    params.state.hasRecoveryPhrase &&
    !params.state.signerKeyValid &&
    (params.hasSignerSource || params.hasEnvironmentSigner)
  ) {
    return {
      workflow: "signer_only",
      setupMode: "signer_only",
      replacingExisting: false,
    };
  }

  if (params.state.hasExistingState && !params.opts.force) {
    if (params.state.hasRecoveryPhrase && !params.state.signerKeyValid) {
      throw new CLIError(
        "This machine already has a Privacy Pools account, but it is still in read-only mode.",
        "INPUT",
        "Use --signer-only with a signer key source to finish setup, or pass --force to replace the current setup.",
      );
    }
    throw new CLIError(
      "Your Privacy Pools account is already set up.",
      "INPUT",
      "Use --signer-only to update the signer key, or re-run with --force to replace the current setup.",
    );
  }

  return {
    workflow: "create",
    setupMode: params.state.hasExistingState ? "replace" : "create",
    replacingExisting: params.state.hasExistingState,
  };
}

async function maybeConfirmReplacement(params: {
  plan: InitPlan;
  state: ExistingInitState;
  forceOverwrite: boolean;
  skipPrompts: boolean;
  silent: boolean;
}): Promise<boolean> {
  if (!params.plan.replacingExisting || !params.state.hasExistingState) {
    return true;
  }

  if (params.forceOverwrite) {
    warn("Replacing the current local setup.", params.silent);
    return true;
  }

  if (params.skipPrompts) {
    throw new CLIError(
      "A Privacy Pools account is already configured on this machine. Re-run with --force to replace it.",
      "INPUT",
      "Use --force to replace the current setup, or use --signer-only to change only the signer key.",
    );
  }

  process.stderr.write("\n");
  process.stderr.write(
    renderInitOverwriteReview(params.plan.workflow === "restore"),
  );
  if (await maybeRenderPreviewScenario("init overwrite prompt")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();
  const confirmed = await confirm({
    message:
      params.plan.workflow === "restore"
        ? "Replace the current local setup by loading this account?"
        : "Replace the current local setup with a new account?",
    default: false,
  });
  if (!confirmed) {
    info("Init cancelled.", params.silent);
    return false;
  }

  return true;
}

async function promptForLoadedRecoveryPhrase(silent: boolean): Promise<string> {
  stageHeader(1, 4, "Load existing account", silent);
  process.stderr.write(renderInitLoadRecoveryReview());
  if (await maybeRenderPreviewScenario("init import recovery prompt")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();
  const phrase = await password({
    message: "Recovery phrase (12 or 24 words):",
    mask: "*",
  });
  const trimmed = phrase.trim();
  if (!validateMnemonic(trimmed)) {
    throw new CLIError(
      "Invalid recovery phrase.",
      "INPUT",
      "Provide a valid recovery phrase (12 or 24 words).",
    );
  }
  return trimmed;
}

async function handleGeneratedRecoveryBackup(params: {
  mnemonic: string;
  skipPrompts: boolean;
  isJson: boolean;
  isQuiet: boolean;
  showPhrase: boolean;
  backupFile?: string;
  silent: boolean;
}): Promise<string | null> {
  let backupFilePath: string | null = null;

  if (!params.isJson) {
    process.stderr.write("\n");
    process.stderr.write(renderGeneratedRecoveryPhraseReview(params.mnemonic));
    process.stderr.write("\n");
  } else if (!params.isQuiet) {
    const guidance = params.showPhrase
      ? "Save your recovery phrase from the JSON output below."
      : params.backupFile
        ? `Recovery phrase will be backed up to ${params.backupFile}. JSON output below will keep it redacted.`
        : "Recovery phrase capture is required in non-interactive mode. Pass --show-recovery-phrase or --backup-file.";
    process.stderr.write(`${chalk.bold(notice(guidance))}\n`);
  }

  if (params.backupFile) {
    backupFilePath = writeRecoveryBackupFile(
      params.backupFile,
      buildRecoveryBackupContents(params.mnemonic),
    );
    if (!params.isJson) {
      process.stderr.write(renderInitBackupSaved(backupFilePath));
      process.stderr.write("\n");
    }
    return backupFilePath;
  }

  if (params.skipPrompts) {
    return null;
  }

  stageHeader(2, 4, "Secure recovery phrase", params.silent);
  process.stderr.write(renderInitBackupMethodReview());
  if (await maybeRenderPreviewScenario("init backup method")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();
  const backupChoice = await select({
    message: "How would you like to back up your recovery phrase?",
    choices: [
      { name: "Save to file (recommended)", value: "file" },
      { name: "I'll back it up manually", value: "manual" },
    ],
  });

  if (backupChoice === "file") {
    const defaultPath = join(homedir(), "privacy-pools-recovery.txt");
    process.stderr.write(renderInitBackupPathReview(defaultPath));
    if (await maybeRenderPreviewScenario("init backup path")) {
      throw new PreviewScenarioRenderedError();
    }
    ensurePromptInteractionAvailable();
    const filePathInput = await input({
      message: "Save location:",
      default: defaultPath,
    });
    backupFilePath = writeRecoveryBackupFile(
      filePathInput,
      buildRecoveryBackupContents(params.mnemonic),
    );
    process.stderr.write(renderInitBackupSaved(backupFilePath));
  }

  process.stderr.write("\n");
  process.stderr.write(
    renderInitBackupConfirmationReview(
      backupChoice === "file" ? "file" : "manual",
      backupFilePath,
    ),
  );
  if (await maybeRenderPreviewScenario("init backup confirm")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();
  const confirmed = await confirm({
    message: "I have securely backed up my recovery phrase.",
    default: false,
  });
  if (!confirmed) {
    throw new CLIError(
      "You must confirm that your recovery phrase is backed up.",
      "INPUT",
      "Re-run 'privacy-pools init' when you are ready to save your recovery phrase.",
    );
  }

  process.stderr.write("\n");
  return backupFilePath;
}

async function verifyGeneratedRecoveryPhrase(
  mnemonic: string,
  silent: boolean,
): Promise<void> {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  process.stderr.write(
    renderInitRecoveryVerificationReview(RECOVERY_VERIFICATION_WORDS),
  );
  if (await maybeRenderPreviewScenario("init recovery verification")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();

  for (const wordNumber of RECOVERY_VERIFICATION_WORDS) {
    const answer = await input({
      message: `Word #${wordNumber}:`,
    });
    if (normalizeSecretWord(answer) !== normalizeSecretWord(words[wordNumber - 1] ?? "")) {
      throw new CLIError(
        "Recovery phrase verification failed.",
        "INPUT",
        "Re-run 'privacy-pools init' and make sure you are checking the saved recovery phrase carefully.",
      );
    }
  }

  info("Recovery phrase verified.", silent);
  process.stderr.write("\n");
}

async function collectSignerKey(params: {
  signerKeySource?: string;
  inlineFlagUsed: boolean;
  hasEnvironmentSigner: boolean;
  required: boolean;
  skipPrompts: boolean;
  silent: boolean;
}): Promise<string | undefined> {
  let signerKey = params.signerKeySource;

  if (signerKey && params.inlineFlagUsed && !params.silent) {
    process.stderr.write(
      notice(
        "Warning: --private-key is visible in process list and shell history. Prefer --private-key-file, --private-key-stdin, or PRIVACY_POOLS_PRIVATE_KEY.\n",
      ),
    );
  }

  if (!signerKey && !params.hasEnvironmentSigner) {
    if (params.skipPrompts) {
      if (params.required) {
        throw new CLIError(
          "A signer key is required to finish this setup path in non-interactive mode.",
          "INPUT",
          "Pass --private-key-file, --private-key-stdin, --private-key, or set PRIVACY_POOLS_PRIVATE_KEY.",
        );
      }
      return undefined;
    }

    process.stderr.write("\n");
    process.stderr.write(
      renderInitSignerKeyReview({ required: params.required }),
    );
    process.stderr.write("\n");
    if (await maybeRenderPreviewScenario("init signer key")) {
      throw new PreviewScenarioRenderedError();
    }
    ensurePromptInteractionAvailable();
    const keyInput = await password({
      message: params.required
        ? "Signer key (private key, 0x...):"
        : "Signer key (private key, 0x..., or Enter to skip):",
      mask: "*",
    });

    if (!keyInput.trim()) {
      if (params.required) {
        throw new CLIError(
          "A signer key is required to finish setup.",
          "INPUT",
          "Provide a signer key now, or cancel and return once you are ready to finish setup.",
        );
      }
      return undefined;
    }

    signerKey = keyInput.trim();
  }

  return signerKey ? normalizePrivateKeyOrThrow(signerKey) : undefined;
}

async function collectDefaultChain(params: {
  opts: InitCommandOptions;
  existingConfig: CLIConfig | null;
  skipPrompts: boolean;
  silent: boolean;
  stage: { step: number; total: number };
}): Promise<string> {
  let defaultChain = (
    params.opts.defaultChain ??
    params.existingConfig?.defaultChain
  )?.toLowerCase();

  if (defaultChain) {
    return defaultChain;
  }

  if (params.skipPrompts) {
    return "mainnet";
  }

  stageHeader(
    params.stage.step,
    params.stage.total,
    "Choose default network",
    params.silent,
  );
  if (await maybeRenderPreviewScenario("init default chain")) {
    throw new PreviewScenarioRenderedError();
  }
  ensurePromptInteractionAvailable();
  defaultChain = await select({
    message: "Which network would you like to use by default?",
    choices: [
      ...MAINNET_CHAIN_NAMES.map((name) => ({ name, value: name })),
      new Separator("── Testnets ──"),
      ...TESTNET_CHAIN_NAMES.map((name) => ({
        name: `${name} (testnet)`,
        value: name,
      })),
    ],
  });

  return defaultChain.toLowerCase();
}

function deriveReadiness(params: {
  setupMode: InitSetupMode;
  signerKeySet: boolean;
  restoreDiscovery?: RestoreDiscoverySummary;
}): InitReadiness {
  if (
    params.restoreDiscovery &&
    (params.restoreDiscovery.status === "degraded" ||
      params.restoreDiscovery.status === "legacy_website_action_required")
  ) {
    return "discovery_required";
  }

  return params.signerKeySet ? "ready" : "read_only";
}

function hasEnvironmentSigner(): boolean {
  return (process.env.PRIVACY_POOLS_PRIVATE_KEY?.trim().length ?? 0) > 0;
}

export async function handleInitCommand(
  opts: InitCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const isJson = mode.isJson;
  const isQuiet = mode.isQuiet;
  const silent = isQuiet || isJson;
  const skipPrompts = mode.skipPrompts;

  try {
    const phrase = opts.recoveryPhrase ?? opts.mnemonic;
    const phraseFile = opts.recoveryPhraseFile ?? opts.mnemonicFile;
    const phraseStdin = opts.recoveryPhraseStdin ?? opts.mnemonicStdin;
    const showPhrase = opts.showRecoveryPhrase ?? opts.showMnemonic;
    const phraseInlineFlag = opts.recoveryPhrase
      ? "--recovery-phrase"
      : opts.mnemonic
        ? "--mnemonic"
        : undefined;

    const mnemonicSourceCount =
      Number(Boolean(phrase)) +
      Number(Boolean(phraseFile)) +
      Number(Boolean(phraseStdin));
    if (mnemonicSourceCount > 1) {
      throw new CLIError(
        "Cannot specify more than one recovery phrase source.",
        "INPUT",
        "Use only one of: --recovery-phrase, --recovery-phrase-file, --recovery-phrase-stdin.",
      );
    }

    const signerKeySourceCount =
      Number(Boolean(opts.privateKey)) +
      Number(Boolean(opts.privateKeyFile)) +
      Number(Boolean(opts.privateKeyStdin));
    if (signerKeySourceCount > 1) {
      throw new CLIError(
        "Cannot specify more than one signer key source.",
        "INPUT",
        "Use only one of: --private-key, --private-key-file, --private-key-stdin.",
      );
    }

    if (phraseStdin && opts.privateKeyStdin) {
      throw new CLIError(
        "Cannot read both recovery phrase and signer key from stdin in one invocation.",
        "INPUT",
        "Use one stdin secret source per run.",
      );
    }

    if (opts.signerOnly && mnemonicSourceCount > 0) {
      throw new CLIError(
        "--signer-only cannot be combined with recovery phrase import flags.",
        "INPUT",
        "Use --signer-only only when you want to keep the current recovery phrase and change the signer key.",
      );
    }

    let mnemonicSource: string | undefined;
    let stdinContent: string | undefined;
    const readStdinUtf8 = (): string => {
      if (stdinContent !== undefined) return stdinContent;
      try {
        stdinContent = readFileSync(0, "utf-8");
      } catch (error) {
        throw new CLIError(
          "Could not read recovery material from stdin.",
          "INPUT",
          error instanceof Error ? error.message : undefined,
        );
      }
      return stdinContent;
    };

    const extractMnemonicOrThrow = (
      content: string,
      sourceLabel: string,
    ): string => {
      const extracted = extractMnemonicFromFileDetailed(content);
      if (!extracted.mnemonic) {
        if (extracted.failure === "multiple_found") {
          throw new CLIError(
            `Multiple valid recovery phrases found in ${sourceLabel}.`,
            "INPUT",
            "Keep exactly one valid BIP-39 recovery phrase (12 or 24 words) in the provided input.",
          );
        }
        throw new CLIError(
          `No valid recovery phrase found in ${sourceLabel}.`,
          "INPUT",
          "Provide exactly one valid BIP-39 recovery phrase (12 or 24 words), either as raw text or inside a Privacy Pools backup.",
        );
      }
      return extracted.mnemonic;
    };

    if (phraseFile) {
      let fileContent: string;
      try {
        fileContent = readFileSync(phraseFile, "utf-8");
      } catch (error) {
        throw new CLIError(
          `Could not read recovery phrase file: ${phraseFile}`,
          "INPUT",
          error instanceof Error ? error.message : undefined,
        );
      }
      mnemonicSource = extractMnemonicOrThrow(fileContent, "file");
    } else if (phraseStdin) {
      mnemonicSource = extractMnemonicOrThrow(readStdinUtf8(), "stdin");
    } else if (phrase) {
      mnemonicSource = phrase;
    }

    if (mnemonicSource && !validateMnemonic(mnemonicSource)) {
      throw new CLIError(
        "Invalid recovery phrase.",
        "INPUT",
        "Provide a valid recovery phrase (12 or 24 words).",
      );
    }

    let signerKeySource: string | undefined;
    if (opts.privateKeyFile) {
      try {
        signerKeySource = readFileSync(opts.privateKeyFile, "utf-8").trim();
      } catch (error) {
        throw new CLIError(
          `Could not read private key file: ${opts.privateKeyFile}`,
          "INPUT",
          error instanceof Error ? error.message : undefined,
        );
      }
    } else if (opts.privateKeyStdin) {
      signerKeySource = readStdinUtf8().trim();
    } else if (opts.privateKey) {
      signerKeySource = opts.privateKey;
    }

    if (signerKeySource) {
      normalizePrivateKeyOrThrow(signerKeySource);
    } else if (opts.privateKeyStdin) {
      throw new CLIError(
        "No private key received on stdin.",
        "INPUT",
        "Pipe exactly one 64-character hex private key into --private-key-stdin.",
      );
    }

    const state = resolveExistingInitState(opts.defaultChain);
    const envSignerPresent = hasEnvironmentSigner();
    const hasMnemonicSource = Boolean(mnemonicSource);
    const hasSignerSource = Boolean(signerKeySource);

    if (
      !hasMnemonicSource &&
      !opts.signerOnly &&
      !skipPrompts &&
      opts.backupFile &&
      state.hasRecoveryPhrase
    ) {
      throw new CLIError(
        "--backup-file only applies when creating a new account.",
        "INPUT",
        "Use --backup-file when generating a new recovery phrase, not when keeping the current account.",
      );
    }

    const dryRunPlan = resolveDryRunPlan({
      opts,
      state,
      hasMnemonicSource,
      hasSignerSource,
    });
    const effectiveDefaultChain = (
      opts.defaultChain ??
      state.existingConfig?.defaultChain ??
      "mainnet"
    ).toLowerCase();

    if (opts.dryRun) {
      const writeTargets = [getConfigFilePath()];
      if (dryRunPlan.workflow !== "signer_only") {
        writeTargets.push(getMnemonicFilePath());
      }
      if (hasSignerSource) {
        writeTargets.push(getSignerFilePath());
      }
      if (dryRunPlan.workflow === "create" && opts.backupFile) {
        writeTargets.push(opts.backupFile);
      }

      const ctx = createOutputContext(mode);
      renderInitDryRun(ctx, {
        operation: "init",
        dryRun: true,
        effectiveChain: effectiveDefaultChain,
        recoveryPhraseSource: describeRecoveryPhraseSource({
          phrase,
          phraseFile,
          phraseStdin,
          signerOnly: dryRunPlan.workflow === "signer_only",
        }),
        signerKeySource: describeSignerKeySource(opts),
        overwriteExisting: dryRunPlan.replacingExisting,
        overwritePromptRequired: dryRunPlan.replacingExisting && !opts.force,
        writeTargets,
      });
      return;
    }

    let plan: InitPlan;
    if (skipPrompts) {
      plan = resolveNonInteractivePlan({
        opts,
        state,
        hasMnemonicSource,
        hasSignerSource,
        hasEnvironmentSigner: envSignerPresent,
      });
    } else if (opts.signerOnly) {
      plan = {
        workflow: "signer_only",
        setupMode: "signer_only",
        replacingExisting: false,
      };
    } else if (hasMnemonicSource) {
      plan = {
        workflow: "restore",
        setupMode: state.hasExistingState ? "replace" : "restore",
        replacingExisting: state.hasExistingState,
      };
    } else if (
      state.hasRecoveryPhrase &&
      !state.signerKeyValid &&
      hasSignerSource
    ) {
      plan = {
        workflow: "signer_only",
        setupMode: "signer_only",
        replacingExisting: false,
      };
    } else {
      plan = await promptForWorkflowGoal(state, silent);
    }

    if (plan.workflow !== "create" && opts.backupFile) {
      throw new CLIError(
        "--backup-file only applies when creating a new account.",
        "INPUT",
        "Use --backup-file when generating a new recovery phrase, not when keeping or loading an existing account.",
      );
    }

    if (plan.workflow === "create" && skipPrompts && !showPhrase && !opts.backupFile) {
      throw new CLIError(
        "Creating a new account in non-interactive mode requires recovery capture.",
        "INPUT",
        "Pass --show-recovery-phrase or --backup-file so the generated recovery phrase is captured before init completes.",
      );
    }

    const shouldContinue = await maybeConfirmReplacement({
      plan,
      state,
      forceOverwrite: opts.force === true,
      skipPrompts,
      silent,
    });
    if (!shouldContinue) {
      return;
    }

    if (state.hasExistingState && plan.replacingExisting && opts.force) {
      warn("Replacing the current local setup.", silent);
    }

    ensureConfigDir();

    let mnemonic: string | undefined;
    let importedMnemonic = false;
    let backupFilePath: string | null = null;

    if (plan.workflow === "restore") {
      if (phraseInlineFlag && !silent) {
        process.stderr.write(
          notice(
            `Warning: ${phraseInlineFlag} is visible in process list and shell history. Prefer --recovery-phrase-file or --recovery-phrase-stdin.\n`,
          ),
        );
      }
      mnemonic =
        mnemonicSource ?? await promptForLoadedRecoveryPhrase(silent);
      importedMnemonic = true;
    } else if (plan.workflow === "create") {
      mnemonic = generateMnemonic();
      importedMnemonic = false;
      backupFilePath = await handleGeneratedRecoveryBackup({
        mnemonic,
        skipPrompts,
        isJson,
        isQuiet,
        showPhrase: Boolean(showPhrase),
        backupFile: opts.backupFile,
        silent,
      });
      if (!skipPrompts) {
        await verifyGeneratedRecoveryPhrase(mnemonic, silent);
      }
    }

    const normalizedSignerKey = await collectSignerKey({
      signerKeySource,
      inlineFlagUsed: Boolean(opts.privateKey),
      hasEnvironmentSigner: envSignerPresent,
      required: plan.workflow === "signer_only",
      skipPrompts,
      silent,
    });

    const defaultChain = await collectDefaultChain({
      opts,
      existingConfig: state.existingConfig,
      skipPrompts,
      silent,
      stage:
        plan.workflow === "signer_only"
          ? { step: 2, total: 2 }
          : plan.workflow === "restore"
            ? { step: 3, total: 4 }
            : { step: 4, total: 4 },
    });

    if (await maybeRenderPreviewScenario("init")) {
      return;
    }

    const config = loadConfig();
    config.defaultChain = defaultChain;

    const rpcUrl = opts.rpcUrl ?? globalOpts?.rpcUrl;
    if (rpcUrl) {
      const chain = CHAINS[config.defaultChain];
      if (chain) {
        config.rpcOverrides[chain.id] = rpcUrl;
      }
    }

    const writes: InitPendingWrite[] = [
      {
        path: getConfigFilePath(),
        content: JSON.stringify(config, null, 2),
      },
    ];

    if (plan.workflow !== "signer_only" && mnemonic) {
      writes.push({
        path: getMnemonicFilePath(),
        content: mnemonic,
      });
    }

    if (normalizedSignerKey) {
      writes.push({
        path: getSignerFilePath(),
        content: normalizedSignerKey,
      });
    }

    persistInitFilesAtomically(writes);

    let restoreDiscovery: RestoreDiscoverySummary | undefined;
    if (plan.workflow === "restore" && mnemonic) {
      stageHeader(4, 4, "Discover existing deposits", silent);
      const discoverySpinner =
        !silent && !isJson
          ? spinner("Checking supported chains for existing deposits...", false)
          : null;

      if (
        !silent &&
        await maybeRenderPreviewProgressStep("init.restore-discovery", {
          stage: {
            step: 4,
            total: 4,
            label: "Discover existing deposits",
          },
          spinnerText: "Checking supported chains for existing deposits...",
          doneText: "Discovery complete.",
        })
      ) {
        return;
      }

      discoverySpinner?.start();
      restoreDiscovery = await discoverLoadedAccounts(mnemonic, {
        defaultChain: config.defaultChain,
        rpcUrl,
        onProgress: (progress) => {
          if (discoverySpinner) {
            discoverySpinner.text =
              `Checking ${progress.currentChain} for existing deposits... (${progress.completedChains + 1}/${progress.totalChains})`;
          }
        },
      });
      discoverySpinner?.succeed("Discovery complete.");
    }

    if (!isJson) {
      if (plan.workflow === "restore") {
        success("Account loaded.", silent);
      } else if (plan.workflow === "create") {
        success("Recovery phrase saved.", silent);
      }

      if (normalizedSignerKey) {
        success("Signer key saved.", silent);
      } else if (envSignerPresent) {
        info("Using PRIVACY_POOLS_PRIVATE_KEY from environment.", silent);
      } else {
        warn(
          "No signer key set. This machine will stay in read-only mode until you finish with 'privacy-pools init --signer-only'.",
          silent,
        );
      }

      success(`Default chain set to ${config.defaultChain}.`, silent);
    }

    const resolvedSignerKey = loadSignerKey();
    const readiness = deriveReadiness({
      setupMode: plan.setupMode,
      signerKeySet: Boolean(resolvedSignerKey),
      restoreDiscovery,
    });
    const mnemonicWarning =
      !importedMnemonic && isJson && !showPhrase && !backupFilePath
        ? "Recovery phrase generated but not included in output. Capture it with --show-recovery-phrase or --backup-file before depositing funds."
        : undefined;

    const ctx = createOutputContext(mode);
    renderInitResult(ctx, {
      setupMode: plan.setupMode,
      readiness,
      defaultChain: config.defaultChain,
      signerKeySet: Boolean(resolvedSignerKey),
      mnemonicImported: importedMnemonic,
      showCompletionTip: !state.hasExistingState && !importedMnemonic,
      showMnemonic: Boolean(showPhrase),
      mnemonic,
      warning: mnemonicWarning,
      backupFilePath,
      restoreDiscovery,
    });
  } catch (error) {
    if (error instanceof PreviewScenarioRenderedError) {
      return;
    }
    if (isPromptCancellationError(error)) {
      if (isJson) {
        printError(promptCancelledError(), true);
      } else {
        info(PROMPT_CANCELLATION_MESSAGE, silent);
        process.exitCode = 0;
      }
      return;
    }
    printError(error, isJson);
  }
}
