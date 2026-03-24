import { beforeAll, describe, expect, test } from "bun:test";
import {
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";
import { createBuiltWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";

let builtWorkspaceRoot: string;

beforeAll(() => {
  builtWorkspaceRoot = createBuiltWorkspaceSnapshot();
}, 240_000);

describe("built CLI entrypoint", () => {
  const runBuiltSnapshotCli = (args: string[]) =>
    runBuiltCli(args, {
      home: createTempHome(),
      cwd: builtWorkspaceRoot,
    });

  test("--version returns a semantic version", () => {
    const result = runBuiltSnapshotCli(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr.trim()).toBe("");
  });

  test("--help returns human-readable usage on stdout", () => {
    const result = runBuiltSnapshotCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Explore (no wallet needed)");
    expect(result.stderr.trim()).toBe("");
  });

  test("capabilities --agent returns a machine-readable discovery manifest", () => {
    const result = runBuiltSnapshotCli(["capabilities", "--agent"]);
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      commands: Array<{ name: string }>;
      commandDetails: Record<string, { command: string }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.commands.map((command) => command.name)).toContain("status");
    expect(json.commands.map((command) => command.name)).toContain("withdraw quote");
    expect(json.commandDetails.capabilities?.command).toBe("capabilities");
    expect(result.stderr.trim()).toBe("");
  });

  test("describe withdraw quote --agent returns the shipped descriptor", () => {
    const result = runBuiltSnapshotCli(["describe", "withdraw", "quote", "--agent"]);
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      command: string;
      usage: string;
      flags: string[];
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.command).toBe("withdraw quote");
    expect(json.usage).toBe("withdraw quote <amount|asset> [amount]");
    expect(json.flags).toContain("--to <address>");
    expect(result.stderr.trim()).toBe("");
  });

  test("completion query works through the built entrypoint", () => {
    const result = runBuiltSnapshotCli(
      [
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
      ]
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      mode: string;
      candidates: string[];
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-query");
    expect(json.candidates).toContain("completion");
    expect(json.candidates).toContain("--json");
    expect(result.stderr.trim()).toBe("");
  });
});
