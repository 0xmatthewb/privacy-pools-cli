import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

function unsignedCompatOption(): Option {
  return new Option(
    "--unsigned [format]",
    "Unsupported on simulate; use the original command with --unsigned when you need a signer-facing envelope.",
  )
    .choices(["envelope", "tx"])
    .hideHelp();
}

function impliedDryRunOption(): Option {
  return new Option(
    "--dry-run",
    "simulate already forces dry-run behavior.",
  ).hideHelp();
}

export function createSimulateCommand(): Command {
  const metadata = getCommandMetadata("simulate");
  const depositMetadata = getCommandMetadata("simulate deposit");
  const withdrawMetadata = getCommandMetadata("simulate withdraw");
  const ragequitMetadata = getCommandMetadata("simulate ragequit");

  const command = new Command("simulate")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/simulate.js"),
        "handleSimulateRootCommand",
      ),
    );

  command
    .command("deposit")
    .description(depositMetadata.description)
    .argument("<amount>", "Human-readable token amount to deposit (e.g. 0.1, not wei)")
    .argument("[asset]", "Asset symbol or token address (case-insensitive; e.g. ETH, USDC)")
    .addOption(unsignedCompatOption())
    .addOption(impliedDryRunOption())
    .option(
      "--allow-non-round-amounts",
      "Allow non-round deposit amounts (weaker privacy; round amounts are harder to fingerprint)",
    )
    .addOption(
      new Option(
        "--ignore-unique-amount",
        "Deprecated alias for --allow-non-round-amounts",
      ).hideHelp(),
    )
    .addHelpText("after", commandHelpText(depositMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/simulate.js"),
        "handleSimulateDepositCommand",
      ),
    );

  command
    .command("withdraw")
    .description(withdrawMetadata.description)
    .usage("[options] [amount] [asset]")
    .argument(
      "[amount]",
      "Human-readable amount to withdraw (e.g. 0.05, 50%, 100%) or omit for interactive",
    )
    .argument("[asset]", "Asset symbol or token address (case-insensitive; e.g. ETH, USDC)")
    .option(
      "-t, --to <address>",
      "Recipient address (required unless --direct; prompted interactively)",
    )
    .option(
      "-p, --pool-account <PA-ID | numeric-index>",
      "Withdraw from a specific Pool Account (examples: PA-2 or 2)",
    )
    .addOption(
      new Option(
        "--direct",
        "WILL publicly link deposit and withdrawal addresses onchain. This cannot be undone.",
      ),
    )
    .addOption(
      new Option(
        "--confirm-direct-withdraw",
        "Deprecated: replaced by interactive confirmation. Will be removed in v3.x.",
      ),
    )
    .addOption(unsignedCompatOption())
    .addOption(impliedDryRunOption())
    .option("--all", "Withdraw entire Pool Account balance (requires asset: simulate withdraw --all ETH)")
    .option(
      "--accept-all-funds-public",
      "Acknowledge that --all --direct in non-interactive mode publicly links the full Pool Account balance",
    )
    .option(
      "--extra-gas",
      "For ERC20 withdrawals, ask the relayer to include a small native-token gas top-up from the withdrawn funds (slightly higher fee)",
    )
    .option("--no-extra-gas", "Disable extra gas for ERC20 withdrawals")
    .addHelpText("after", commandHelpText(withdrawMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/simulate.js"),
        "handleSimulateWithdrawCommand",
      ),
    );

  command
    .command("ragequit")
    .description(ragequitMetadata.description)
    .argument("[asset]", "Optional asset symbol or token address (case-insensitive; e.g. ETH)")
    .option(
      "-p, --pool-account <PA-ID | numeric-index>",
      "Ragequit a specific Pool Account (examples: PA-2 or 2)",
    )
    .addOption(unsignedCompatOption())
    .addOption(impliedDryRunOption())
    .option(
      "--confirm-ragequit",
      "Deprecated: replaced by interactive confirmation. Will be removed in v3.x.",
    )
    .addHelpText("after", commandHelpText(ragequitMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/simulate.js"),
        "handleSimulateRagequitCommand",
      ),
    );

  return command;
}
