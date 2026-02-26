import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";

describe("CLI help and discovery", () => {
  const BANNER_SENTINEL = " ,---.  ,---.";

  test("root --help lists all commands", () => {
    const result = runCli(["--help"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
    expect(result.stdout).toContain("--agent");
    expect(result.stdout).not.toMatch(/\n\s+--quiet\s/);
    expect(result.stdout).not.toMatch(/\n\s+--verbose\s/);
    expect(result.stdout).not.toMatch(/\n\s+--no-banner\s/);
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("pools");
    expect(result.stdout).toContain("deposit");
    expect(result.stdout).toContain("withdraw");
    expect(result.stdout).toContain("ragequit");
    expect(result.stdout).toContain("balance");
    expect(result.stdout).toContain("accounts");
    expect(result.stdout).toContain("sync");
  });

  test("root --version returns semantic version", () => {
    const result = runCli(["--version"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
    const lastLine = result.stdout.trim().split(/\n/g).pop();
    expect(lastLine).toMatch(/^0\.1\.0$/);
  });

  const COMMAND_HELP_CASES = [
    ["init", "Initialize wallet and configuration"],
    ["status", "Show configuration and connection status"],
    ["pools", "List available pools and assets"],
    ["deposit", "Deposit ETH or ERC20 tokens into a Privacy Pool"],
    ["withdraw", "Withdraw from a Privacy Pool (relayed by default)"],
    ["ragequit", "Emergency public exit"],
    ["balance", "Show balances across pools"],
    ["accounts", "List pool accounts and commitment details"],
    ["sync", "Sync local account state from on-chain events"],
  ] as const;

  for (const [command, expected] of COMMAND_HELP_CASES) {
    test(`${command} --help renders command description`, () => {
      const result = runCli([command, "--help"], { home: createTempHome() });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(expected);
    });
  }

  test("unknown command exits non-zero", () => {
    const result = runCli(["not-a-command"], { home: createTempHome() });
    expect(result.status).toBe(2);
    expect(result.stderr.toLowerCase()).toContain("unknown command");
  });

  test("withdraw quote --help renders subcommand description", () => {
    const result = runCli(["withdraw", "quote", "--help"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
    expect(result.stdout).toContain("Request relayer quote and limits");
    expect(result.stdout).toContain("--asset");
  });

  test("--no-banner suppresses banner during normal command execution", () => {
    const result = runCli(["--no-banner", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
  });

  test("--quiet suppresses banner during normal command execution", () => {
    const result = runCli(["--quiet", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(BANNER_SENTINEL);
  });

  test("banner is shown only once per session identifier", () => {
    const home = createTempHome();
    const sessionId = `pp-cli-test-session-${Date.now()}`;

    const first = runCli(["status"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(first.status).toBe(0);
    expect(first.stderr).toContain(BANNER_SENTINEL);

    const second = runCli(["status"], {
      home,
      env: { TERM_SESSION_ID: sessionId },
    });
    expect(second.status).toBe(0);
    expect(second.stderr).not.toContain(BANNER_SENTINEL);
  });
});
