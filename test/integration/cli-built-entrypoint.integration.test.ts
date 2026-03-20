import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CLI_CWD,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";

beforeAll(() => {
  const builtCliPath = join(CLI_CWD, "dist", "index.js");
  if (existsSync(builtCliPath)) {
    return;
  }

  const result = spawnSync("bun", ["run", "build"], {
    cwd: CLI_CWD,
    encoding: "utf8",
    timeout: 120_000,
  });

  if (result.status !== 0) {
    throw new Error(
      `Failed to build dist for built-entrypoint tests:\n${result.stderr || result.stdout}`
    );
  }
});

describe("built CLI entrypoint", () => {
  test("--version returns a semantic version", () => {
    const result = runBuiltCli(["--version"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr.trim()).toBe("");
  });

  test("--help returns human-readable usage on stdout", () => {
    const result = runBuiltCli(["--help"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Explore (no wallet needed)");
    expect(result.stderr.trim()).toBe("");
  });

  test("capabilities --agent returns a machine-readable discovery manifest", () => {
    const result = runBuiltCli(["capabilities", "--agent"], {
      home: createTempHome(),
    });
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
    const result = runBuiltCli(["describe", "withdraw", "quote", "--agent"], {
      home: createTempHome(),
    });
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
    const result = runBuiltCli(
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
      ],
      { home: createTempHome() }
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
