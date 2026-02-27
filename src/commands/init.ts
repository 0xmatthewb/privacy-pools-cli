import { readFileSync } from "fs";
import { Command } from "commander";
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
import { warmCircuits } from "../services/sdk.js";
import { CHAIN_NAMES, CHAINS } from "../config/chains.js";
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
    .option("--mnemonic <phrase>", "Import an existing BIP-39 mnemonic phrase (unsafe: visible in process list)")
    .option("--mnemonic-file <path>", "Import an existing BIP-39 mnemonic from a file")
    .option(
      "--show-mnemonic",
      "Include generated mnemonic in JSON output (unsafe: may be logged or piped)"
    )
    .option("--private-key <key>", "Set the signer private key (unsafe: visible in process list)")
    .option("--private-key-file <path>", "Set the signer private key from a file")
    .option("--default-chain <chain>", "Set default chain")
    .option("--rpc-url <url>", "Set RPC URL for the default chain")
    .option("--force", "Overwrite existing configuration without prompting")
    .option("--skip-circuits", "Skip downloading circuit artifacts")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools init\n  privacy-pools init --yes --default-chain sepolia --skip-circuits\n  privacy-pools init --force --yes --default-chain sepolia --skip-circuits\n  privacy-pools init --json --show-mnemonic --skip-circuits\n  privacy-pools init --mnemonic \"word ...\" --private-key 0x...\n"
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
        ensureConfigDir();

        // Check for existing configuration or mnemonic
        const hasExisting = configExists() || mnemonicExists();
        const forceOverwrite = opts.force === true;

        if (hasExisting && !forceOverwrite && skipPrompts) {
          throw new CLIError(
            "Existing configuration found. Use --force to overwrite.",
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

        if (opts.mnemonic && opts.mnemonicFile) {
          throw new CLIError(
            "Cannot specify both --mnemonic and --mnemonic-file.",
            "INPUT",
            "Use one or the other, not both."
          );
        }

        // Resolve mnemonic from --mnemonic-file, --mnemonic, or generate
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
          if (!silent) {
            process.stderr.write(
              chalk.yellow("Warning: --mnemonic is visible in process list and shell history. Prefer --mnemonic-file or stdin.\n")
            );
          }
          mnemonicSource = opts.mnemonic;
        }

        if (mnemonicSource) {
          if (!validateMnemonic(mnemonicSource)) {
            throw new CLIError(
              "Invalid recovery phrase.",
              "INPUT",
              "Provide a valid BIP-39 recovery phrase (12 or 24 words)."
            );
          }
          mnemonic = mnemonicSource;
        } else if (skipPrompts) {
          mnemonic = generateMnemonic();
        } else {
          const action = await select({
            message: "Wallet setup:",
            choices: [
              { name: "Generate new recovery phrase", value: "generate" },
              { name: "Import existing recovery phrase", value: "import" },
            ],
          });

          if (action === "import") {
            const phrase = await password({
              message: "Enter your BIP-39 recovery phrase:",
              mask: "*",
            });
            if (!validateMnemonic(phrase.trim())) {
              throw new CLIError(
                "Invalid recovery phrase.",
                "INPUT",
                "Provide a valid BIP-39 recovery phrase (12 or 24 words)."
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

          // Verification step: ask user to confirm 3 random words
          if (!skipPrompts) {
            const words = mnemonic.split(" ");
            const indices: number[] = [];
            while (indices.length < 3) {
              const idx = Math.floor(Math.random() * words.length);
              if (!indices.includes(idx)) indices.push(idx);
            }
            indices.sort((a, b) => a - b);

            process.stderr.write(chalk.dim("Verify your backup by entering the requested words:\n\n"));
            for (const idx of indices) {
              const answer = await input({
                message: `Word #${idx + 1}:`,
              });
              if (answer.trim().toLowerCase() !== words[idx].toLowerCase()) {
                throw new CLIError(
                  `Incorrect word #${idx + 1}.`,
                  "INPUT",
                  "Please re-run init and carefully save your recovery phrase."
                );
              }
            }
            success("Recovery phrase verified!", silent);
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

        saveMnemonicToFile(mnemonic);
        if (!isJson) success("Recovery phrase saved.", silent);

        // --- Signer Key ---
        if (opts.privateKey && opts.privateKeyFile) {
          throw new CLIError(
            "Cannot specify both --private-key and --private-key-file.",
            "INPUT",
            "Use one or the other, not both."
          );
        }

        let signerKey: string | undefined;
        if (opts.privateKeyFile) {
          try {
            signerKey = readFileSync(opts.privateKeyFile, "utf-8").trim();
          } catch (err) {
            throw new CLIError(
              `Could not read private key file: ${opts.privateKeyFile}`,
              "INPUT",
              err instanceof Error ? err.message : undefined
            );
          }
        } else if (opts.privateKey) {
          if (!silent) {
            process.stderr.write(
              chalk.yellow("Warning: --private-key is visible in process list and shell history. Prefer --private-key-file or PRIVACY_POOLS_PRIVATE_KEY env var.\n")
            );
          }
          signerKey = opts.privateKey;
        }

        if (!signerKey && !process.env.PRIVACY_POOLS_PRIVATE_KEY && !skipPrompts) {
          const keyInput = await password({
            message: "Signer private key (0x..., or press Enter to skip):",
            mask: "*",
          });
          if (keyInput.trim()) {
            signerKey = keyInput.trim();
          }
        }

        if (signerKey) {
          const normalized = signerKey.startsWith("0x")
            ? signerKey
            : `0x${signerKey}`;
          if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
            throw new CLIError(
              "Invalid private key format.",
              "INPUT",
              "Private key must be 64 hex characters (with or without 0x prefix)."
            );
          }
          saveSignerKey(normalized);
          if (!isJson) success("Signer key saved.", silent);
        } else if (process.env.PRIVACY_POOLS_PRIVATE_KEY) {
          if (!isJson) info("Using PRIVACY_POOLS_PRIVATE_KEY from environment.", silent);
        } else {
          if (!isJson) warn(
            "No signer key set. You'll need to set PRIVACY_POOLS_PRIVATE_KEY for transactions.",
            silent
          );
        }

        // --- Default Chain ---
        let defaultChain = opts.defaultChain;

        if (!defaultChain && !skipPrompts) {
          defaultChain = await select({
            message: "Select default chain:",
            choices: CHAIN_NAMES.map((name) => ({
              name,
              value: name,
            })),
          });
        }

        const config = loadConfig();
        config.defaultChain = defaultChain ?? config.defaultChain ?? "ethereum";

        const rpcUrl = opts.rpcUrl ?? globalOpts?.rpcUrl;
        if (rpcUrl) {
          const chain = CHAINS[config.defaultChain];
          if (chain) {
            config.rpcOverrides[chain.id] = rpcUrl;
          }
        }

        saveConfig(config);
        if (!isJson) success(`Default chain set to ${config.defaultChain}.`, silent);

        // --- Circuit Artifacts ---
        if (!opts.skipCircuits) {
          const spin = spinner("Downloading circuit artifacts...", silent);
          spin.start();
          try {
            await warmCircuits();
            spin.succeed("Circuit artifacts ready.");
          } catch (error) {
            spin.warn(
              "Circuit artifact download failed. They will be downloaded on first use."
            );
          }
        }

        const resolvedSignerKey = loadSignerKey();
        const ctx = createOutputContext(mode);
        renderInitResult(ctx, {
          defaultChain: config.defaultChain,
          signerKeySet: !!resolvedSignerKey,
          mnemonicImported: !!mnemonicSource,
          showMnemonic: !!opts.showMnemonic,
          mnemonic,
        });
      } catch (error) {
        printError(error, isJson);
      }
    });
}
