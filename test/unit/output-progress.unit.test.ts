import { describe, expect, test } from "bun:test";
import {
  createNarrativeSteps,
  renderFlowRail,
  renderNarrativeSteps,
  renderOutcomeDirection,
  type FlowRailStep,
  type NarrativeStep,
} from "../../src/output/progress.ts";
import { stripAnsiCodes } from "../../src/utils/terminal.ts";

function plainText(value: string): string {
  return stripAnsiCodes(value).replace(/\r/g, "");
}

describe("output progress helpers", () => {
  test("createNarrativeSteps marks done, active, and pending states with the active note", () => {
    expect(
      createNarrativeSteps(
        ["Deposit publicly", "Await ASP approval", "Withdraw privately"],
        1,
        "Waiting for ASP approval",
      ),
    ).toEqual([
      { label: "Deposit publicly", state: "done" },
      {
        label: "Await ASP approval",
        state: "active",
        note: "Waiting for ASP approval",
      },
      { label: "Withdraw privately", state: "pending" },
    ]);
  });

  test("renderNarrativeSteps keeps blocked notes inline with the affected step", () => {
    const steps: NarrativeStep[] = [
      { label: "Deposit publicly", state: "done" },
      {
        label: "Recover publicly",
        state: "blocked",
        note: "Relayer minimum blocked the private path",
      },
    ];

    const rendered = plainText(renderNarrativeSteps(steps));

    expect(rendered).toContain("Deposit publicly");
    expect(rendered).toContain(
      "Recover publicly - Relayer minimum blocked the private path",
    );
  });

  test("renderFlowRail only emits notes for active and blocked steps", () => {
    const steps: FlowRailStep[] = [
      { label: "Deposit", state: "done" },
      {
        label: "Generate proof",
        state: "active",
        note: "Generating and locally verifying the proof",
      },
      {
        label: "Auto-withdraw",
        state: "skipped",
        note: "Skipped because public recovery was chosen",
      },
      {
        label: "Ragequit",
        state: "blocked",
        note: "Use public recovery after the relayer minimum check failed",
      },
    ];

    const rendered = plainText(renderFlowRail(steps));

    expect(rendered).toContain("Deposit ->");
    expect(rendered).toContain("Generate proof");
    expect(rendered).toContain("Auto-withdraw");
    expect(rendered).toContain("Ragequit");
    expect(rendered).toContain("Generating and locally verifying the proof");
    expect(rendered).toContain(
      "Use public recovery after the relayer minimum check failed",
    );
    expect(rendered).not.toContain(
      "Skipped because public recovery was chosen",
    );
  });

  test("renderOutcomeDirection preserves the outcome text for each direction kind", () => {
    const value = "0.1 ETH";

    expect(plainText(renderOutcomeDirection("deposit")(value))).toContain(value);
    expect(plainText(renderOutcomeDirection("withdraw")(value))).toContain(value);
    expect(plainText(renderOutcomeDirection("recovery")(value))).toContain(value);
  });
});
