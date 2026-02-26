import { Command } from "commander";
import { confirm, input, select } from "@inquirer/prompts";
import chalk from "chalk";
import {
  ensureConfigDir,
  configExists,
  mnemonicExists,
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
  loadConfig,
} from "../services/config.js";
import {
  generateMnemonic,
  validateMnemonic,
} from "../services/wallet.js";
import { warmCircuits } from "../services/sdk.js";
import { CHAIN_NAMES } from "../config/chains.js";
import { success, warn, spinner, info } from "../utils/format.js";
import { printError, CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { commandHelpText } from "../utils/help.js";
import type { GlobalOptions } from "../types.js";

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize wallet and configuration")
    .option("--mnemonic <phrase>", "Import an existing BIP-39 mnemonic phrase")
    .option("--private-key <key>", "Set the signer private key")
    .option("--default-chain <chain>", "Set default chain")
    .option("--rpc-url <url>", "Set RPC URL for the default chain")
    .option("--skip-circuits", "Skip downloading circuit artifacts")
    .addHelpText(
      "after",
      "\nExamples:\n  privacy-pools init\n  privacy-pools init --yes --default-chain sepolia --skip-circuits\n  privacy-pools init --mnemonic \"word ...\" --private-key 0x...\n"
        + commandHelpText({
          jsonFields: "{ defaultChain, signerKeySet, mnemonic? }",
        })
    )
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const isJson = globalOpts?.json ?? false;
      const isQuiet = globalOpts?.quiet ?? false;
      const silent = isQuiet || isJson;
      const skipPrompts = globalOpts?.yes ?? false;

      try {
        ensureConfigDir();

        // Check for existing configuration or mnemonic
        const hasExisting = configExists() || mnemonicExists();
        if (hasExisting && !skipPrompts) {
          const overwrite = await confirm({
            message: "Existing configuration found. Reinitializing will generate a new mnemonic and overwrite settings. Continue?",
            default: false,
          });
          if (!overwrite) {
            info("Init cancelled.", silent);
            return;
          }
        } else if (hasExisting && skipPrompts) {
          warn("Overwriting existing configuration and mnemonic.", silent);
        }

        // --- Mnemonic ---
        let mnemonic: string;

        if (opts.mnemonic) {
          if (!validateMnemonic(opts.mnemonic)) {
            throw new CLIError(
              "Invalid mnemonic phrase.",
              "INPUT",
              "Provide a valid BIP-39 mnemonic (12 or 24 words)."
            );
          }
          mnemonic = opts.mnemonic;
        } else if (skipPrompts) {
          mnemonic = generateMnemonic();
        } else {
          const action = await select({
            message: "Wallet setup:",
            choices: [
              { name: "Generate new mnemonic", value: "generate" },
              { name: "Import existing mnemonic", value: "import" },
            ],
          });

          if (action === "import") {
            const phrase = await input({
              message: "Enter your BIP-39 mnemonic phrase:",
            });
            if (!validateMnemonic(phrase.trim())) {
              throw new CLIError(
                "Invalid mnemonic phrase.",
                "INPUT",
                "Provide a valid BIP-39 mnemonic (12 or 24 words)."
              );
            }
            mnemonic = phrase.trim();
          } else {
            mnemonic = generateMnemonic();
          }
        }

        // Display mnemonic (only this once) — always to stderr to keep stdout clean
        if (!opts.mnemonic && !isJson) {
          process.stderr.write("\n");
          process.stderr.write(chalk.bold.yellow("⚠  IMPORTANT: Save your mnemonic phrase securely!") + "\n");
          process.stderr.write(chalk.bold.yellow("   This is the ONLY time it will be displayed.") + "\n");
          process.stderr.write("\n");
          process.stderr.write(chalk.bold(mnemonic) + "\n");
          process.stderr.write("\n");
        } else if (!opts.mnemonic && isJson) {
          // In JSON mode, warn via stderr; mnemonic will be in JSON output
          process.stderr.write(chalk.bold.yellow("⚠  Save your mnemonic from the JSON output below.") + "\n");
        }

        saveMnemonicToFile(mnemonic);
        if (!isJson) success("Mnemonic saved.", silent);

        // --- Signer Key ---
        let signerKey: string | undefined = opts.privateKey;

        if (!signerKey && !process.env.PRIVACY_POOLS_PRIVATE_KEY && !skipPrompts) {
          const keyInput = await input({
            message: "Signer private key (0x..., or press Enter to skip):",
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
          const { CHAINS } = await import("../config/chains.js");
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

        if (isJson) {
          const jsonOutput: Record<string, unknown> = {
            defaultChain: config.defaultChain,
            signerKeySet: !!signerKey || !!process.env.PRIVACY_POOLS_PRIVATE_KEY,
          };
          // Include mnemonic in JSON only when newly generated (not imported)
          if (!opts.mnemonic) {
            jsonOutput.mnemonic = mnemonic;
          }
          printJsonSuccess(jsonOutput, false);
        } else {
          process.stderr.write("\n");
          success("Initialization complete!", silent);
          info("Run 'privacy-pools status' to verify your setup.", silent);
        }
      } catch (error) {
        printError(error, isJson);
      }
    });
}
