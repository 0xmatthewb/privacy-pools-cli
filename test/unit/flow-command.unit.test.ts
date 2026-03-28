import { describe, expect, test } from "bun:test";
import { createFlowCommand } from "../../src/commands/flow.ts";

describe("flow command shell", () => {
  test("registers the expected subcommands and start flags", () => {
    const command = createFlowCommand();
    const subcommands = command.commands.map((subcommand) => subcommand.name());

    expect(subcommands).toEqual(["start", "watch", "status", "ragequit"]);

    const start = command.commands.find((subcommand) => subcommand.name() === "start");
    expect(start).toBeDefined();
    expect(start?.options.map((option) => option.flags)).toEqual(
      expect.arrayContaining([
        "-t, --to <address>",
        "--privacy-delay <profile>",
        "--new-wallet",
        "--export-new-wallet <path>",
        "--watch",
      ]),
    );

    const watch = command.commands.find((subcommand) => subcommand.name() === "watch");
    expect(watch).toBeDefined();
    expect(watch?.options.map((option) => option.flags)).toEqual(
      expect.arrayContaining(["--privacy-delay <profile>"]),
    );
  });
});
