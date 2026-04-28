import { Command, Option } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createRecipientsCommand(): Command {
  const metadata = getCommandMetadata("recipients");
  const command = new Command("recipients")
    .alias("recents")
    .description(metadata.description)
    .option("-n, --limit <n>", "Limit recipients returned")
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
    .description("List remembered withdrawal recipients")
    .option("-n, --limit <n>", "Limit recipients returned")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsListCommand",
      ),
    );

  command
    .command("add")
    .description("Add a recipient to the local withdrawal address book")
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .argument("[label]", "Optional display label")
    .addOption(new Option("--label <label>", "Optional display label").hideHelp())
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsAddCommand",
      ),
    );

  command
    .command("remove")
    .alias("rm")
    .description("Remove a recipient from the local withdrawal address book")
    .argument("<address-or-ens>", "Recipient address or ENS name")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsRemoveCommand",
      ),
    );

  command
    .command("clear")
    .description("Clear all remembered withdrawal recipients")
    .action(
      createLazyAction(
        () => import("../commands/withdraw/recipients.js"),
        "handleWithdrawRecipientsClearCommand",
      ),
    );

  return command;
}
