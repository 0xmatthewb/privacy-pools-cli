/**
 * Output renderer for the `capabilities` command.
 *
 * `src/commands/capabilities.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  printJsonSuccess,
  isSilent,
  guardCsvUnsupported,
  renderNextSteps,
} from "./common.js";
import type { CapabilitiesPayload } from "../types.js";
import { renderHumanCapabilities } from "./discovery.js";

export type { CapabilitiesPayload } from "../types.js";

/**
 * Render capabilities output.
 */
export function renderCapabilities(
  ctx: OutputContext,
  payload: CapabilitiesPayload,
): void {
  guardCsvUnsupported(ctx, "capabilities");
  const agentNextActions = [
    createNextAction(
      "describe",
      "Inspect one command path in detail after loading the global capabilities manifest.",
      "after_capabilities",
      {
        options: { agent: true },
        parameters: [{ name: "commandPath", type: "command_path", required: true }],
        runnable: false,
      },
    ),
  ];
  const humanNextActions = [
    createNextAction(
      "describe",
      "Inspect one command path in detail after loading the global capabilities manifest.",
      "after_capabilities",
      {
        parameters: [{ name: "commandPath", type: "command_path", required: true }],
        runnable: false,
      },
    ),
  ];

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      mode: "capabilities",
      operation: "capabilities",
      ...payload,
    }, agentNextActions));
    return;
  }

  if (isSilent(ctx)) return;

  renderHumanCapabilities(payload);
  renderNextSteps(ctx, humanNextActions);
}
