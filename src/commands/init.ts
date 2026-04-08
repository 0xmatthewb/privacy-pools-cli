import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import type { Command } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import {
  configExists,
  ensureConfigDir,
  getConfigFilePath,
  invalidateConfigCache,
  getMnemonicFilePath,
  getSignerFilePath,
  loadConfig,
  loadSignerKey,
  mnemonicExists,
  writePrivateFileAtomic,
} from "../services/config.js";
import {
  generateMnemonic,
  validateMnemonic,
  extractMnemonicFromFileDetailed,
} from "../services/wallet.js";

import {
  CHAIN_NAMES,
  CHAINS,
  MAINNET_CHAIN_NAMES,
  TESTNET_CHAIN_NAMES,
} from "../config/chains.js";
import { Separator } from "@inquirer/select";
import { success, warn, info } from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { maybeRenderPreviewScenario } from "../preview/runtime.js";
import { notice } from "../utils/theme.js";
import { createOutputContext } from "../output/common.js";
import {
  renderGeneratedRecoveryPhraseReview,
  renderInitBackupConfirmationReview,
  renderInitBackupMethodReview,
  renderInitBackupPathReview,
  renderInitBackupSaved,
  renderInitOverwriteReview,
  renderInitResult,
} from "../output/init.js";

interface InitCommandOptions {
  recoveryPhrase?: string;
  recoveryPhraseFile?: string;
  recoveryPhraseStdin?: boolean;
  showRecoveryPhrase?: boolean;
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
}

export { createInitCommand } from "../command-shells/init.js";

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

interface InitFileSnapshot {
  path: string;
  existed: boolean;
  content?: string;
}

interface InitPendingWrite {
  path: string;
  content: string;
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
    // ── Coalesce legacy --mnemonic* aliases into --recovery-phrase* ──
    const phrase = opts.recoveryPhrase ?? opts.mnemonic;
    const phraseFile = opts.recoveryPhraseFile ?? opts.mnemonicFile;
    const phraseStdin = opts.recoveryPhraseStdin ?? opts.mnemonicStdin;
    const showPhrase = opts.showRecoveryPhrase ?? opts.showMnemonic;
    // Track which flag name the user actually typed for warning messages
    const phraseInlineFlag = opts.recoveryPhrase ? "--recovery-phrase" : opts.mnemonic ? "--mnemonic" : undefined;

    // ── Phase 1: Eager validation (before any disk writes) ──────────

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

    // Validate --default-chain early (before any secrets are written)
    if (opts.defaultChain && !CHAINS[opts.defaultChain.toLowerCase()]) {
      throw new CLIError(
        `Unknown chain: ${opts.defaultChain}`,
        "INPUT",
        `Available chains: ${CHAIN_NAMES.join(", ")}`,
      );
    }

    // Read and validate mnemonic source if provided via flag
    let mnemonicSource: string | undefined;
    let stdinContent: string | undefined;
    const readStdinUtf8 = (): string => {
      if (stdinContent !== undefined) return stdinContent;
      try {
        stdinContent = readFileSync(0, "utf-8");
      } catch (err) {
        throw new CLIError(
          "Could not read recovery material from stdin.",
          "INPUT",
          err instanceof Error ? err.message : undefined,
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
      } catch (err) {
        throw new CLIError(
          `Could not read recovery phrase file: ${phraseFile}`,
          "INPUT",
          err instanceof Error ? err.message : undefined,
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

    // Read and validate signer key source if provided via flag
    let signerKeySource: string | undefined;
    if (opts.privateKeyFile) {
      try {
        signerKeySource = readFileSync(opts.privateKeyFile, "utf-8").trim();
      } catch (err) {
        throw new CLIError(
          `Could not read private key file: ${opts.privateKeyFile}`,
          "INPUT",
          err instanceof Error ? err.message : undefined,
        );
      }
    } else if (opts.privateKeyStdin) {
      signerKeySource = readStdinUtf8().trim();
    } else if (opts.privateKey) {
      signerKeySource = opts.privateKey;
    }

    if (signerKeySource) {
      const normalized = signerKeySource.startsWith("0x")
        ? signerKeySource
        : `0x${signerKeySource}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new CLIError(
          "Invalid private key format.",
          "INPUT",
          "Private key must be 64 hex characters (with or without 0x prefix).",
        );
      }
    } else if (opts.privateKeyStdin) {
      throw new CLIError(
        "No private key received on stdin.",
        "INPUT",
        "Pipe exactly one 64-character hex private key into --private-key-stdin.",
      );
    }

    // ── Phase 2: Interactive prompts and gathering ──────────────────

    ensureConfigDir();

    // Check for existing configuration or mnemonic
    const hasExisting = configExists() || mnemonicExists();
    const forceOverwrite = opts.force === true;

    if (hasExisting && !forceOverwrite && skipPrompts) {
      throw new CLIError(
        "Your wallet is already set up. To start over, add --force.",
        "INPUT",
        "Re-run with --force to replace existing config and recovery phrase.",
      );
    }

    if (hasExisting && !forceOverwrite && !skipPrompts) {
      process.stderr.write("\n");
      process.stderr.write(renderInitOverwriteReview(Boolean(mnemonicSource)));
      const overwrite = await confirm({
        message:
          `Existing configuration found. Reinitializing will ${mnemonicSource ? "replace your current recovery phrase with the one you provided" : "replace your current recovery phrase"} and overwrite settings. Continue?`,
        default: false,
      });
      if (!overwrite) {
        info("Init cancelled.", silent);
        return;
      }
    } else if (hasExisting && forceOverwrite) {
      warn("Overwriting existing configuration and recovery phrase.", silent);
    }

    // --- Mnemonic ---
    let mnemonic: string;
    let importedMnemonic = Boolean(mnemonicSource);

    if (mnemonicSource) {
      if (phraseInlineFlag && !silent) {
        process.stderr.write(
          notice(
            `Warning: ${phraseInlineFlag} is visible in process list and shell history. Prefer --recovery-phrase-file or --recovery-phrase-stdin.\n`,
          ),
        );
      }
      mnemonic = mnemonicSource;
    } else if (skipPrompts) {
      mnemonic = generateMnemonic();
    } else {
      if (await maybeRenderPreviewScenario("init setup mode")) {
        return;
      }
      const action = await select({
        message: "How would you like to set up your wallet?",
        choices: [
          { name: "Generate new recovery phrase", value: "generate" },
          { name: "Import existing recovery phrase", value: "import" },
        ],
      });

      if (action === "import") {
        if (await maybeRenderPreviewScenario("init import recovery prompt")) {
          return;
        }
        const phrase = await password({
          message: "Enter your recovery phrase (12 or 24 words):",
          mask: "*",
        });
        if (!validateMnemonic(phrase.trim())) {
          throw new CLIError(
            "Invalid recovery phrase.",
            "INPUT",
            "Provide a valid recovery phrase (12 or 24 words).",
          );
        }
        mnemonic = phrase.trim();
        importedMnemonic = true;
      } else {
        mnemonic = generateMnemonic();
        importedMnemonic = false;
      }
    }

    // Display mnemonic (only this once) — always to stderr to keep stdout clean
    // Skip display if mnemonic was imported from any source, including the
    // interactive import path.
    if (!importedMnemonic && !isJson) {
      process.stderr.write("\n");
      process.stderr.write(renderGeneratedRecoveryPhraseReview(mnemonic));
      process.stderr.write("\n");

      // Offer to save recovery phrase to a file, then confirm backup
      if (!skipPrompts) {
        let backupMode: "file" | "manual" = "manual";
        let savedBackupPath: string | null = null;
        process.stderr.write(renderInitBackupMethodReview());
        if (await maybeRenderPreviewScenario("init backup method")) {
          return;
        }
        const saveAction = await select({
          message: "How would you like to back up your recovery phrase?",
          choices: [
            { name: "Save to file (recommended)", value: "file" },
            { name: "I'll back it up manually", value: "copied" },
          ],
        });
        backupMode = saveAction === "file" ? "file" : "manual";

        if (saveAction === "file") {
          const defaultPath = join(homedir(), "privacy-pools-recovery.txt");
          process.stderr.write(
            renderInitBackupPathReview(defaultPath),
          );
          if (await maybeRenderPreviewScenario("init backup path")) {
            return;
          }
          const filePathInput = await input({
            message: "Save location:",
            default: defaultPath,
          });
          const filePath = writeRecoveryBackupFile(
            filePathInput,
            [
              "Privacy Pools Recovery Phrase",
              "",
              `Recovery Phrase:`,
              mnemonic,
              "",
              "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
              "Anyone with this phrase can access your Privacy Pools deposits.",
            ].join("\n"),
          );
          savedBackupPath = filePath;
          process.stderr.write(renderInitBackupSaved(filePath));
        } else {
          process.stderr.write(
            renderInitBackupConfirmationReview("manual"),
          );
        }

        process.stderr.write("\n");
        if (backupMode === "file") {
          process.stderr.write(
            renderInitBackupConfirmationReview("file", savedBackupPath),
          );
        }
        if (await maybeRenderPreviewScenario("init backup confirm")) {
          return;
        }
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
      }
    } else if (!importedMnemonic && isJson && !isQuiet) {
      if (showPhrase) {
        process.stderr.write(
          chalk.bold(
            notice("Save your recovery phrase from the JSON output below."),
          ) + "\n",
        );
      } else {
        process.stderr.write(
          chalk.bold(
            notice(
              "Recovery phrase is redacted from JSON by default. Re-run with --show-recovery-phrase to print it once.",
            ),
          ) + "\n",
        );
      }
    }

    // --- Signer Key (interactive prompt if needed) ---
    let signerKey: string | undefined = signerKeySource;

    if (signerKeySource && opts.privateKey && !silent) {
      process.stderr.write(
        notice(
          "Warning: --private-key is visible in process list and shell history. Prefer --private-key-file, --private-key-stdin, or PRIVACY_POOLS_PRIVATE_KEY env var.\n",
        ),
      );
    }

    if (!signerKey && !process.env.PRIVACY_POOLS_PRIVATE_KEY && !skipPrompts) {
      process.stderr.write("\n");
      process.stderr.write(
        chalk.dim(
          "The signer key is the private key that pays gas and sends transactions.",
        ) + "\n",
      );
      process.stderr.write(
        chalk.dim(
          "This is separate from your recovery phrase, which keeps your deposits private.",
        ) + "\n",
      );
      process.stderr.write(
        chalk.dim(
          "You can skip this and set it later via PRIVACY_POOLS_PRIVATE_KEY environment variable.",
        ) + "\n",
      );
      process.stderr.write("\n");
      if (await maybeRenderPreviewScenario("init signer key")) {
        return;
      }
      const keyInput = await password({
        message: "Signer key (private key, 0x..., or Enter to skip):",
        mask: "*",
      });
      if (keyInput.trim()) {
        signerKey = keyInput.trim();
      }
    }

    // Validate interactively-entered signer key
    let normalizedSignerKey: string | undefined;
    if (signerKey) {
      normalizedSignerKey = signerKey.startsWith("0x")
        ? signerKey
        : `0x${signerKey}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedSignerKey)) {
        throw new CLIError(
          "Invalid private key format.",
          "INPUT",
          "Private key must be 64 hex characters (with or without 0x prefix).",
        );
      }
    }

    // --- Default Chain (interactive prompt if needed) ---
    let defaultChain = opts.defaultChain;

    if (!defaultChain && !skipPrompts) {
      if (await maybeRenderPreviewScenario("init default chain")) {
        return;
      }
      defaultChain = await select({
        message: "Which network would you like to use?",
        choices: [
          ...MAINNET_CHAIN_NAMES.map((name) => ({ name, value: name })),
          new Separator("── Testnets ──"),
          ...TESTNET_CHAIN_NAMES.map((name) => ({
            name: `${name} (testnet)`,
            value: name,
          })),
        ],
      });
    }

    if (await maybeRenderPreviewScenario("init")) {
      return;
    }

    // ── Phase 3: Atomic persistence (all writes together) ───────────
    ensureConfigDir();
    const config = loadConfig();
    config.defaultChain = (
      defaultChain ??
      config.defaultChain ??
      "mainnet"
    ).toLowerCase();

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
      {
        path: getMnemonicFilePath(),
        content: mnemonic,
      },
    ];
    if (normalizedSignerKey) {
      writes.push({
        path: getSignerFilePath(),
        content: normalizedSignerKey,
      });
    }

    persistInitFilesAtomically(writes);
    if (!isJson) success(importedMnemonic ? "Recovery phrase imported." : "Recovery phrase saved.", silent);

    if (normalizedSignerKey) {
      if (!isJson) success("Signer key saved.", silent);
    } else if (process.env.PRIVACY_POOLS_PRIVATE_KEY) {
      if (!isJson)
        info("Using PRIVACY_POOLS_PRIVATE_KEY from environment.", silent);
    } else {
      if (!isJson)
        warn(
          "No signer key set. You'll need to set PRIVACY_POOLS_PRIVATE_KEY for transactions.",
          silent,
        );
    }

    if (!isJson)
      success(`Default chain set to ${config.defaultChain}.`, silent);

    const resolvedSignerKey = loadSignerKey();
    const ctx = createOutputContext(mode);

    // Warn agent users about mnemonic capture
    const mnemonicGenerated = !mnemonicSource;
    const mnemonicWarning =
      mnemonicGenerated && isJson && !showPhrase
        ? "Recovery phrase generated but not included in output. Re-run with --show-recovery-phrase to capture it. Without the recovery phrase, deposited funds cannot be recovered."
        : undefined;

    renderInitResult(ctx, {
      defaultChain: config.defaultChain,
      signerKeySet: !!resolvedSignerKey,
      mnemonicImported: !!mnemonicSource,
      showMnemonic: !!showPhrase,
      mnemonic,
      warning: mnemonicWarning,
    });
  } catch (error) {
    printError(error, isJson);
  }
}
