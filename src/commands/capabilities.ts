import type { Command } from "commander";
import { printError } from "../utils/errors.js";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderCapabilities } from "../output/capabilities.js";
import { buildCapabilitiesPayload } from "../utils/command-discovery-metadata.js";

export async function handleCapabilitiesCommand(
  _opts: unknown,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    renderCapabilities(createOutputContext(mode), buildCapabilitiesPayload());
  } catch (error) {
    printError(error, mode.isJson);
  }
}
