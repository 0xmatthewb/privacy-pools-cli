import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createInitCommand(): Command {
  const metadata = getCommandMetadata("init");
  return new Command("init")
    .description(metadata.description)
    .option(
      "--recovery-phrase <phrase>",
      "Import an existing recovery phrase (unsafe: visible in process list)",
    )
    .option(
      "--recovery-phrase-file <path>",
      "Import recovery phrase from a file (raw phrase or Privacy Pools backup file)",
    )
    .option(
      "--recovery-phrase-stdin",
      "Import recovery phrase from stdin (raw phrase or Privacy Pools backup text)",
    )
    .option(
      "--show-recovery-phrase",
      "Include generated recovery phrase in JSON output (unsafe: may be logged or piped)",
    )
    .option(
      "--backup-file <path>",
      "Write a generated recovery phrase backup to a file",
    )
    .option(
      "--private-key <key>",
      "Set the signer private key (unsafe: visible in process list)",
    )
    .option(
      "--private-key-file <path>",
      "Set the signer private key from a file",
    )
    .option("--private-key-stdin", "Set the signer private key from stdin")
    .option(
      "--signer-only",
      "Add or replace the signer key without changing the recovery phrase",
    )
    .option("--default-chain <chain>", "Set default chain")
    .option("--rpc-url <url>", "Set RPC URL for the default chain")
    .option("--force", "Overwrite existing configuration without prompting")
    .option(
      "--dry-run",
      "Preview the init changes without writing files or generating a live recovery phrase",
    )
    .option(
      "--staged",
      "Emit staged JSONL onboarding envelopes in --json/--agent mode",
    )
    .addOption(
      new Option(
        "--skip-circuits",
        "No-op (proof commands use bundled circuit artifacts by default)",
      ).hideHelp(),
    )
    .addHelpText(
      "after",
      "\nUse only one secret stdin source per run: either --recovery-phrase-stdin or --private-key-stdin.\n",
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/init.js"),
        "handleInitCommand",
      ),
    );
}
