import type { Command } from "commander";
import { printError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderCapabilities } from "../output/capabilities.js";
import { STATIC_CAPABILITIES_PAYLOAD } from "../utils/command-discovery-static.js";

export async function handleCapabilitiesCommand(
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    renderCapabilities(createOutputContext(mode), STATIC_CAPABILITIES_PAYLOAD);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
