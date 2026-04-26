/**
 * Output renderer for the `guide` command.
 *
 * `src/commands/guide.ts` delegates output rendering here.
 */

import type { OutputContext } from "./common.js";
import {
  appendNextActions,
  createNextAction,
  guardCsvUnsupported,
  isSilent,
  printJsonSuccess,
  renderNextSteps,
} from "./common.js";
import { buildGuidePayload, guideText, resolveGuideTopic } from "../utils/help.js";
import { renderHumanGuideText } from "./discovery.js";

function buildGuideNextActions(topic: string | undefined, agent: boolean) {
  const baseOptions = agent ? { agent: true } : undefined;

  switch (topic) {
    case "topics":
      return [
        createNextAction(
          "guide quickstart",
          "Open the setup and first-deposit guide topic.",
          "after_guide",
          { options: baseOptions },
        ),
        createNextAction(
          "guide workflow",
          "Open the end-to-end deposit and withdrawal workflow topic.",
          "after_guide",
          { options: baseOptions },
        ),
      ];
    case "agents":
    case "json":
    case "next-actions":
    case "exit-codes":
      return [
        createNextAction(
          "capabilities",
          "Inspect the machine-readable runtime contract and supported command surfaces.",
          "after_guide",
          { options: baseOptions },
        ),
      ];
    case "flow-states":
      return [
        createNextAction(
          "flow status",
          "Inspect a saved workflow snapshot after reviewing the flow lifecycle.",
          "after_guide",
          {
            options: baseOptions,
            parameters: [{ name: "workflowId", type: "workflow_id", required: false }],
            runnable: false,
          },
        ),
      ];
    case "profiles":
    case "env-vars":
      return [
        createNextAction(
          "config list",
          "Inspect the local profile and configuration state.",
          "after_guide",
          { options: baseOptions },
        ),
      ];
    default:
      return [
        createNextAction(
          "status",
          "Run the standard setup and health check after reviewing the guide.",
          "after_guide",
          { options: baseOptions },
        ),
      ];
  }
}

/**
 * Render guide output, optionally filtered to a single topic.
 */
export function renderGuide(ctx: OutputContext, topic?: string): void {
  const resolvedTopic = resolveGuideTopic(topic) ?? topic;
  const agentNextActions = buildGuideNextActions(resolvedTopic, true);
  const humanNextActions = buildGuideNextActions(resolvedTopic, false);
  if (ctx.mode.isJson) {
    printJsonSuccess(
      appendNextActions(buildGuidePayload(resolvedTopic), agentNextActions),
    );
    return;
  }

  guardCsvUnsupported(ctx, "guide");
  if (isSilent(ctx)) return;

  renderHumanGuideText(guideText(topic));
  renderNextSteps(ctx, humanNextActions);
}
