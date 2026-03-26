import { Command } from "commander";
import { commandHelpText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createFlowCommand(): Command {
  const metadata = getCommandMetadata("flow");
  const startMetadata = getCommandMetadata("flow start");
  const watchMetadata = getCommandMetadata("flow watch");
  const statusMetadata = getCommandMetadata("flow status");
  const ragequitMetadata = getCommandMetadata("flow ragequit");

  const command = new Command("flow")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}));

  command
    .command("start")
    .description(startMetadata.description)
    .argument("<amount>", "Amount to deposit (e.g. 0.1)")
    .argument("<asset>", "Asset symbol (e.g. ETH, USDC)")
    .option("-t, --to <address>", "Recipient address for the later private withdrawal")
    .option("--new-wallet", "Create and use a dedicated wallet for this workflow")
    .option("--export-new-wallet <path>", "Export the generated workflow wallet backup before continuing (requires --new-wallet)")
    .option("--watch", "Keep watching this workflow until it reaches a terminal state")
    .addHelpText("after", commandHelpText(startMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowStartCommand",
      ),
    );

  command
    .command("watch")
    .description(watchMetadata.description)
    .argument("[workflowId]", "Saved workflow id (defaults to latest)")
    .addHelpText("after", commandHelpText(watchMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowWatchCommand",
      ),
    );

  command
    .command("status")
    .description(statusMetadata.description)
    .argument("[workflowId]", "Saved workflow id (defaults to latest)")
    .addHelpText("after", commandHelpText(statusMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowStatusCommand",
      ),
    );

  command
    .command("ragequit")
    .description(ragequitMetadata.description)
    .argument("[workflowId]", "Saved workflow id (defaults to latest)")
    .addHelpText("after", commandHelpText(ragequitMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowRagequitCommand",
      ),
    );

  return command;
}
