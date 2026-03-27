import { describe, expect, test } from "bun:test";
import {
  createSeededHome,
  createTempHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

const OFFLINE_ENV = {
  PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
};

describe("human-mode output contracts", () => {
  test("guide writes guide text to stderr", () => {
    const result = runCli(["guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Quick Start");
    expect(result.stderr).toContain("Workflow");
    expect(result.stderr).toContain("npm i -g privacy-pools-cli");
    expect(result.stdout.trim()).toBe("");
  });

  test("guide --quiet stays fully silent", () => {
    const result = runCli(["--quiet", "guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout.trim()).toBe("");
  });

  test("capabilities writes the command catalog to stderr", () => {
    const result = runCli(["capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Agent Capabilities");
    expect(result.stderr).toContain("Commands:");
    expect(result.stderr).toContain("Global Flags:");
    expect(result.stderr).toContain("Typical Agent Workflow:");
    expect(result.stdout.trim()).toBe("");
  });

  test("capabilities --quiet stays fully silent", () => {
    const result = runCli(["--quiet", "capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout.trim()).toBe("");
  });

  test("describe writes command details to stderr", () => {
    const result = runCli(["describe", "withdraw", "quote"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Command: withdraw quote");
    expect(result.stderr).toContain("Usage: privacy-pools withdraw quote");
    expect(result.stdout.trim()).toBe("");
  });

  test("describe --quiet stays fully silent", () => {
    const result = runCli(["--quiet", "describe", "withdraw", "quote"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout.trim()).toBe("");
  });

  test("status without init writes readiness warnings to stderr", () => {
    const result = runCli(["--no-banner", "status"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI Status");
    expect(result.stderr).toContain("Config not found");
    expect(result.stdout.trim()).toBe("");
  });

  test("status with init writes wallet readiness details to stderr", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(
      ["--no-banner", "--rpc-url", "http://127.0.0.1:9", "status"],
      { home, env: OFFLINE_ENV },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI Status");
    expect(result.stderr).toContain("Recovery phrase: set");
    expect(result.stderr).toContain("Signer key:");
    expect(result.stdout.trim()).toBe("");
  });

  test("completion scripts still write to stdout", () => {
    const bash = runCli(["completion", "bash"], { home: createTempHome() });
    expect(bash.status).toBe(0);
    expect(bash.stdout).toContain("_privacy_pools_completion");

    const zsh = runCli(["completion", "zsh"], { home: createTempHome() });
    expect(zsh.status).toBe(0);
    expect(zsh.stdout).toContain("compdef");
  });

  test("human-mode input errors stay on stderr only", () => {
    const home = createSeededHome("sepolia");
    const result = runCli(["deposit", "0.01", "--yes", "--chain", "sepolia"], {
      home,
      env: OFFLINE_ENV,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Error [INPUT]");
    expect(result.stdout.trim()).toBe("");
  });
});

describe("--agent mode output contracts", () => {
  test("--agent guide emits JSON on stdout and nothing on stderr", () => {
    const result = runCli(["--agent", "guide"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      help: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("npm i -g privacy-pools-cli");
    expect(json.help).toContain("privacy-pools capabilities --agent");
  });

  test("--agent capabilities emits JSON on stdout and nothing on stderr", () => {
    const result = runCli(["--agent", "capabilities"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      commands: unknown[];
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.commands.length).toBeGreaterThan(0);
  });

  test("--agent describe emits JSON on stdout and nothing on stderr", () => {
    const result = runCli(["--agent", "describe", "withdraw", "quote"], {
      home: createTempHome(),
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      command: string;
      usage: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.command).toBe("withdraw quote");
    expect(json.usage).toBe("withdraw quote <amount|asset> [amount]");
  });

  test("--agent status emits JSON on stdout and nothing on stderr", () => {
    const result = runCli(["--agent", "status"], {
      home: createSeededHome("sepolia"),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
  });

  test("--agent completion emits JSON on stdout and nothing on stderr", () => {
    const result = runCli(["--agent", "completion", "bash"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-script");
  });
});

describe("mode-contract matrix", () => {
  const cases = [
    { label: "public (activity)", args: ["--chain", "mainnet", "activity"], needsInit: false },
    { label: "init-required (accounts)", args: ["accounts"], needsInit: true },
  ] as const;

  for (const testCase of cases) {
    describe(testCase.label, () => {
      const home = testCase.needsInit ? createSeededHome("sepolia") : createTempHome();
      const opts = { home, timeoutMs: 15_000, env: OFFLINE_ENV };

      test("--json remains parseable and stderr-silent", () => {
        const result = runCli(["--json", ...testCase.args], opts);
        expect(result.status).not.toBe(null);

        const json = parseJsonOutput<{ schemaVersion: string; success: boolean }>(result.stdout);
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(typeof json.success).toBe("boolean");
        expect(result.stderr.trim()).toBe("");
      });

      test("--agent remains parseable and stderr-silent", () => {
        const result = runCli(["--agent", ...testCase.args], opts);
        expect(result.status).not.toBe(null);

        const json = parseJsonOutput<{ schemaVersion: string; success: boolean }>(result.stdout);
        expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
        expect(typeof json.success).toBe("boolean");
        expect(result.stderr.trim()).toBe("");
      });

      test("--quiet suppresses human output", () => {
        const result = runCli(["--quiet", ...testCase.args], opts);
        expect(result.stdout.trim()).toBe("");
      });

      test("human mode keeps errors on stderr", () => {
        const result = runCli(testCase.args, opts);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Error");
        expect(result.stdout.trim()).toBe("");
      });
    });
  }
});
