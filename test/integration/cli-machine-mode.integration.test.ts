import { describe, expect, test } from "bun:test";
import { createTempHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

describe("machine-mode command envelopes", () => {
  test("unknown commands stay machine-readable in --agent mode", () => {
    const result = runCli(["--agent", "not-a-command"], { home: createTempHome() });
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      errorMessage: string;
      error: { category: string };
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.category).toBe("INPUT");
    expect(json.errorMessage.toLowerCase()).toContain("unknown command");
  });

  const helpModes = [
    ["--agent", "help", "deposit"],
    ["--json", "help", "deposit"],
  ] as const;

  for (const args of helpModes) {
    test(`${args[0]} help deposit returns a JSON help envelope`, () => {
      const result = runCli([...args], { home: createTempHome() });
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
      expect(json.help).toContain("Usage: privacy-pools deposit");
      expect(json.help).not.toContain("(outputHelp)");
    });
  }

  test("--agent guide returns a JSON payload", () => {
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
    expect(typeof json.help).toBe("string");
  });

  test("machine flags override csv for guide discovery", () => {
    const result = runCli(["--agent", "--format", "csv", "guide"], {
      home: createTempHome(),
    });
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
    expect(json.help).toContain("Privacy Pools: Quick Guide");
  });

  test("machine flags override csv for capabilities discovery", () => {
    const result = runCli(["--json", "--format", "csv", "capabilities"], {
      home: createTempHome(),
    });
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

  const rootModes = [
    ["--agent", "help"],
    ["--json", "help"],
  ] as const;

  for (const [flag] of rootModes) {
    test(`${flag} with no command returns a JSON help envelope`, () => {
      const result = runCli([flag], { home: createTempHome() });
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
      expect(json.help).toContain("Usage: privacy-pools");
    });
  }

  test("--agent version returns a JSON version envelope", () => {
    const result = runCli(["--agent", "--version"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      version: string;
    }>(result.stdout);
    expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("version");
    expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
