import { describe, expect, test } from "bun:test";
import { createFlowCommand } from "../../src/commands/flow.ts";

describe("flow command shell", () => {
  test("registers the expected subcommands and start flags", () => {
    const command = createFlowCommand();
    const subcommands = command.commands.map((subcommand) => subcommand.name());

    expect(subcommands).toEqual(["start", "watch", "status", "step", "ragequit"]);

    const start = command.commands.find((subcommand) => subcommand.name() === "start");
    expect(start).toBeDefined();
    expect(start?.options.map((option) => option.flags)).toEqual(
      expect.arrayContaining([
        "-t, --to <address>",
        "--privacy-delay <profile>",
        "--dry-run",
        "--new-wallet",
        "--export-new-wallet <path>",
        "--watch",
      ]),
    );
    expect(
      start?.options.find((option) => option.long === "--privacy-delay")?.argChoices,
    ).toEqual(["off", "balanced", "strict"]);

    const watch = command.commands.find((subcommand) => subcommand.name() === "watch");
    expect(watch).toBeDefined();
    expect(watch?.options.map((option) => option.flags)).toEqual(
      expect.arrayContaining(["--privacy-delay <profile>"]),
    );
    expect(
      watch?.options.find((option) => option.long === "--privacy-delay")?.argChoices,
    ).toEqual(["off", "balanced", "strict"]);
  });
});
