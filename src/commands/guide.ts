import { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGuide } from "../output/guide.js";
import { getCommandMetadata } from "../utils/command-metadata.js";

export function createGuideCommand(): Command {
  const metadata = getCommandMetadata("guide");
  return new Command("guide")
    .description(metadata.description)
    .action((_opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      renderGuide(createOutputContext(mode));
    });
}
