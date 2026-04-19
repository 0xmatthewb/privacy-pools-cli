import { Command, Option } from "commander";
import { commandHelpText, groupedFlagGuideText } from "../utils/help.js";
import { getCommandMetadata } from "../utils/command-metadata.js";
import { FLOW_PRIVACY_DELAY_PROFILES } from "../utils/flow-privacy-delay.js";
import { createLazyAction } from "../utils/lazy-command.js";

export function createFlowCommand(): Command {
  const metadata = getCommandMetadata("flow");
  const startMetadata = getCommandMetadata("flow start");
  const watchMetadata = getCommandMetadata("flow watch");
  const statusMetadata = getCommandMetadata("flow status");
  const stepMetadata = getCommandMetadata("flow step");
  const ragequitMetadata = getCommandMetadata("flow ragequit");

  const command = new Command("flow")
    .description(metadata.description)
    .addHelpText("after", commandHelpText(metadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowRootCommand",
      ),
    );

  command
    .command("start")
    .description(startMetadata.description)
    .argument("<amount>", "Human-readable token amount to deposit (e.g. 0.1, not wei)")
    .argument("<asset>", "Asset symbol or token address (case-insensitive; e.g. ETH, USDC)")
    .option(
      "-t, --to <address>",
      "Recipient address for private withdrawal (prompted interactively; required whenever prompts are skipped)",
    )
    .addOption(
      new Option(
        "--privacy-delay <profile>",
        "Privacy delay profile: off = withdraw immediately after ASP approval; weakest privacy. balanced = default; 15 to 90 minutes randomized; standard hygiene. strict = 2 to 12 hours randomized; strongest fingerprint resistance.",
      ).choices([...FLOW_PRIVACY_DELAY_PROFILES]),
    )
    .option("--new-wallet", "Create and use a dedicated wallet for this workflow")
    .option("--export-new-wallet <path>", "Export the generated workflow wallet backup before continuing (requires --new-wallet)")
    .option("--dry-run", "Validate the flow start inputs without saving a workflow or submitting a deposit")
    .option("--watch", "Keep watching this workflow until it finishes or pauses")
    .addHelpText(
      "after",
      groupedFlagGuideText([
        {
          heading: "Setup mode",
          flags: [
            "--dry-run",
            "--watch",
          ],
        },
        {
          heading: "Secret sources",
          flags: [
            "--new-wallet",
            "--export-new-wallet <path>",
          ],
        },
        {
          heading: "Network",
          flags: [
            "--chain <name>",
            "--rpc-url <url>",
          ],
        },
        {
          heading: "Safety",
          flags: [
            "--to <address>",
            "--privacy-delay <profile>",
            "--yes",
            "--agent",
            "--help-brief",
          ],
        },
      ]),
    )
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
    .argument("[workflowId|latest]", "Saved workflow id or 'latest' (defaults to latest)")
    .addOption(
      new Option(
        "--privacy-delay <profile>",
        "Persist or override the saved privacy delay profile: off = withdraw immediately after ASP approval; weakest privacy. balanced = default; 15 to 90 minutes randomized; standard hygiene. strict = 2 to 12 hours randomized; strongest fingerprint resistance.",
      ).choices([...FLOW_PRIVACY_DELAY_PROFILES]),
    )
    .option(
      "--stream-json",
      "Emit line-delimited JSON phase_change events plus the final snapshot",
    )
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
    .argument("[workflowId|latest]", "Saved workflow id or 'latest' (defaults to latest)")
    .addHelpText("after", commandHelpText(statusMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowStatusCommand",
      ),
    );

  command
    .command("step")
    .description(stepMetadata.description)
    .argument("[workflowId|latest]", "Saved workflow id or 'latest' (defaults to latest)")
    .addHelpText("after", commandHelpText(stepMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowStepCommand",
      ),
    );

  command
    .command("ragequit")
    .description(ragequitMetadata.description)
    .argument("[workflowId|latest]", "Saved workflow id or 'latest' (defaults to latest)")
    .option(
      "--confirm-ragequit",
      "Deprecated compatibility flag for non-interactive flow ragequit commands that intentionally choose the public recovery path",
    )
    .addHelpText("after", commandHelpText(ragequitMetadata.help ?? {}))
    .action(
      createLazyAction(
        () => import("../commands/flow.js"),
        "handleFlowRagequitCommand",
      ),
    );

  return command;
}
