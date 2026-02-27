import { Command } from "commander";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGuide } from "../output/guide.js";
export function createGuideCommand() {
    return new Command("guide")
        .description("Show usage guide, workflow, and reference")
        .action((_opts, cmd) => {
        const globalOpts = cmd.parent?.opts();
        const mode = resolveGlobalMode(globalOpts);
        renderGuide(createOutputContext(mode));
    });
}
