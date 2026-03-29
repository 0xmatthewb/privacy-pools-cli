import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createInitCommand(): Command {
  const metadata = getCommandMetadata("init");
  return new Command("init")
    .description(metadata.description)
    .option(
      "--mnemonic <phrase>",
      "Import an existing recovery phrase (unsafe: visible in process list)",
    )
    .option(
      "--mnemonic-file <path>",
      "Import recovery phrase from a file (raw phrase or Privacy Pools backup file)",
    )
    .option(
      "--mnemonic-stdin",
      "Import recovery phrase from stdin (raw phrase or Privacy Pools backup text)",
    )
    .option(
      "--show-mnemonic",
      "Include generated recovery phrase in JSON output (unsafe: may be logged or piped)",
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
    .option("--default-chain <chain>", "Set default chain")
    .option("--rpc-url <url>", "Set RPC URL for the default chain")
    .option("--force", "Overwrite existing configuration without prompting")
    .addOption(
      new Option(
        "--skip-circuits",
        "No-op (proof commands use bundled circuit artifacts by default)",
      ).hideHelp(),
    )
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/init.js"),
        "handleInitCommand",
      ),
    );
}
