import { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGuide } from "../output/guide.js";

export function createGuideCommand(): Command {
  return new Command("guide")
    .description("Show usage guide, workflow, and reference")
    .action((opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      renderGuide(createOutputContext(mode));
    });
}
