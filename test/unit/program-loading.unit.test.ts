import { describe, expect, test } from "bun:test";
import { createRootProgram } from "../../src/program.ts";

describe("root program lazy loading", () => {
  test("loads only the requested command when argv targets a root command", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: false,
      argv: ["--chain", "sepolia", "flow", "start"],
    });

    expect(program.commands.map((command) => command.name())).toEqual(["flow"]);
  });

  test("resolves root command aliases when loading on demand", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: false,
      argv: ["recents"],
    });

    expect(program.commands.map((command) => command.name())).toEqual([
      "recipients",
    ]);
  });

  test("loads the help target command when using help <command>", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: false,
      argv: ["help", "withdraw"],
    });

    expect(program.commands.map((command) => command.name())).toEqual([
      "withdraw",
    ]);
  });

  test("loads upgrade on demand as a tooling root command", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: false,
      argv: ["upgrade", "--check"],
    });

    expect(program.commands.map((command) => command.name())).toEqual(["upgrade"]);
  });

  test("falls back to the full tree for unknown invocations", async () => {
    const program = await createRootProgram("0.0.0", {
      loadAllCommands: false,
      argv: ["not-a-command"],
    });

    expect(program.commands.map((command) => command.name())).toContain("flow");
    expect(program.commands.map((command) => command.name())).toContain("withdraw");
  });
});
