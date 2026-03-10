import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY = "1111111111111111111111111111111111111111111111111111111111111111";

describe("agent-focused improvements", () => {
  test("describe --json returns a detailed descriptor for spaced subcommands", () => {
    const result = runCli(["--json", "describe", "withdraw", "quote"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      command: string;
      usage: string;
      flags: string[];
      globalFlags: string[];
      requiresInit: boolean;
      expectedLatencyClass: string;
    }>(result.stdout);
    expect(json.command).toBe("withdraw quote");
    expect(json.usage).toBe("withdraw quote <amount> --asset <symbol|address>");
    expect(json.flags).toContain("--to <address>");
    expect(json.globalFlags).toContain("--agent");
    expect(json.requiresInit).toBe(true);
    expect(json.expectedLatencyClass).toBe("medium");
    expect(result.stderr.trim()).toBe("");
  });

  test("describe in human mode writes summary to stderr only", () => {
    const result = runCli(["describe", "stats", "global"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Command: stats global");
    expect(result.stderr).toContain("Usage: privacy-pools stats global");
  });

  test("describe unknown command path returns INPUT error with valid paths", () => {
    const result = runCli(["--json", "describe", "not-a-command"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      error: { category: string; message: string; hint: string };
    }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Unknown command path");
    expect(json.error.hint).toContain("withdraw quote");
    expect(json.error.hint).toContain("stats global");
  });

  test("capabilities --json exposes commandDetails and concrete stats subcommands", () => {
    const result = runCli(["--json", "capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      commands: Array<{ name: string }>;
      commandDetails: Record<string, { command: string; flags: string[]; safeReadOnly: boolean }>;
      safeReadOnlyCommands: string[];
    }>(result.stdout);
    expect(json.commands.map((command) => command.name)).toContain("stats global");
    expect(json.commands.map((command) => command.name)).toContain("stats pool");
    expect(json.commands.map((command) => command.name)).toContain("describe");
    expect(json.commandDetails["accounts"]?.flags).toContain("--summary");
    expect(json.commandDetails["describe"]?.command).toBe("describe");
    expect(json.commandDetails["guide"]?.safeReadOnly).toBe(true);
    expect(json.commandDetails["completion"]?.safeReadOnly).toBe(true);
    expect(json.safeReadOnlyCommands).toContain("guide");
    expect(json.safeReadOnlyCommands).toContain("completion");
  });

  test("init --mnemonic-stdin imports recovery phrase without leaking it", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--private-key",
        `0x${TEST_PRIVATE_KEY}`,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: `${TEST_MNEMONIC}\n`,
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(TEST_MNEMONIC);
    expect(result.stdout).not.toContain(TEST_PRIVATE_KEY);
  });

  test("init --private-key-stdin imports signer key without leaking it", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic",
        TEST_MNEMONIC,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: `${TEST_PRIVATE_KEY}\n`,
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(TEST_MNEMONIC);
    expect(result.stdout).not.toContain(TEST_PRIVATE_KEY);
  });

  test("init rejects using both stdin secret flags together", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: `${TEST_MNEMONIC}\n`,
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Cannot read both recovery phrase and signer key from stdin");
  });

  test("init rejects empty mnemonic stdin", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: "",
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No valid recovery phrase found in stdin");
  });

  test("init rejects invalid private-key stdin", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic",
        TEST_MNEMONIC,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: "not-a-private-key\n",
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Invalid private key format");
  });

  test("init rejects empty private-key stdin", () => {
    const result = runCli(
      [
        "--json",
        "init",
        "--mnemonic",
        TEST_MNEMONIC,
        "--private-key-stdin",
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home: createTempHome(),
        input: "",
        timeoutMs: 60_000,
      },
    );
    expect(result.status).toBe(2);
    const json = parseJsonOutput<{ error: { category: string; message: string } }>(result.stdout);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("No private key received on stdin");
  });

  test("accounts compact modes fail fast on invalid flag combinations", () => {
    const summaryAndPending = runCli(
      ["--json", "accounts", "--summary", "--pending-only"],
      { home: createTempHome() },
    );
    expect(summaryAndPending.status).toBe(2);
    expect(summaryAndPending.stdout).toContain("Cannot specify both --summary and --pending-only");

    const summaryAndDetails = runCli(
      ["--json", "accounts", "--summary", "--details"],
      { home: createTempHome() },
    );
    expect(summaryAndDetails.status).toBe(2);
    expect(summaryAndDetails.stdout).toContain("do not support --details");

    const pendingAndAll = runCli(
      ["--json", "accounts", "--pending-only", "--all"],
      { home: createTempHome() },
    );
    expect(pendingAndAll.status).toBe(2);
    expect(pendingAndAll.stdout).toContain("do not support --all");
  });
});
