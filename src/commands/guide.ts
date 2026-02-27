import { Command } from "commander";
import { guideText } from "../utils/help.js";
import { printJsonSuccess } from "../utils/json.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";

export function createGuideCommand(): Command {
  return new Command("guide")
    .description("Show usage guide, workflow, and reference")
    .action((opts, cmd) => {
      const globalOpts = cmd.parent?.opts() as GlobalOptions;
      const mode = resolveGlobalMode(globalOpts);
      const isJson = mode.isJson;
      const isQuiet = mode.isQuiet;

      if (isJson) {
        printJsonSuccess({
          guide: "Run 'privacy-pools guide' without --json for the full guide.",
        });
        return;
      }

      if (isQuiet) return;

      process.stderr.write("\n");
      process.stderr.write(guideText() + "\n");
      process.stderr.write("\n");
    });
}
