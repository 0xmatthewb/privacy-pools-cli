/**
 * Output renderer for the `capabilities` command.
 *
 * `src/commands/capabilities.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import { printJsonSuccess, guardCsvUnsupported } from "./common.js";
import type { CapabilitiesPayload } from "../types.js";

export type { CapabilitiesPayload } from "../types.js";

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

  process.stderr.write("\nProtocol Profile:\n");
  process.stderr.write(
    `  ${payload.protocol.displayName} (${payload.protocol.profile}) via ${payload.protocol.coreSdkPackage}@${payload.protocol.coreSdkVersion}\n`,
  );

  process.stderr.write("\nRuntime Compatibility:\n");
  process.stderr.write(
    `  CLI ${payload.runtime.cliVersion}; JSON ${payload.runtime.jsonSchemaVersion}; runtime ${payload.runtime.runtimeVersion}; worker ${payload.runtime.workerProtocolVersion}; manifest ${payload.runtime.manifestVersion}; bridge ${payload.runtime.nativeBridgeVersion}\n`,
  );
  process.stderr.write("\n");
}
