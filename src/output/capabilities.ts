/**
 * Output renderer for the `capabilities` command.
 *
 * `src/commands/capabilities.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, guardCsvUnsupported } from "./common.js";

/**
 * The static capabilities payload.
 * Renderer owns the data shape; command handler just calls render.
 */
export interface CapabilitiesPayload {
  commands: Array<{
    name: string;
    description: string;
    aliases?: string[];
    flags?: string[];
    usage?: string;
    agentFlags?: string;
    requiresInit: boolean;
    expectedLatencyClass?: "fast" | "medium" | "slow";
  }>;
  globalFlags: Array<{ flag: string; description: string }>;
  agentWorkflow: string[];
  agentNotes?: Record<string, string>;
  schemas?: Record<string, Record<string, unknown>>;
  supportedChains?: Array<{ name: string; chainId: number; testnet: boolean }>;
  jsonOutputContract: string;
  safeReadOnlyCommands?: string[];
}

/**
 * Render capabilities output.
 */
export function renderCapabilities(
  ctx: OutputContext,
  payload: CapabilitiesPayload,
): void {
  guardCsvUnsupported(ctx, "capabilities");

  if (ctx.mode.isJson) {
    printJsonSuccess(payload);
    return;
  }

  process.stderr.write("\nPrivacy Pools CLI: Agent Capabilities\n\n");
  process.stderr.write("Commands:\n");
  for (const c of payload.commands) {
    const aliasStr = c.aliases ? ` (alias: ${c.aliases.join(", ")})` : "";
    process.stderr.write(`  ${c.name}${aliasStr}: ${c.description}\n`);
    if (c.agentFlags) {
      process.stderr.write(
        `    Agent usage: privacy-pools ${c.usage ?? c.name} ${c.agentFlags}\n`,
      );
    }
  }

  process.stderr.write("\nGlobal Flags:\n");
  for (const f of payload.globalFlags) {
    process.stderr.write(`  ${f.flag}: ${f.description}\n`);
  }

  process.stderr.write("\nTypical Agent Workflow:\n");
  for (const step of payload.agentWorkflow) {
    process.stderr.write(`  ${step}\n`);
  }
  process.stderr.write("\n");
}
