import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Command, Option } from "commander";
import { confirm, input, password, select } from "@inquirer/prompts";
import chalk from "chalk";
import {
  ensureConfigDir,
  configExists,
  mnemonicExists,
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
  loadSignerKey,
  loadConfig,
} from "../services/config.js";
import {
  generateMnemonic,
  validateMnemonic,
} from "../services/wallet.js";

import { CHAIN_NAMES, CHAINS, MAINNET_CHAIN_NAMES, TESTNET_CHAIN_NAMES } from "../config/chains.js";
import { Separator } from "@inquirer/select";
import { success, warn, spinner, info } from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderInitResult } from "../output/init.js";

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize wallet and configuration")
    .option("--mnemonic <phrase>", "Import an existing recovery phrase (unsafe: visible in process list)")
    .option("--mnemonic-file <path>", "Import an existing recovery phrase from a file")
    .option(
      "--show-mnemonic",
      "Include generated mnemonic in JSON output (unsafe: may be logged or piped)"
    )
    .option("--private-key <key>", "Set the signer private key (unsafe: visible in process list)")
    .option("--private-key-file <path>", "Set the signer private key from a file")
    .option("--default-chain <chain>", "Set default chain")
    .option("--rpc-url <url>", "Set RPC URL for the default chain")
    .option("--force", "Overwrite existing configuration without prompting")
    .addOption(new Option("--skip-circuits", "No-op (circuits are downloaded on first use)").hideHelp())
    .addHelpText(
      "after",
      "\nPrivacy Pools uses two keys:"
        + "\n  Recovery phrase  — keeps your deposits private (generated during init)"
        + "\n  Wallet key       — pays gas and sends transactions (can be set later)"
        + "\n  These are independent. Set the wallet key via PRIVACY_POOLS_PRIVATE_KEY env var."
        + "\n\nExamples:\n  privacy-pools init\n  privacy-pools init --yes --default-chain sepolia\n  privacy-pools init --force --yes --default-chain sepolia\n  privacy-pools init --json --show-mnemonic\n  privacy-pools init --mnemonic \"word ...\" --private-key 0x...\n"
        + commandHelpText({
          jsonFields:
            "{ defaultChain, signerKeySet, mnemonicRedacted?, mnemonic? (only with --show-mnemonic) }",
        })
    )
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;
      const silent = isQuiet || isJson;
      const skipPrompts = mode.skipPrompts;

      try {
        // ── Phase 1: Eager validation (before any disk writes) ──────────

        // Validate --mnemonic / --mnemonic-file mutual exclusion
        if (opts.mnemonic && opts.mnemonicFile) {
          throw new CLIError(
            "Cannot specify both --mnemonic and --mnemonic-file.",
            "INPUT",
            "Use one or the other, not both."
          );
        }

        // Validate --private-key / --private-key-file mutual exclusion
        if (opts.privateKey && opts.privateKeyFile) {
          throw new CLIError(
            "Cannot specify both --private-key and --private-key-file.",
            "INPUT",
            "Use one or the other, not both."
          );
        }

        // Validate --default-chain early (before any secrets are written)
        if (opts.defaultChain && !CHAINS[opts.defaultChain.toLowerCase()]) {
          throw new CLIError(
            `Unknown chain: ${opts.defaultChain}`,
            "INPUT",
            `Available chains: ${CHAIN_NAMES.join(", ")}`
          );
        }

        // Read and validate mnemonic source if provided via flag
        let mnemonicSource: string | undefined;
        if (opts.mnemonicFile) {
          try {
            mnemonicSource = readFileSync(opts.mnemonicFile, "utf-8").trim();
          } catch (err) {
            throw new CLIError(
              `Could not read mnemonic file: ${opts.mnemonicFile}`,
              "INPUT",
              err instanceof Error ? err.message : undefined
            );
          }
        } else if (opts.mnemonic) {
          mnemonicSource = opts.mnemonic;
        }

        if (mnemonicSource && !validateMnemonic(mnemonicSource)) {
          throw new CLIError(
            "Invalid recovery phrase.",
            "INPUT",
            "Provide a valid recovery phrase (12 or 24 words)."
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
              err instanceof Error ? err.message : undefined
            );
          }
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
              "Private key must be 64 hex characters (with or without 0x prefix)."
            );
          }
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
            "Re-run with --force to replace existing config and recovery phrase."
          );
        }

        if (hasExisting && !forceOverwrite && !skipPrompts) {
          const overwrite = await confirm({
            message: "Existing configuration found. Reinitializing will generate a new recovery phrase and overwrite settings. Continue?",
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

        if (mnemonicSource) {
          if (opts.mnemonic && !silent) {
            process.stderr.write(
              chalk.yellow("Warning: --mnemonic is visible in process list and shell history. Prefer --mnemonic-file or stdin.\n")
            );
          }
          mnemonic = mnemonicSource;
        } else if (skipPrompts) {
          mnemonic = generateMnemonic();
        } else {
          const action = await select({
            message: "How would you like to set up your wallet?",
            choices: [
              { name: "Generate new recovery phrase", value: "generate" },
              { name: "Import existing recovery phrase", value: "import" },
            ],
          });

          if (action === "import") {
            const phrase = await password({
              message: "Enter your recovery phrase (12 or 24 words):",
              mask: "*",
            });
            if (!validateMnemonic(phrase.trim())) {
              throw new CLIError(
                "Invalid recovery phrase.",
                "INPUT",
                "Provide a valid recovery phrase (12 or 24 words)."
              );
            }
            mnemonic = phrase.trim();
          } else {
            mnemonic = generateMnemonic();
          }
        }

        // Display mnemonic (only this once) — always to stderr to keep stdout clean
        // Skip display if mnemonic was imported (--mnemonic or --mnemonic-file)
        if (!mnemonicSource && !isJson) {
          process.stderr.write("\n");
          process.stderr.write(chalk.bold.yellow("⚠  IMPORTANT: Save your recovery phrase securely!") + "\n");
          process.stderr.write(chalk.bold.yellow("   This is the ONLY time it will be displayed.") + "\n");
          process.stderr.write("\n");
          process.stderr.write(chalk.bold(mnemonic) + "\n");
          process.stderr.write("\n");

          // Offer to save recovery phrase to a file, then confirm backup
          if (!skipPrompts) {
            const saveAction = await select({
              message: "How would you like to back up your recovery phrase?",
              choices: [
                { name: "Save to file (recommended)", value: "file" },
                { name: "I've already copied it", value: "copied" },
              ],
            });

            if (saveAction === "file") {
              const defaultPath = join(homedir(), "privacy-pools-recovery.txt");
              const filePath = await input({
                message: "Save location:",
                default: defaultPath,
              });
              const fileContent = [
                "Privacy Pools Recovery Phrase",
                "",
                `Recovery Phrase:`,
                mnemonic,
                "",
                "IMPORTANT: Keep this file secure. Delete it after transferring to a safe location.",
                "Anyone with this phrase can access your Privacy Pools deposits.",
              ].join("\n");
              writeFileSync(filePath.trim(), fileContent, { mode: 0o600 });
              success(`Recovery phrase saved to ${filePath.trim()}`, silent);
              process.stderr.write(chalk.yellow("  Remember to move this file to a secure location and delete the original.\n"));
            }

            process.stderr.write("\n");
            const confirmed = await confirm({
              message: "I have securely backed up my recovery phrase.",
              default: false,
            });
            if (!confirmed) {
              throw new CLIError(
                "You must confirm that your recovery phrase is backed up.",
                "INPUT",
                "Re-run 'privacy-pools init' when you are ready to save your recovery phrase."
              );
            }
            process.stderr.write("\n");
          }
        } else if (!mnemonicSource && isJson && !isQuiet) {
          if (opts.showMnemonic) {
            process.stderr.write(
              chalk.bold.yellow("⚠  Save your recovery phrase from the JSON output below.") +
              "\n"
            );
          } else {
            process.stderr.write(
              chalk.bold.yellow(
                "⚠  Recovery phrase is redacted from JSON by default. Re-run with --show-mnemonic to print it once."
              ) + "\n"
            );
          }
        }

        // --- Signer Key (interactive prompt if needed) ---
        let signerKey: string | undefined = signerKeySource;

        if (signerKeySource && opts.privateKey && !silent) {
          process.stderr.write(
            chalk.yellow("Warning: --private-key is visible in process list and shell history. Prefer --private-key-file or PRIVACY_POOLS_PRIVATE_KEY env var.\n")
          );
        }

        if (!signerKey && !process.env.PRIVACY_POOLS_PRIVATE_KEY && !skipPrompts) {
          process.stderr.write("\n");
          process.stderr.write(chalk.dim("The wallet key is the private key that pays gas and sends transactions.") + "\n");
          process.stderr.write(chalk.dim("This is separate from your recovery phrase, which keeps your deposits private.") + "\n");
          process.stderr.write(chalk.dim("You can skip this and set it later via PRIVACY_POOLS_PRIVATE_KEY environment variable.") + "\n");
          process.stderr.write("\n");
          const keyInput = await password({
            message: "Wallet private key (0x..., or Enter to skip):",
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
              "Private key must be 64 hex characters (with or without 0x prefix)."
            );
          }
        }

        // --- Default Chain (interactive prompt if needed) ---
        let defaultChain = opts.defaultChain;

        if (!defaultChain && !skipPrompts) {
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

        // ── Phase 3: Atomic persistence (all writes together) ───────────

        saveMnemonicToFile(mnemonic);
        if (!isJson) success("Recovery phrase saved.", silent);

        if (normalizedSignerKey) {
          saveSignerKey(normalizedSignerKey);
          if (!isJson) success("Signer key saved.", silent);
        } else if (process.env.PRIVACY_POOLS_PRIVATE_KEY) {
          if (!isJson) info("Using PRIVACY_POOLS_PRIVATE_KEY from environment.", silent);
        } else {
          if (!isJson) warn(
            "No signer key set. You'll need to set PRIVACY_POOLS_PRIVATE_KEY for transactions.",
            silent
          );
        }

        const config = loadConfig();
        config.defaultChain = (defaultChain ?? config.defaultChain ?? "mainnet").toLowerCase();

        const rpcUrl = opts.rpcUrl ?? globalOpts?.rpcUrl;
        if (rpcUrl) {
          const chain = CHAINS[config.defaultChain];
          if (chain) {
            config.rpcOverrides[chain.id] = rpcUrl;
          }
        }

        saveConfig(config);
        if (!isJson) success(`Default chain set to ${config.defaultChain}.`, silent);

        const resolvedSignerKey = loadSignerKey();
        const ctx = createOutputContext(mode);

        // Warn agent users about mnemonic capture
        const mnemonicGenerated = !mnemonicSource;
        const mnemonicWarning =
          mnemonicGenerated && isJson && !opts.showMnemonic
            ? "Mnemonic generated but not included in output. Re-run with --show-mnemonic to capture it. Without the mnemonic, deposited funds cannot be recovered."
            : undefined;

        renderInitResult(ctx, {
          defaultChain: config.defaultChain,
          signerKeySet: !!resolvedSignerKey,
          mnemonicImported: !!mnemonicSource,
          showMnemonic: !!opts.showMnemonic,
          mnemonic,
          warning: mnemonicWarning,
        });

      } catch (error) {
        printError(error, isJson);
      }
    });
}
