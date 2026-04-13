import type { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGuide } from "../output/guide.js";
import { printError } from "../utils/errors.js";

export async function handleGuideCommand(
  topic: string | undefined,
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  try {
    renderGuide(createOutputContext(mode), topic);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
