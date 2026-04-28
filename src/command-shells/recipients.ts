import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createRecipientsCommand(): Command {
  const metadata = getCommandMetadata("recipients");
  const listMetadata = getCommandMetadata("recipients list");
  const addMetadata = getCommandMetadata("recipients add");
  const removeMetadata = getCommandMetadata("recipients remove");
  const clearMetadata = getCommandMetadata("recipients clear");
  const command = new Command("recipients")
    .alias("recents")
    .description(metadata.description)
    .option("-n, --limit <n>", "Limit recipients returned")
    .option("--all-chains", "List remembered recipients across all chains")
    .option("--include-metadata", "Include recipient timestamps in JSON output")
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsListCommand",
      ),
    );

  command
    .command("list")
    .alias("ls")
    .description(listMetadata.description)
    .option("-n, --limit <n>", "Limit recipients returned")
    .option("--all-chains", "List remembered recipients across all chains")
    .option("--include-metadata", "Include recipient timestamps in JSON output")
    .addHelpText("after", commandHelpText(listMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsListCommand",
      ),
    );

  command
    .command("add")
    .description(addMetadata.description)
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .argument("[label]", "Optional display label")
    .addHelpText("after", commandHelpText(addMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsAddCommand",
      ),
    );

  command
    .command("remove")
    .alias("rm")
    .description(removeMetadata.description)
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .addHelpText("after", commandHelpText(removeMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsRemoveCommand",
      ),
    );

  command
    .command("clear")
    .description(clearMetadata.description)
    .addHelpText("after", commandHelpText(clearMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsClearCommand",
      ),
    );

  return command;
}
