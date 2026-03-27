import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { handleCapabilitiesCommand } from "../../src/commands/capabilities.ts";
import { handleCompletionCommand } from "../../src/commands/completion.ts";
import { handleDescribeCommand } from "../../src/commands/describe.ts";
import { handleGuideCommand } from "../../src/commands/guide.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
} from "../helpers/output.ts";

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
  } as unknown as Command;
}

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
  args: string[] = [],
): Command {
  return {
    parent: fakeRoot(globalOpts),
    args,
  } as unknown as Command;
}

describe("utility command handlers", () => {
  test("capabilities returns the static discovery payload in JSON mode", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleCapabilitiesCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.commands).toEqual(expect.any(Array));
    expect(json.commands.some((entry: { name: string }) => entry.name === "flow")).toBe(true);
    expect(json.documentation.reference).toContain("docs/reference.md");
    expect(stderr).toBe("");
  });

  test("guide returns machine-readable help in JSON mode", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleGuideCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("flow ragequit");
    expect(json.help).toContain("--new-wallet");
    expect(stderr).toBe("");
  });

  test("describe returns command metadata for a valid command path", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["stats", "global"],
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.command).toBe("stats global");
    expect(json.safeReadOnly).toBe(true);
    expect(json.examples).toEqual(expect.any(Array));
    expect(stderr).toBe("");
  });

  test("describe returns a structured INPUT error for an unknown command path", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDescribeCommand(["definitely", "missing"], fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Unknown command path");
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
  });

  test("completion query returns candidates in JSON mode", async () => {
    const cmd = fakeCommand(
      { json: true },
      ["privacy-pools", "flo"],
    );
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleCompletionCommand(undefined, { query: true, shell: "bash", cword: "1" }, cmd),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-query");
    expect(json.shell).toBe("bash");
    expect(json.candidates).toContain("flow");
    expect(stderr).toBe("");
  });

  test("completion emits a shell script to stdout in human mode", async () => {
    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleCompletionCommand("bash", {}, fakeCommand()),
    );

    expect(stdout).toContain("privacy-pools");
    expect(stdout).toContain("complete");
    expect(stderr).toBe("");
  });

  test("completion returns a structured INPUT error for an invalid shell", async () => {
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleCompletionCommand(undefined, { shell: "csh" }, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Unsupported shell");
    expect(exitCode).toBe(2);
  });
});
