import { Command } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { INIT_STAGED_STEP_NAMES } from "../utils/init-staged-steps.js";
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
      `Emit onboarding progress as JSONL envelopes in --json/--agent mode (${INIT_STAGED_STEP_NAMES.join(", ")})`,
    )
    .option(
      "--pending",
      "Emit an agent-safe human handoff plan without reading or writing secrets",
    )
    .addHelpText(
      "after",
      "\nUse only one secret stdin source per run: either --recovery-phrase-stdin or --private-key-stdin.\n",
    )
    .addHelpText(
      "after",
      groupedFlagGuideText([
        {
          heading: "Setup mode",
          flags: [
            "--signer-only",
            "--force",
            "--dry-run",
            "--staged",
            "--pending",
          ],
        },
        {
          heading: "Secret sources",
          flags: [
            "--recovery-phrase <phrase>",
            "--recovery-phrase-file <path>",
            "--recovery-phrase-stdin",
            "--backup-file <path>",
            "--show-recovery-phrase",
            "--private-key <key>",
            "--private-key-file <path>",
            "--private-key-stdin",
          ],
        },
        {
          heading: "Network",
          flags: [
            "--default-chain <chain>",
            "--rpc-url <url>",
          ],
        },
        {
          heading: "Output & Defaults",
          flags: [
            "--yes",
            "--agent",
            "--help-brief",
            "--help-full",
          ],
        },
      ]),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/init.js"),
        "handleInitCommand",
      ),
    );
}
