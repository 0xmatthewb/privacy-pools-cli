import { Command } from "commander";
import { guideText } from "../utils/help.js";
import { printJsonSuccess } from "../utils/json.js";
export function createGuideCommand() {
    return new Command("guide")
        .description("Show the full usage guide, workflow, and reference")
        .action((opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const isJson = globalOpts?.json ?? false;
        const isQuiet = globalOpts?.quiet ?? false;
        if (isQuiet)
            return;
        if (isJson) {
            printJsonSuccess({
                guide: "Run 'privacy-pools guide' without --json for the full guide.",
            });
            return;
        }
        process.stderr.write("\n");
        process.stderr.write(guideText() + "\n");
        process.stderr.write("\n");
    });
}
